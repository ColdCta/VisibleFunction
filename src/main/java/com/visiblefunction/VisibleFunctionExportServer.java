package com.visiblefunction;

import com.visiblefunction.VisibleFunctionExportJson.ExportRecord;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.atomic.AtomicLong;

final class VisibleFunctionExportServer {
	private static final int DEFAULT_LIMIT = 500;
	private static final int MAX_LIMIT = 5000;
	private static final int MAX_STREAM_BATCH = 512;
	private static final VisibleFunctionExportServer INSTANCE = new VisibleFunctionExportServer();

	private final Object recordsLock = new Object();
	private final List<ExportRecord> records = new ArrayList<>();
	private final List<SseClient> clients = new CopyOnWriteArrayList<>();
	private final BlockingQueue<ExportRecord> pendingRecords = new LinkedBlockingQueue<>();
	private final AtomicLong nextRecordId = new AtomicLong(1);
	private final AtomicLong nextSessionId = new AtomicLong(System.currentTimeMillis());
	private volatile ServerSocket serverSocket;
	private volatile boolean running;
	private volatile int port;
	private volatile long sessionId;
	private Thread acceptThread;
	private Thread broadcastThread;

	private VisibleFunctionExportServer() {
	}

	static VisibleFunctionExportServer instance() {
		return INSTANCE;
	}

	synchronized boolean start(int requestedPort) {
		if (running && port == requestedPort) {
			return true;
		}

		stop();
		synchronized (recordsLock) {
			records.clear();
		}
		nextRecordId.set(1);
		sessionId = nextSessionId.getAndIncrement();

		try {
			ServerSocket socket = new ServerSocket();
			socket.bind(new InetSocketAddress(InetAddress.getLoopbackAddress(), requestedPort));
			serverSocket = socket;
			port = requestedPort;
			running = true;
			acceptThread = new Thread(this::acceptLoop, "VisibleFunction Export Accept");
			acceptThread.setDaemon(true);
			acceptThread.start();
			broadcastThread = new Thread(this::broadcastLoop, "VisibleFunction Export Broadcast");
			broadcastThread.setDaemon(true);
			broadcastThread.start();
			VisibleFunction.LOGGER.info("VisibleFunction export server started on http://127.0.0.1:{}", requestedPort);
			return true;
		} catch (IOException exception) {
			running = false;
			serverSocket = null;
			VisibleFunction.LOGGER.error("Failed to start VisibleFunction export server on port {}", requestedPort, exception);
			return false;
		}
	}

	synchronized void stop() {
		running = false;
		closeServerSocket();
		for (SseClient client : clients) {
			client.close();
		}
		clients.clear();
		pendingRecords.clear();
		if (acceptThread != null) {
			acceptThread.interrupt();
			acceptThread = null;
		}
		if (broadcastThread != null) {
			broadcastThread.interrupt();
			broadcastThread = null;
		}
	}

	boolean running() {
		return running;
	}

	int port() {
		return port;
	}

	int recordCount() {
		synchronized (recordsLock) {
			return records.size();
		}
	}

	long sessionId() {
		return sessionId;
	}

	void publish(VisibleFunctionEventPayload payload) {
		if (!running) {
			return;
		}

		ExportRecord record = new ExportRecord(nextRecordId.getAndIncrement(), payload, System.currentTimeMillis(), sessionId);
		synchronized (recordsLock) {
			records.add(record);
		}
		pendingRecords.offer(record);
	}

	private void acceptLoop() {
		while (running) {
			try {
				Socket socket = serverSocket.accept();
				Thread handler = new Thread(() -> handle(socket), "VisibleFunction Export Request");
				handler.setDaemon(true);
				handler.start();
			} catch (IOException exception) {
				if (running) {
					VisibleFunction.LOGGER.warn("VisibleFunction export accept failed", exception);
				}
			}
		}
	}

	private void broadcastLoop() {
		while (running) {
			try {
				ExportRecord record = pendingRecords.take();
				List<ExportRecord> batch = new ArrayList<>();
				batch.add(record);
				pendingRecords.drainTo(batch, MAX_STREAM_BATCH - 1);

				if (clients.isEmpty()) {
					continue;
				}

				String eventName = batch.size() == 1 ? "record" : "records";
				String eventJson = batch.size() == 1 ? VisibleFunctionExportJson.record(batch.getFirst()) : VisibleFunctionExportJson.records(batch);
				for (SseClient client : clients) {
					if (!client.event(eventName, eventJson)) {
						clients.remove(client);
						client.close();
					}
				}
			} catch (InterruptedException ignored) {
				Thread.currentThread().interrupt();
				return;
			}
		}
	}

	private void handle(Socket socket) {
		try (socket) {
			BufferedReader reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
			String requestLine = reader.readLine();
			if (requestLine == null || requestLine.isBlank()) {
				return;
			}

			String[] parts = requestLine.split(" ");
			if (parts.length < 2 || !"GET".equals(parts[0])) {
				writeText(socket, 405, "Method Not Allowed", "text/plain; charset=utf-8", "Only GET is supported.");
				return;
			}

			while (true) {
				String header = reader.readLine();
				if (header == null || header.isEmpty()) {
					break;
				}
			}

			String target = parts[1];
			String path = target;
			String query = "";
			int queryStart = target.indexOf('?');
			if (queryStart >= 0) {
				path = target.substring(0, queryStart);
				query = target.substring(queryStart + 1);
			}

			switch (path) {
				case "/health" -> writeJson(socket, VisibleFunctionExportJson.health(running, port, recordCount(), sessionId));
				case "/api/v1/records" -> writeJson(socket, recordsResponse(query));
				case "/api/v1/grouped" -> writeJson(socket, groupedResponse(query));
				case "/api/v1/tick-filter" -> writeJson(socket, tickFilterResponse(query));
				case "/api/v1/datapack-analysis" -> writeJson(socket, DatapackAnalysisIndex.json());
				case "/api/v1/recording/status" -> writeJson(socket, VisibleFunctionRecordingManager.instance().statusJson());
				case "/api/v1/recordings" -> writeJson(socket, VisibleFunctionRecordingManager.instance().recordingsJson());
				case "/api/v1/recordings/latest" -> writeJson(socket, VisibleFunctionRecordingManager.instance().latestRecordingJson());
				case "/api/v1/stream" -> stream(socket);
				default -> {
					if (path.startsWith("/api/v1/recordings/")) {
						String id = decode(path.substring("/api/v1/recordings/".length()));
						writeJson(socket, VisibleFunctionRecordingManager.instance().recordingJson(id));
					} else {
						writeText(socket, 404, "Not Found", "text/plain; charset=utf-8", "VisibleFunction export endpoint not found.");
					}
				}
			}
		} catch (IOException exception) {
			if (running) {
				VisibleFunction.LOGGER.debug("VisibleFunction export request failed", exception);
			}
		}
	}

	private String recordsResponse(String query) {
		return VisibleFunctionExportJson.records(selectedRecords(query));
	}

	private String groupedResponse(String query) {
		return VisibleFunctionExportJson.grouped(selectedRecords(query));
	}

	private String tickFilterResponse(String query) {
		return VisibleFunctionExportJson.tickFilter(selectedRecords(query));
	}

	private List<ExportRecord> selectedRecords(String query) {
		Map<String, String> params = parseQuery(query);
		long after = parseLong(params.get("after"), 0);
		int limit = Math.max(1, Math.min(MAX_LIMIT, (int) parseLong(params.get("limit"), DEFAULT_LIMIT)));
		boolean tail = parseBoolean(params.get("tail"));
		List<ExportRecord> selected = new ArrayList<>();

		synchronized (recordsLock) {
			if (tail && after <= 0) {
				int start = Math.max(0, records.size() - limit);
				for (int index = start; index < records.size(); index++) {
					selected.add(records.get(index));
				}
				return selected;
			}

			int start = firstRecordAfter(after);
			for (int index = start; index < records.size(); index++) {
				selected.add(records.get(index));
				if (selected.size() >= limit) {
					break;
				}
			}
		}
		return selected;
	}

	private int firstRecordAfter(long after) {
		int low = 0;
		int high = records.size();

		while (low < high) {
			int mid = (low + high) >>> 1;
			if (records.get(mid).id() <= after) {
				low = mid + 1;
			} else {
				high = mid;
			}
		}
		return low;
	}

	private void stream(Socket socket) throws IOException {
		socket.setKeepAlive(true);
		OutputStream output = socket.getOutputStream();
		PrintWriter writer = new PrintWriter(new OutputStreamWriter(output, StandardCharsets.UTF_8), true);
		writer.print("HTTP/1.1 200 OK\r\n");
		writer.print("Content-Type: text/event-stream; charset=utf-8\r\n");
		writer.print("Cache-Control: no-cache\r\n");
		writer.print("Connection: keep-alive\r\n");
		writer.print("Access-Control-Allow-Origin: *\r\n");
		writer.print("\r\n");
		writer.flush();

		SseClient client = new SseClient(socket, writer);
		clients.add(client);
		client.event("hello", VisibleFunctionExportJson.health(running, port, recordCount(), sessionId));

		while (running && !socket.isClosed()) {
			try {
				Thread.sleep(15000);
			} catch (InterruptedException ignored) {
				Thread.currentThread().interrupt();
				break;
			}
			if (!client.comment("keepalive")) {
				break;
			}
		}

		clients.remove(client);
		client.close();
	}

	private static void writeJson(Socket socket, String body) throws IOException {
		writeText(socket, 200, "OK", "application/json; charset=utf-8", body);
	}

	private static void writeText(Socket socket, int status, String reason, String contentType, String body) throws IOException {
		byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
		OutputStream output = socket.getOutputStream();
		PrintWriter writer = new PrintWriter(new OutputStreamWriter(output, StandardCharsets.UTF_8), false);
		writer.print("HTTP/1.1 " + status + " " + reason + "\r\n");
		writer.print("Content-Type: " + contentType + "\r\n");
		writer.print("Content-Length: " + bytes.length + "\r\n");
		writer.print("Access-Control-Allow-Origin: *\r\n");
		writer.print("Connection: close\r\n");
		writer.print("\r\n");
		writer.flush();
		output.write(bytes);
		output.flush();
	}

	private static Map<String, String> parseQuery(String query) {
		Map<String, String> params = new ConcurrentHashMap<>();
		if (query == null || query.isBlank()) {
			return params;
		}

		for (String pair : query.split("&")) {
			int separator = pair.indexOf('=');
			if (separator < 0) {
				params.put(decode(pair), "");
			} else {
				params.put(decode(pair.substring(0, separator)), decode(pair.substring(separator + 1)));
			}
		}
		return params;
	}

	private static String decode(String value) {
		return URLDecoder.decode(value, StandardCharsets.UTF_8);
	}

	private static long parseLong(String value, long fallback) {
		if (value == null || value.isBlank()) {
			return fallback;
		}

		try {
			return Long.parseLong(value.trim().toLowerCase(Locale.ROOT));
		} catch (NumberFormatException ignored) {
			return fallback;
		}
	}

	private static boolean parseBoolean(String value) {
		if (value == null || value.isBlank()) {
			return false;
		}

		String normalized = value.trim().toLowerCase(Locale.ROOT);
		return "true".equals(normalized) || "1".equals(normalized) || "yes".equals(normalized);
	}

	private void closeServerSocket() {
		ServerSocket socket = serverSocket;
		serverSocket = null;
		if (socket == null) {
			return;
		}

		try {
			socket.close();
		} catch (IOException ignored) {
		}
	}

	private static final class SseClient {
		private final Socket socket;
		private final PrintWriter writer;

		private SseClient(Socket socket, PrintWriter writer) {
			this.socket = socket;
			this.writer = writer;
		}

		private synchronized boolean event(String event, String json) {
			writer.print("event: " + event + "\n");
			writer.print("data: " + json + "\n\n");
			writer.flush();
			return !writer.checkError();
		}

		private synchronized boolean comment(String text) {
			writer.print(": " + text + "\n\n");
			writer.flush();
			return !writer.checkError();
		}

		private void close() {
			try {
				socket.close();
			} catch (IOException ignored) {
			}
		}
	}
}
