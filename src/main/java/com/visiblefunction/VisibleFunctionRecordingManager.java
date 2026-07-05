package com.visiblefunction;

import com.google.gson.JsonParser;
import com.visiblefunction.VisibleFunctionExportJson.ExportRecord;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.DirectoryStream;
import java.nio.file.FileAlreadyExistsException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Supplier;
import java.util.regex.Pattern;

final class VisibleFunctionRecordingManager {
	private static final DateTimeFormatter FILE_TIME_FORMAT = DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss-SSS");
	private static final Pattern SAFE_RECORDING_ID = Pattern.compile("[A-Za-z0-9._-]+");
	private static final String JOURNAL_FORMAT = "visiblefunction-recording-journal-v2";
	private static final int RECORDING_FLUSH_INTERVAL = 256;
	private static final VisibleFunctionRecordingManager INSTANCE = new VisibleFunctionRecordingManager(
		Path.of("visiblefunction-recordings"),
		Clock.systemDefaultZone(),
		() -> UUID.randomUUID().toString().substring(0, 8)
	);

	private final Path recordingDir;
	private final Clock clock;
	private final Supplier<String> uniqueSuffix;
	private final AtomicLong nextRecordId = new AtomicLong(1);
	private final List<CompletedRecording> completedRecordings = new ArrayList<>();
	private RecordingSession activeSession;

	VisibleFunctionRecordingManager(Path recordingDir, Clock clock, Supplier<String> uniqueSuffix) {
		this.recordingDir = recordingDir;
		this.clock = clock;
		this.uniqueSuffix = uniqueSuffix;
	}

	static VisibleFunctionRecordingManager instance() {
		return INSTANCE;
	}

	synchronized boolean active() {
		return activeSession != null;
	}

	synchronized RecordingResult start() {
		if (activeSession != null) {
			return new RecordingResult(false, "VisibleFunction recording already active: " + activeSession.id());
		}

		try {
			Files.createDirectories(recordingDir);
			activeSession = createSession();
		} catch (IOException exception) {
			VisibleFunction.LOGGER.error("Failed to start VisibleFunction recording", exception);
			return new RecordingResult(false, "VisibleFunction recording failed to start: " + exception.getMessage());
		}

		nextRecordId.set(1);
		return new RecordingResult(true, "VisibleFunction recording started: " + activeSession.id());
	}

	private RecordingSession createSession() throws IOException {
		long startedAtMillis = clock.millis();
		String timestamp = FILE_TIME_FORMAT.format(LocalDateTime.ofInstant(
			Instant.ofEpochMilli(startedAtMillis),
			clock.getZone()
		));

		for (int attempt = 0; attempt < 100; attempt++) {
			String suffix = sanitizeSuffix(uniqueSuffix.get());
			String id = timestamp + "-" + suffix + (attempt == 0 ? "" : "-" + attempt);
			Path journal = recordingJournalFile(id);
			if (Files.exists(recordingFile(id)) || Files.exists(recordingStagingFile(id))) {
				continue;
			}
			try {
				BufferedWriter writer = Files.newBufferedWriter(
					journal,
					StandardCharsets.UTF_8,
					StandardOpenOption.CREATE_NEW,
					StandardOpenOption.WRITE
				);
				RecordingSession session = new RecordingSession(id, startedAtMillis, journal, writer);
				writer.write(journalHeader(session));
				writer.newLine();
				writer.flush();
				return session;
			} catch (FileAlreadyExistsException ignored) {
				// Generate another opaque suffix without ever replacing an existing recording.
			}
		}

		throw new IOException("Could not allocate a unique recording id");
	}

	synchronized RecordingResult stop() {
		if (activeSession == null) {
			return new RecordingResult(false, "VisibleFunction recording is not active.");
		}

		RecordingSession session = activeSession;
		activeSession = null;
		long endedAtMillis = clock.millis();

		try {
			session.close();
			CompletedRecording completed = finalizeJournal(
				session.id(),
				session.startedAtMillis(),
				endedAtMillis,
				session.journalFile(),
				false
			);
			completedRecordings.add(completed);
			return new RecordingResult(true, "VisibleFunction recording saved: " + absolutePath(completed.file()));
		} catch (IOException exception) {
			VisibleFunction.LOGGER.error("Failed to write VisibleFunction recording {}", session.id(), exception);
			return new RecordingResult(false, "VisibleFunction recording failed to save: " + exception.getMessage());
		}
	}

	synchronized RecordingResult toggle() {
		return activeSession == null ? start() : stop();
	}

	synchronized void stopIfActive() {
		if (activeSession != null) {
			stop();
		}
	}

	synchronized void recoverInterruptedRecordings() {
		if (!Files.isDirectory(recordingDir)) {
			return;
		}

		try (DirectoryStream<Path> stream = Files.newDirectoryStream(recordingDir, "visiblefunction-recording-*.journal.tmp")) {
			for (Path journal : stream) {
				recoverJournal(journal);
			}
		} catch (IOException exception) {
			VisibleFunction.LOGGER.warn("Failed to scan interrupted VisibleFunction recordings", exception);
		}
	}

	private void recoverJournal(Path journal) {
		try {
			String header;
			try (BufferedReader reader = Files.newBufferedReader(journal, StandardCharsets.UTF_8)) {
				header = reader.readLine();
			}
			JournalMetadata metadata = parseJournalHeader(header, journal);
			if (metadata == null) {
				VisibleFunction.LOGGER.warn("Ignoring invalid VisibleFunction recording journal {}", journal);
				return;
			}
			if (Files.exists(recordingFile(metadata.id()))) {
				Files.deleteIfExists(journal);
				return;
			}

			long endedAtMillis = Math.max(metadata.startedAtMillis(), Files.getLastModifiedTime(journal).toMillis());
			CompletedRecording completed = finalizeJournal(
				metadata.id(),
				metadata.startedAtMillis(),
				endedAtMillis,
				journal,
				true
			);
			completedRecordings.add(completed);
			VisibleFunction.LOGGER.info("Recovered interrupted VisibleFunction recording {}", metadata.id());
		} catch (IOException exception) {
			VisibleFunction.LOGGER.warn("Failed to recover VisibleFunction recording journal {}", journal, exception);
		}
	}

	synchronized void publish(VisibleFunctionEventPayload payload) {
		if (activeSession == null) {
			return;
		}

		ExportRecord record = new ExportRecord(
			nextRecordId.getAndIncrement(),
			payload,
			clock.millis(),
			VisibleFunctionExportServer.instance().sessionId()
		);
		try {
			activeSession.append(record);
		} catch (IOException exception) {
			VisibleFunction.LOGGER.error("VisibleFunction recording {} stopped after write failure", activeSession.id(), exception);
			activeSession.closeQuietly();
			activeSession = null;
		}
	}

	synchronized String statusJson() {
		List<CompletedRecording> known = knownRecordings();
		Map<String, String> values = new LinkedHashMap<>();
		values.put("active", Boolean.toString(activeSession != null));
		values.put("activeId", activeSession == null ? "none" : activeSession.id());
		values.put("activeRecords", Integer.toString(activeSession == null ? 0 : activeSession.recordCount()));
		values.put("directory", absolutePath(recordingDir));
		values.put("activeFile", activeSession == null ? "none" : absolutePath(activeSession.journalFile()));
		values.put("completed", Integer.toString(known.size()));
		values.put("latest", known.isEmpty() ? "none" : known.getLast().id());
		return VisibleFunctionExportJson.simpleObject(values);
	}

	synchronized String recordingsJson() {
		List<CompletedRecording> known = knownRecordings();
		StringBuilder json = new StringBuilder(256);
		json.append("{\"recordings\":[");
		for (int index = 0; index < known.size(); index++) {
			if (index > 0) {
				json.append(',');
			}
			metadataJson(json, known.get(index));
		}
		json.append("]}");
		return json.toString();
	}

	synchronized String latestRecordingJson() {
		List<CompletedRecording> known = knownRecordings();
		return known.isEmpty() ? "{\"recording\":null}" : recordingJson(known.getLast().id());
	}

	synchronized String recordingJson(String id) {
		if (!isSafeRecordingId(id)) {
			return "{\"recording\":null}";
		}
		for (CompletedRecording recording : completedRecordings) {
			if (recording.id().equals(id)) {
				return readRecordingFile(recording.file(), id);
			}
		}

		Path file = findRecordingFile(id);
		return file != null && Files.isRegularFile(file)
			? readRecordingFile(file, id)
			: "{\"recording\":null}";
	}

	private CompletedRecording finalizeJournal(
		String id,
		long startedAtMillis,
		long endedAtMillis,
		Path journal,
		boolean recovered
	) throws IOException {
		Path file = recordingFile(id);
		Path staging = recordingStagingFile(id);
		if (Files.exists(file)) {
			throw new FileAlreadyExistsException(file.toString());
		}
		Files.deleteIfExists(staging);

		JournalScan scan = scanJournal(journal);
		try (
			BufferedReader reader = Files.newBufferedReader(journal, StandardCharsets.UTF_8);
			OutputStream output = Files.newOutputStream(staging, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)
		) {
			reader.readLine();
			writeUtf8(output, recordingHeader(id, startedAtMillis, endedAtMillis, file, recovered, scan.records()));
			boolean first = true;
			String line;
			while ((line = reader.readLine()) != null) {
				if (line.isBlank() || !isValidRecord(line)) {
					continue;
				}
				if (!first) {
					writeUtf8(output, ",");
				}
				writeUtf8(output, line);
				first = false;
			}
			writeUtf8(output, recordingFooter(scan.records(), scan.tickFilter()));
		}

		try (FileChannel channel = FileChannel.open(staging, StandardOpenOption.WRITE)) {
			channel.force(true);
		}
		movePublished(staging, file);
		Files.deleteIfExists(journal);
		return new CompletedRecording(id, startedAtMillis, endedAtMillis, file, scan.records(), recovered);
	}

	private static JournalScan scanJournal(Path journal) throws IOException {
		TickFilterEngine<ExportRecord> engine = new TickFilterEngine<>();
		int records = 0;
		long currentTick = 0;
		try (BufferedReader reader = Files.newBufferedReader(journal, StandardCharsets.UTF_8)) {
			reader.readLine();
			String line;
			while ((line = reader.readLine()) != null) {
				ExportRecord record = parseRecord(line);
				if (record == null) {
					continue;
				}
				TickFilterEngine.Input<ExportRecord> input = VisibleFunctionExportJson.tickFilterInput(record);
				engine.add(input);
				currentTick = Math.max(currentTick, input.tick());
				records++;
			}
		}
		return new JournalScan(records, engine.snapshots(currentTick));
	}

	private static boolean isValidRecord(String line) {
		return parseRecord(line) != null;
	}

	private static ExportRecord parseRecord(String line) {
		try {
			var json = JsonParser.parseString(line).getAsJsonObject();
			var basic = json.getAsJsonObject("basicFields");
			var detailed = json.getAsJsonObject("detailedFields");
			VisibleFunctionEventPayload payload = new VisibleFunctionEventPayload(
				json.get("type").getAsString(),
				json.get("subject").getAsString(),
				json.get("summary").getAsString(),
				fieldText(basic),
				fieldText(detailed)
			);
			return new ExportRecord(
				json.get("id").getAsLong(),
				payload,
				json.get("timestampMillis").getAsLong(),
				json.get("sessionId").getAsLong()
			);
		} catch (RuntimeException ignored) {
			return null;
		}
	}

	private static String fieldText(com.google.gson.JsonObject fields) {
		if (fields == null) {
			return "";
		}
		StringBuilder text = new StringBuilder();
		for (Map.Entry<String, com.google.gson.JsonElement> entry : fields.entrySet()) {
			text.append("- ").append(entry.getKey()).append(": ").append(entry.getValue().getAsString()).append('\n');
		}
		return text.toString();
	}

	private static void movePublished(Path staging, Path file) throws IOException {
		try {
			Files.move(staging, file, StandardCopyOption.ATOMIC_MOVE);
		} catch (AtomicMoveNotSupportedException ignored) {
			Files.move(staging, file);
		}
	}

	private static String readRecordingFile(Path file, String id) {
		try {
			return Files.readString(file, StandardCharsets.UTF_8);
		} catch (IOException exception) {
			VisibleFunction.LOGGER.warn("Failed to read VisibleFunction recording {}", id, exception);
			return "{\"recording\":null}";
		}
	}

	private static void metadataJson(StringBuilder json, CompletedRecording recording) {
		json.append('{');
		property(json, "id", recording.id()).append(',');
		property(json, "startedAtMillis", recording.startedAtMillis()).append(',');
		property(json, "endedAtMillis", recording.endedAtMillis()).append(',');
		property(json, "durationMillis", Math.max(0, recording.endedAtMillis() - recording.startedAtMillis())).append(',');
		property(json, "file", recording.file().toString()).append(',');
		property(json, "records", recording.recordCount()).append(',');
		property(json, "recovered", recording.recovered());
		json.append('}');
	}

	private List<CompletedRecording> knownRecordings() {
		Map<String, CompletedRecording> known = new LinkedHashMap<>();
		for (CompletedRecording recording : completedRecordings) {
			known.put(recording.id(), recording);
		}

		if (Files.isDirectory(recordingDir)) {
			try (DirectoryStream<Path> stream = Files.newDirectoryStream(recordingDir, "visiblefunction-recording-*.json")) {
				for (Path file : stream) {
					CompletedRecording recording = metadataFromFile(file);
					if (recording != null) {
						known.putIfAbsent(recording.id(), recording);
					}
				}
			} catch (IOException exception) {
				VisibleFunction.LOGGER.warn("Failed to scan VisibleFunction recordings directory", exception);
			}
		}

		List<CompletedRecording> sorted = new ArrayList<>(known.values());
		sorted.sort(Comparator.comparingLong(CompletedRecording::startedAtMillis));
		return sorted;
	}

	private static CompletedRecording metadataFromFile(Path file) {
		String id = idFromFile(file);
		if (!isSafeRecordingId(id)) {
			return null;
		}

		try {
			String json = metadataPrefix(file);
			long modified = Files.getLastModifiedTime(file).toMillis();
			long started = longField(json, "startedAtMillis", modified);
			long ended = longField(json, "endedAtMillis", started);
			int records = (int) longField(json, "records", 0);
			boolean recovered = booleanField(json, "recovered", false);
			return new CompletedRecording(id, started, ended, file, records, recovered);
		} catch (IOException exception) {
			VisibleFunction.LOGGER.warn("Failed to inspect VisibleFunction recording {}", file, exception);
			return null;
		}
	}

	private static String journalHeader(RecordingSession session) {
		StringBuilder json = new StringBuilder(128);
		json.append('{');
		property(json, "journal", JOURNAL_FORMAT).append(',');
		property(json, "id", session.id()).append(',');
		property(json, "startedAtMillis", session.startedAtMillis());
		json.append('}');
		return json.toString();
	}

	private static JournalMetadata parseJournalHeader(String header, Path file) {
		if (header == null) {
			return null;
		}
		try {
			var json = JsonParser.parseString(header).getAsJsonObject();
			if (!JOURNAL_FORMAT.equals(json.get("journal").getAsString())) {
				return null;
			}
			String id = json.get("id").getAsString();
			if (!isSafeRecordingId(id) || !file.getFileName().toString().equals("visiblefunction-recording-" + id + ".journal.tmp")) {
				return null;
			}
			return new JournalMetadata(id, json.get("startedAtMillis").getAsLong());
		} catch (RuntimeException ignored) {
			return null;
		}
	}

	private static String recordingHeader(
		String id,
		long startedAtMillis,
		long endedAtMillis,
		Path file,
		boolean recovered,
		int records
	) {
		StringBuilder json = new StringBuilder(256);
		json.append("{\"recording\":{");
		property(json, "id", id).append(',');
		property(json, "startedAtMillis", startedAtMillis).append(',');
		property(json, "endedAtMillis", endedAtMillis).append(',');
		property(json, "durationMillis", Math.max(0, endedAtMillis - startedAtMillis)).append(',');
		property(json, "file", file.toString()).append(',');
		property(json, "records", records).append(',');
		property(json, "format", "records-v2").append(',');
		property(json, "recovered", recovered);
		json.append("},\"records\":[");
		return json.toString();
	}

	private static String recordingFooter(
		int records,
		List<TickFilterEngine.Snapshot<ExportRecord>> tickFilter
	) {
		return "],\"data\":" + emptyGroupedDataJson(records, tickFilter) + "}";
	}

	private static String emptyGroupedDataJson(
		int records,
		List<TickFilterEngine.Snapshot<ExportRecord>> tickFilter
	) {
		return "{\"counts\":{\"commands\":0,\"events\":0,\"functions\":0,\"other\":" + records
			+ "},\"commands\":[],\"events\":[],\"functions\":[],\"other\":[],"
			+ "\"commandsByType\":{},\"eventsByAction\":{},\"functionsById\":{},\"tickFilter\":"
			+ VisibleFunctionExportJson.tickFilterArrayJson(tickFilter) + "}";
	}

	private Path findRecordingFile(String id) {
		if (!isSafeRecordingId(id)) {
			return null;
		}
		Path exact = recordingFile(id);
		return Files.isRegularFile(exact) ? exact : null;
	}

	private static String idFromFile(Path file) {
		String name = file.getFileName().toString();
		String prefix = "visiblefunction-recording-";
		String suffix = ".json";
		return name.startsWith(prefix) && name.endsWith(suffix)
			? name.substring(prefix.length(), name.length() - suffix.length())
			: "";
	}

	private static boolean isSafeRecordingId(String id) {
		return id != null && SAFE_RECORDING_ID.matcher(id).matches();
	}

	private static long longField(String json, String name, long fallback) {
		String marker = "\"" + name + "\":";
		int start = json.indexOf(marker);
		if (start < 0) {
			return fallback;
		}
		start += marker.length();
		int end = start;
		while (end < json.length() && (Character.isDigit(json.charAt(end)) || json.charAt(end) == '-')) {
			end++;
		}
		try {
			return Long.parseLong(json.substring(start, end));
		} catch (NumberFormatException ignored) {
			return fallback;
		}
	}

	private static boolean booleanField(String json, String name, boolean fallback) {
		String marker = "\"" + name + "\":";
		int start = json.indexOf(marker);
		if (start < 0) {
			return fallback;
		}
		start += marker.length();
		if (json.startsWith("true", start)) {
			return true;
		}
		if (json.startsWith("false", start)) {
			return false;
		}
		return fallback;
	}

	private static String metadataPrefix(Path file) throws IOException {
		try (BufferedReader reader = Files.newBufferedReader(file, StandardCharsets.UTF_8)) {
			char[] buffer = new char[4096];
			int length = reader.read(buffer);
			return length <= 0 ? "" : new String(buffer, 0, length);
		}
	}

	private static void writeUtf8(OutputStream output, String text) throws IOException {
		output.write(text.getBytes(StandardCharsets.UTF_8));
	}

	private static String sanitizeSuffix(String value) {
		String sanitized = value == null ? "" : value.replaceAll("[^A-Za-z0-9_-]", "");
		return sanitized.isBlank() ? UUID.randomUUID().toString().substring(0, 8) : sanitized;
	}

	private static StringBuilder property(StringBuilder json, String name, String value) {
		json.append('"');
		VisibleFunctionExportJson.appendEscaped(json, name);
		json.append("\":\"");
		VisibleFunctionExportJson.appendEscaped(json, value);
		json.append('"');
		return json;
	}

	private static StringBuilder property(StringBuilder json, String name, long value) {
		json.append('"');
		VisibleFunctionExportJson.appendEscaped(json, name);
		json.append("\":").append(value);
		return json;
	}

	private static StringBuilder property(StringBuilder json, String name, int value) {
		return property(json, name, (long) value);
	}

	private static StringBuilder property(StringBuilder json, String name, boolean value) {
		json.append('"');
		VisibleFunctionExportJson.appendEscaped(json, name);
		json.append("\":").append(value);
		return json;
	}

	private Path recordingFile(String id) {
		return recordingDir.resolve("visiblefunction-recording-" + id + ".json");
	}

	private Path recordingJournalFile(String id) {
		return recordingDir.resolve("visiblefunction-recording-" + id + ".journal.tmp");
	}

	private Path recordingStagingFile(String id) {
		return recordingDir.resolve("visiblefunction-recording-" + id + ".json.part");
	}

	private static String absolutePath(Path path) {
		return path.toAbsolutePath().normalize().toString();
	}

	record RecordingResult(boolean success, String message) {
	}

	private static final class RecordingSession {
		private final String id;
		private final long startedAtMillis;
		private final Path journalFile;
		private final BufferedWriter writer;
		private int recordCount;

		private RecordingSession(String id, long startedAtMillis, Path journalFile, BufferedWriter writer) {
			this.id = id;
			this.startedAtMillis = startedAtMillis;
			this.journalFile = journalFile;
			this.writer = writer;
		}

		private String id() {
			return id;
		}

		private long startedAtMillis() {
			return startedAtMillis;
		}

		private Path journalFile() {
			return journalFile;
		}

		private int recordCount() {
			return recordCount;
		}

		private void append(ExportRecord record) throws IOException {
			writer.write(VisibleFunctionExportJson.record(record));
			writer.newLine();
			recordCount++;
			if (recordCount % RECORDING_FLUSH_INTERVAL == 0) {
				writer.flush();
			}
		}

		private void close() throws IOException {
			writer.flush();
			writer.close();
		}

		private void closeQuietly() {
			try {
				writer.close();
			} catch (IOException ignored) {
			}
		}
	}

	private record JournalMetadata(String id, long startedAtMillis) {
	}

	private record JournalScan(
		int records,
		List<TickFilterEngine.Snapshot<ExportRecord>> tickFilter
	) {
	}

	private record CompletedRecording(
		String id,
		long startedAtMillis,
		long endedAtMillis,
		Path file,
		int recordCount,
		boolean recovered
	) {
	}
}
