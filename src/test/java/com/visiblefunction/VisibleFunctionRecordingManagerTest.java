package com.visiblefunction;

import com.google.gson.JsonParser;
import com.visiblefunction.VisibleFunctionExportJson.ExportRecord;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class VisibleFunctionRecordingManagerTest {
	@TempDir
	Path directory;

	@Test
	void sameMillisecondRecordingsNeverOverwrite() throws Exception {
		Clock clock = Clock.fixed(Instant.ofEpochMilli(1_750_000_000_123L), ZoneOffset.UTC);
		VisibleFunctionRecordingManager manager = new VisibleFunctionRecordingManager(directory, clock, () -> "same");

		manager.start();
		String firstId = JsonParser.parseString(manager.statusJson()).getAsJsonObject().get("activeId").getAsString();
		manager.publish(payload(1));
		assertTrue(manager.stop().success());

		manager.start();
		String secondId = JsonParser.parseString(manager.statusJson()).getAsJsonObject().get("activeId").getAsString();
		manager.publish(payload(2));
		assertTrue(manager.stop().success());

		assertNotEquals(firstId, secondId);
		assertEquals(2, Files.list(directory).filter(path -> path.toString().endsWith(".json")).count());
		assertTrue(JsonParser.parseString(manager.recordingJson(firstId)).isJsonObject());
	}

	@Test
	void interruptedJournalRecoversCompleteLinesOnly() throws Exception {
		String id = "20260705-120000-000-deadbeef";
		Path journal = directory.resolve("visiblefunction-recording-" + id + ".journal.tmp");
		Files.createDirectories(directory);
		String record = VisibleFunctionExportJson.record(new ExportRecord(1, payload(1), 1000, 7));
		Files.writeString(
			journal,
			"{\"journal\":\"visiblefunction-recording-journal-v2\",\"id\":\"" + id + "\",\"startedAtMillis\":900}\n"
				+ record + "\n{\"incomplete\":",
			StandardCharsets.UTF_8
		);

		VisibleFunctionRecordingManager manager = new VisibleFunctionRecordingManager(
			directory,
			Clock.systemUTC(),
			() -> "unused"
		);
		manager.recoverInterruptedRecordings();

		var recovered = JsonParser.parseString(manager.recordingJson(id)).getAsJsonObject();
		assertTrue(recovered.getAsJsonObject("recording").get("recovered").getAsBoolean());
		assertEquals(1, recovered.getAsJsonArray("records").size());
		assertFalse(Files.exists(journal));
	}

	@Test
	void unsafeRecordingIdsAreRejected() {
		VisibleFunctionRecordingManager manager = new VisibleFunctionRecordingManager(
			directory,
			Clock.systemUTC(),
			() -> "unused"
		);
		assertEquals("{\"recording\":null}", manager.recordingJson("../outside"));
	}

	private static VisibleFunctionEventPayload payload(int tick) {
		return new VisibleFunctionEventPayload(
			"COMMAND",
			"say hi",
			"executed",
			"- tick: " + tick + "\n- command_id: " + tick + "\n- source: player\n- function: none\n",
			"- tick: " + tick + "\n"
		);
	}
}
