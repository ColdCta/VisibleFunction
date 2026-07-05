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
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicInteger;

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
		assertEquals(2, countFiles(".json"));
		assertTrue(JsonParser.parseString(manager.recordingJson(firstId)).isJsonObject());
		assertEquals(0, countFiles(".part"));
		assertEquals(0, countFiles(".journal.tmp"));
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

	@Test
	void fileSizeLimitStopsAndPublishesTheRecordsAlreadyWritten() {
		long maxBytes = 16L * 1024 * 1024 + 1800;
		var limits = new VisibleFunctionRecordingManager.RecordingLimits(
			maxBytes,
			60_000,
			10,
			maxBytes * 2,
			1
		);
		VisibleFunctionRecordingManager manager = new VisibleFunctionRecordingManager(
			directory,
			Clock.systemUTC(),
			() -> "quota",
			limits,
			path -> Long.MAX_VALUE
		);
		assertTrue(manager.start().success());
		for (int index = 0; index < 100 && manager.active(); index++) {
			manager.publish(payload(index));
		}

		assertFalse(manager.active());
		var status = JsonParser.parseString(manager.statusJson()).getAsJsonObject();
		assertEquals("file_size_limit", status.get("lastStopReason").getAsString());
		var recording = JsonParser.parseString(manager.latestRecordingJson()).getAsJsonObject();
		assertEquals("file_size_limit", recording.getAsJsonObject("recording").get("stopReason").getAsString());
		assertTrue(recording.getAsJsonArray("records").size() > 0);
	}

	@Test
	void lowDiskSpaceRefusesStartWithoutCreatingAJournal() throws Exception {
		long maxBytes = 32L * 1024 * 1024;
		var limits = new VisibleFunctionRecordingManager.RecordingLimits(
			maxBytes,
			60_000,
			10,
			maxBytes * 2,
			1024 * 1024
		);
		VisibleFunctionRecordingManager manager = new VisibleFunctionRecordingManager(
			directory,
			Clock.systemUTC(),
			() -> "disk",
			limits,
			path -> 1024
		);

		assertFalse(manager.start().success());
		assertEquals(0, countFiles(""));
	}

	@Test
	void lowDiskSpaceDuringRecordingStopsBeforeWritingTheNextRecord() {
		long maxBytes = 32L * 1024 * 1024;
		var limits = new VisibleFunctionRecordingManager.RecordingLimits(
			maxBytes,
			60_000,
			10,
			maxBytes * 2,
			1024 * 1024
		);
		AtomicInteger checks = new AtomicInteger();
		VisibleFunctionRecordingManager manager = new VisibleFunctionRecordingManager(
			directory,
			Clock.systemUTC(),
			() -> "runtime-disk",
			limits,
			path -> checks.getAndIncrement() == 0 ? Long.MAX_VALUE : 9L * 1024 * 1024
		);
		assertTrue(manager.start().success());
		manager.publish(payload(1));

		assertFalse(manager.active());
		assertTrue(manager.latestRecordingJson().contains("\"stopReason\":\"low_disk_space\""));
		assertEquals(0, JsonParser.parseString(manager.latestRecordingJson()).getAsJsonObject().getAsJsonArray("records").size());
	}

	@Test
	void largeRecordForcesAnEarlyDiskSpaceRecheck() {
		long maxBytes = 32L * 1024 * 1024;
		var limits = new VisibleFunctionRecordingManager.RecordingLimits(
			maxBytes,
			60_000,
			10,
			maxBytes * 2,
			1024 * 1024
		);
		AtomicInteger checks = new AtomicInteger();
		VisibleFunctionRecordingManager manager = new VisibleFunctionRecordingManager(
			directory,
			Clock.systemUTC(),
			() -> "large-record",
			limits,
			path -> checks.getAndIncrement() < 2 ? Long.MAX_VALUE : 9L * 1024 * 1024
		);
		assertTrue(manager.start().success());
		manager.publish(payload(1));
		manager.publish(new VisibleFunctionEventPayload(
			"COMMAND",
			"say large",
			"x".repeat(1024 * 1024 + 1),
			"- tick: 2\n- command_id: 2\n- source: player\n- function: none\n",
			"- tick: 2\n"
		));

		assertFalse(manager.active());
		var recording = JsonParser.parseString(manager.latestRecordingJson()).getAsJsonObject();
		assertEquals("low_disk_space", recording.getAsJsonObject("recording").get("stopReason").getAsString());
		assertEquals(1, recording.getAsJsonArray("records").size());
	}

	@Test
	void fileCountLimitRefusesNewRecordingWithoutDeletingOldFiles() throws Exception {
		long maxBytes = 32L * 1024 * 1024;
		Files.createDirectories(directory);
		Files.writeString(directory.resolve("visiblefunction-recording-one.json"), "{}");
		Files.writeString(directory.resolve("visiblefunction-recording-two.json"), "{}");
		var limits = new VisibleFunctionRecordingManager.RecordingLimits(
			maxBytes,
			60_000,
			2,
			maxBytes * 2,
			1
		);
		VisibleFunctionRecordingManager manager = new VisibleFunctionRecordingManager(
			directory,
			Clock.systemUTC(),
			() -> "files",
			limits,
			path -> Long.MAX_VALUE
		);

		assertFalse(manager.start().success());
		assertEquals(2, countFiles(".json"));
		assertTrue(manager.statusJson().contains("\"lastStopReason\":\"file_count_limit\""));
	}

	@Test
	void directorySizeLimitRefusesNewRecording() throws Exception {
		long maxBytes = 32L * 1024 * 1024;
		Files.createDirectories(directory);
		Path existing = directory.resolve("visiblefunction-recording-large.json");
		try (var channel = java.nio.channels.FileChannel.open(
			existing,
			java.nio.file.StandardOpenOption.CREATE_NEW,
			java.nio.file.StandardOpenOption.WRITE
		)) {
			channel.position(maxBytes - 1);
			channel.write(java.nio.ByteBuffer.wrap(new byte[] {0}));
		}
		var limits = new VisibleFunctionRecordingManager.RecordingLimits(
			maxBytes,
			60_000,
			10,
			maxBytes,
			1
		);
		VisibleFunctionRecordingManager manager = new VisibleFunctionRecordingManager(
			directory,
			Clock.systemUTC(),
			() -> "directory",
			limits,
			path -> Long.MAX_VALUE
		);

		assertFalse(manager.start().success());
		assertTrue(manager.statusJson().contains("\"lastStopReason\":\"directory_size_limit\""));
	}

	@Test
	void abandonedJournalsCountTowardDirectoryQuotas() throws Exception {
		long maxBytes = 32L * 1024 * 1024;
		Files.createDirectories(directory);
		Files.writeString(directory.resolve("visiblefunction-recording-abandoned.journal.tmp"), "stale");
		var limits = new VisibleFunctionRecordingManager.RecordingLimits(
			maxBytes,
			60_000,
			1,
			maxBytes * 2,
			1
		);
		VisibleFunctionRecordingManager manager = new VisibleFunctionRecordingManager(
			directory,
			Clock.systemUTC(),
			() -> "journal-quota",
			limits,
			path -> Long.MAX_VALUE
		);

		assertFalse(manager.start().success());
		assertTrue(manager.statusJson().contains("\"lastStopReason\":\"file_count_limit\""));
	}

	@Test
	void durationLimitStopsOnTheNextRecord() {
		long maxBytes = 32L * 1024 * 1024;
		var limits = new VisibleFunctionRecordingManager.RecordingLimits(
			maxBytes,
			1000,
			10,
			maxBytes * 2,
			1
		);
		MutableClock clock = new MutableClock(1000);
		VisibleFunctionRecordingManager manager = new VisibleFunctionRecordingManager(
			directory,
			clock,
			() -> "duration",
			limits,
			path -> Long.MAX_VALUE
		);
		assertTrue(manager.start().success());
		manager.publish(payload(1));
		clock.millis.set(2000);
		manager.tick();

		assertFalse(manager.active());
		assertTrue(manager.latestRecordingJson().contains("\"stopReason\":\"duration_limit\""));
	}

	@Test
	void v3RecoveryTruncatesAnIncompleteRecordAndRenamesInPlace() throws Exception {
		String id = "20260705-120000-000-v3crash";
		Path journal = directory.resolve("visiblefunction-recording-" + id + ".journal.tmp");
		Files.createDirectories(directory);
		String record = VisibleFunctionExportJson.record(new ExportRecord(1, payload(1), 1000, 7));
		Files.writeString(
			journal,
			"{\"journal\":{\"format\":\"visiblefunction-recording-journal-v3\",\"id\":\"" + id
				+ "\",\"startedAtMillis\":900},\"records\":[\n" + record + "\n,{\"incomplete\":",
			StandardCharsets.UTF_8
		);
		VisibleFunctionRecordingManager manager = new VisibleFunctionRecordingManager(
			directory,
			Clock.systemUTC(),
			() -> "unused"
		);
		manager.recoverInterruptedRecordings();

		var recovered = JsonParser.parseString(manager.recordingJson(id)).getAsJsonObject();
		assertEquals(1, recovered.getAsJsonArray("records").size());
		assertEquals("records-v3", recovered.getAsJsonObject("recording").get("format").getAsString());
		assertFalse(Files.exists(journal));
		assertEquals(0, countFiles(".part"));
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

	private long countFiles(String suffix) throws Exception {
		try (var files = Files.list(directory)) {
			return files.filter(path -> path.getFileName().toString().endsWith(suffix)).count();
		}
	}

	private static final class MutableClock extends Clock {
		private final AtomicLong millis;

		private MutableClock(long millis) {
			this.millis = new AtomicLong(millis);
		}

		@Override
		public ZoneId getZone() {
			return ZoneOffset.UTC;
		}

		@Override
		public Clock withZone(ZoneId zone) {
			return this;
		}

		@Override
		public Instant instant() {
			return Instant.ofEpochMilli(millis.get());
		}

		@Override
		public long millis() {
			return millis.get();
		}
	}
}
