package com.visiblefunction;

import com.google.gson.JsonParser;
import org.junit.jupiter.api.Test;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.PrintWriter;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class VisibleFunctionExportServerTest {
	@Test
	void streamPublishesTickHeartbeatAndCapturedTransitionEvents() throws Exception {
		VisibleFunctionExportServer server = VisibleFunctionExportServer.instance();
		int port = availablePort();
		assertTrue(server.start(port));
		try (Socket socket = new Socket(InetAddress.getLoopbackAddress(), port)) {
			socket.setSoTimeout(5_000);
			PrintWriter writer = new PrintWriter(socket.getOutputStream(), true, StandardCharsets.UTF_8);
			writer.print("GET /api/v1/stream HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
			writer.flush();
			BufferedReader reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
			readHeaders(reader);

			Map<String, String> events = new HashMap<>();
			readEvent(reader, events);
			assertTrue(events.containsKey("hello"));

			server.tick(5);
			for (int index = 0; index < TickFilterEngine.HIGH_FREQUENCY_THRESHOLD; index++) {
				server.publish(payload(index + 1));
			}

			while (!events.containsKey("tick") || !events.containsKey("tick-filter")
				|| (!events.containsKey("record") && !events.containsKey("records"))) {
				readEvent(reader, events);
			}

			var tick = JsonParser.parseString(events.get("tick")).getAsJsonObject();
			assertEquals(server.sessionId(), tick.get("sessionId").getAsLong());
			assertEquals(5, tick.get("currentTick").getAsLong());
			var transition = JsonParser.parseString(events.get("tick-filter")).getAsJsonObject()
				.getAsJsonArray("tickFilter");
			assertEquals(1, transition.size());
			assertTrue(transition.get(0).getAsJsonObject().has("groupId"));
		} finally {
			server.stop();
		}
	}

	private static void readHeaders(BufferedReader reader) throws Exception {
		String line;
		while ((line = reader.readLine()) != null && !line.isEmpty()) {
			// Consume the HTTP response headers.
		}
	}

	private static void readEvent(BufferedReader reader, Map<String, String> events) throws Exception {
		String event = null;
		String data = null;
		String line;
		while ((line = reader.readLine()) != null) {
			if (line.startsWith("event: ")) event = line.substring("event: ".length());
			else if (line.startsWith("data: ")) data = line.substring("data: ".length());
			else if (line.isEmpty() && event != null && data != null) {
				events.put(event, data);
				return;
			}
		}
	}

	private static int availablePort() throws Exception {
		try (ServerSocket socket = new ServerSocket(0, 1, InetAddress.getLoopbackAddress())) {
			return socket.getLocalPort();
		}
	}

	private static VisibleFunctionEventPayload payload(int tick) {
		return new VisibleFunctionEventPayload(
			"COMMAND",
			"say hi",
			"executed",
			"- tick: " + tick + "\n- command: say hi\n- command_id: command-" + tick
				+ "\n- source: player\n- function: none\n",
			"- tick: " + tick + "\n"
		);
	}
}
