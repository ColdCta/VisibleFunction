package com.visiblefunction;

import com.visiblefunction.VisibleFunctionExportJson.ExportRecord;

import java.io.BufferedReader;
import java.io.IOException;
import java.nio.file.DirectoryStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;

final class VisibleFunctionRecordingManager {
	private static final DateTimeFormatter FILE_TIME_FORMAT = DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss");
	private static final VisibleFunctionRecordingManager INSTANCE = new VisibleFunctionRecordingManager();

	private final AtomicLong nextRecordId = new AtomicLong(1);
	private final List<CompletedRecording> completedRecordings = new ArrayList<>();
	private RecordingSession activeSession;

	private VisibleFunctionRecordingManager() {
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

		String id = FILE_TIME_FORMAT.format(LocalDateTime.now());
		activeSession = new RecordingSession(id, System.currentTimeMillis(), new ArrayList<>());
		nextRecordId.set(1);
		return new RecordingResult(true, "VisibleFunction recording started: " + id);
	}

	synchronized RecordingResult stop() {
		if (activeSession == null) {
			return new RecordingResult(false, "VisibleFunction recording is not active.");
		}

		RecordingSession session = activeSession;
		activeSession = null;
		long endedAtMillis = System.currentTimeMillis();
		Path file = recordingFile(session.id());
		String json = VisibleFunctionExportJson.recording(
			session.id(),
			session.startedAtMillis(),
			endedAtMillis,
			file.toString(),
			session.records()
		);

		try {
			Files.createDirectories(file.getParent());
			Files.writeString(file, json, StandardCharsets.UTF_8);
		} catch (IOException exception) {
			VisibleFunction.LOGGER.error("Failed to write VisibleFunction recording {}", session.id(), exception);
			return new RecordingResult(false, "VisibleFunction recording failed to save: " + exception.getMessage());
		}

		completedRecordings.add(new CompletedRecording(session.id(), session.startedAtMillis(), endedAtMillis, file, List.copyOf(session.records()), session.records().size()));
		return new RecordingResult(true, "VisibleFunction recording saved: " + file);
	}

	synchronized RecordingResult toggle() {
		return activeSession == null ? start() : stop();
	}

	synchronized void stopIfActive() {
		if (activeSession != null) {
			stop();
		}
	}

	synchronized void publish(VisibleFunctionEventPayload payload) {
		if (activeSession == null) {
			return;
		}

		activeSession.records().add(new ExportRecord(
			nextRecordId.getAndIncrement(),
			payload,
			System.currentTimeMillis(),
			VisibleFunctionExportServer.instance().sessionId()
		));
	}

	synchronized String statusJson() {
		List<CompletedRecording> known = knownRecordings();
		Map<String, String> values = new LinkedHashMap<>();
		values.put("active", Boolean.toString(activeSession != null));
		values.put("activeId", activeSession == null ? "none" : activeSession.id());
		values.put("activeRecords", Integer.toString(activeSession == null ? 0 : activeSession.records().size()));
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
		if (known.isEmpty()) {
			return "{\"recording\":null}";
		}

		return recordingJson(known.getLast().id());
	}

	synchronized String recordingJson(String id) {
		for (CompletedRecording recording : completedRecordings) {
			if (recording.id().equals(id)) {
				return VisibleFunctionExportJson.recording(
					recording.id(),
					recording.startedAtMillis(),
					recording.endedAtMillis(),
					recording.file().toString(),
					recording.records()
				);
			}
		}

		Path file = findRecordingFile(id);
		if (file != null && Files.isRegularFile(file)) {
			try {
				return Files.readString(file, StandardCharsets.UTF_8);
			} catch (IOException exception) {
				VisibleFunction.LOGGER.warn("Failed to read VisibleFunction recording {}", id, exception);
			}
		}
		return "{\"recording\":null}";
	}

	private static void metadataJson(StringBuilder json, CompletedRecording recording) {
		json.append('{');
		property(json, "id", recording.id()).append(',');
		property(json, "startedAtMillis", recording.startedAtMillis()).append(',');
		property(json, "endedAtMillis", recording.endedAtMillis()).append(',');
		property(json, "durationMillis", Math.max(0, recording.endedAtMillis() - recording.startedAtMillis())).append(',');
		property(json, "file", recording.file().toString()).append(',');
		property(json, "records", recording.recordCount());
		json.append('}');
	}

	private List<CompletedRecording> knownRecordings() {
		Map<String, CompletedRecording> known = new LinkedHashMap<>();
		for (CompletedRecording recording : completedRecordings) {
			known.put(recording.id(), recording);
		}

		Path dir = recordingDir();
		if (Files.isDirectory(dir)) {
			try (DirectoryStream<Path> stream = Files.newDirectoryStream(dir, "visiblefunction-recording-*.json")) {
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
		sorted.sort(java.util.Comparator.comparingLong(CompletedRecording::startedAtMillis));
		return sorted;
	}

	private static CompletedRecording metadataFromFile(Path file) {
		String id = idFromFile(file);
		if (id.isBlank()) {
			return null;
		}

		try {
			String json = metadataPrefix(file);
			long modified = Files.getLastModifiedTime(file).toMillis();
			long started = longField(json, "startedAtMillis", modified);
			long ended = longField(json, "endedAtMillis", started);
			int records = (int) longField(json, "records", 0);
			return new CompletedRecording(id, started, ended, file, List.of(), records);
		} catch (IOException exception) {
			VisibleFunction.LOGGER.warn("Failed to inspect VisibleFunction recording {}", file, exception);
			return null;
		}
	}

	private static Path findRecordingFile(String id) {
		Path exact = recordingFile(id);
		if (Files.isRegularFile(exact)) {
			return exact;
		}

		Path dir = recordingDir();
		if (!Files.isDirectory(dir)) {
			return null;
		}

		try (DirectoryStream<Path> stream = Files.newDirectoryStream(dir, "visiblefunction-recording-*.json")) {
			for (Path file : stream) {
				if (id.equals(idFromFile(file))) {
					return file;
				}
			}
		} catch (IOException exception) {
			VisibleFunction.LOGGER.warn("Failed to find VisibleFunction recording {}", id, exception);
		}
		return null;
	}

	private static String idFromFile(Path file) {
		String name = file.getFileName().toString();
		String prefix = "visiblefunction-recording-";
		String suffix = ".json";
		if (!name.startsWith(prefix) || !name.endsWith(suffix)) {
			return "";
		}
		return name.substring(prefix.length(), name.length() - suffix.length());
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

	private static String metadataPrefix(Path file) throws IOException {
		try (BufferedReader reader = Files.newBufferedReader(file, StandardCharsets.UTF_8)) {
			char[] buffer = new char[4096];
			int length = reader.read(buffer);
			return length <= 0 ? "" : new String(buffer, 0, length);
		}
	}

	private static StringBuilder property(StringBuilder json, String name, String value) {
		json.append('"').append(escape(name)).append("\":\"").append(escape(value)).append('"');
		return json;
	}

	private static StringBuilder property(StringBuilder json, String name, long value) {
		json.append('"').append(escape(name)).append("\":").append(value);
		return json;
	}

	private static StringBuilder property(StringBuilder json, String name, int value) {
		json.append('"').append(escape(name)).append("\":").append(value);
		return json;
	}

	private static String escape(String value) {
		StringBuilder escaped = new StringBuilder(value.length() + 8);
		for (int index = 0; index < value.length(); index++) {
			char character = value.charAt(index);
			switch (character) {
				case '"' -> escaped.append("\\\"");
				case '\\' -> escaped.append("\\\\");
				case '\n' -> escaped.append("\\n");
				case '\r' -> escaped.append("\\r");
				case '\t' -> escaped.append("\\t");
				default -> escaped.append(character);
			}
		}
		return escaped.toString();
	}

	private static Path recordingFile(String id) {
		return recordingDir().resolve("visiblefunction-recording-" + id + ".json");
	}

	private static Path recordingDir() {
		return Path.of("visiblefunction-recordings");
	}

	record RecordingResult(boolean success, String message) {
	}

	private record RecordingSession(String id, long startedAtMillis, List<ExportRecord> records) {
	}

	private record CompletedRecording(String id, long startedAtMillis, long endedAtMillis, Path file, List<ExportRecord> records, int recordCount) {
	}
}
