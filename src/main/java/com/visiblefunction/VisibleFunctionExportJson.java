package com.visiblefunction;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

final class VisibleFunctionExportJson {
	private static final int TICK_MILLIS = 50;

	private VisibleFunctionExportJson() {
	}

	static String record(ExportRecord record) {
		return record.json();
	}

	private static String buildRecord(ExportRecord record) {
		Map<String, String> basicFields = parseFields(record.payload().basic());
		Map<String, String> detailedFields = parseFields(record.payload().detailed());
		String command = "COMMAND".equals(record.payload().category()) ? record.payload().subject() : basicFields.getOrDefault("command", "none");
		String function = basicFields.getOrDefault("function", "none");
		String eventAction = basicFields.getOrDefault("action", record.payload().summary().isBlank() ? "none" : record.payload().summary());
		String commandType = basicFields.getOrDefault("command_type", "none");

		StringBuilder json = new StringBuilder(1024);
		json.append('{');
		property(json, "id", record.id()).append(',');
		property(json, "type", record.payload().category()).append(',');
		property(json, "commandType", commandType).append(',');
		property(json, "eventAction", eventAction).append(',');
		json.append("\"groups\":");
		groups(json, record.payload().category(), function).append(',');
		property(json, "subject", record.payload().subject()).append(',');
		property(json, "summary", record.payload().summary()).append(',');
		property(json, "timestampMillis", record.timestampMillis()).append(',');
		property(json, "sessionId", record.sessionId()).append(',');
		json.append("\"commandContext\":");
		json.append('{');
		property(json, "command", command).append(',');
		property(json, "commandId", basicFields.getOrDefault("command_id", "none")).append(',');
		property(json, "source", basicFields.getOrDefault("source", "unknown")).append(',');
		property(json, "function", function).append(',');
		property(json, "functionCallId", basicFields.getOrDefault("function_call_id", "none")).append(',');
		property(json, "triggerType", basicFields.getOrDefault("trigger_type", "none")).append(',');
		property(json, "triggerId", basicFields.getOrDefault("trigger_id", "none")).append(',');
		property(json, "triggerFunction", basicFields.getOrDefault("trigger_function", "none"));
		json.append("},");
		json.append("\"basicFields\":");
		fields(json, basicFields).append(',');
		json.append("\"detailedFields\":");
		fields(json, detailedFields);
		json.append('}');
		return json.toString();
	}

	static String grouped(List<ExportRecord> records) {
		StringBuilder json = new StringBuilder(Math.max(256, records.size() * 640));
		List<ExportRecord> commands = new java.util.ArrayList<>();
		List<ExportRecord> events = new java.util.ArrayList<>();
		List<ExportRecord> functions = new java.util.ArrayList<>();
		List<ExportRecord> other = new java.util.ArrayList<>();
		Map<String, List<ExportRecord>> eventsByAction = new LinkedHashMap<>();
		Map<String, List<ExportRecord>> functionsById = new LinkedHashMap<>();
		Map<String, List<ExportRecord>> commandsByType = new LinkedHashMap<>();

		for (ExportRecord record : records) {
			Map<String, String> fields = parseFields(record.payload().basic());
			String category = record.payload().category();
			String functionId = fields.getOrDefault("function", "none");
			if ("COMMAND".equals(category)) {
				commands.add(record);
				commandsByType.computeIfAbsent(fields.getOrDefault("command_type", "unknown"), ignored -> new java.util.ArrayList<>()).add(record);
			} else if ("EVENT".equals(category)) {
				events.add(record);
				String action = fields.getOrDefault("action", record.payload().summary().isBlank() ? "unknown" : record.payload().summary());
				eventsByAction.computeIfAbsent(action, ignored -> new java.util.ArrayList<>()).add(record);
			} else {
				other.add(record);
			}

			if (!"none".equals(functionId) && !functionId.isBlank()) {
				functions.add(record);
				functionsById.computeIfAbsent(functionId, ignored -> new java.util.ArrayList<>()).add(record);
			}
		}

		json.append('{');
		json.append("\"counts\":{");
		property(json, "commands", commands.size()).append(',');
		property(json, "events", events.size()).append(',');
		property(json, "functions", functions.size()).append(',');
		property(json, "other", other.size());
		json.append("},");
		json.append("\"commands\":");
		recordsArray(json, commands).append(',');
		json.append("\"events\":");
		recordsArray(json, events).append(',');
		json.append("\"functions\":");
		recordsArray(json, functions).append(',');
		json.append("\"other\":");
		recordsArray(json, other).append(',');
		json.append("\"commandsByType\":");
		recordGroups(json, commandsByType).append(',');
		json.append("\"eventsByAction\":");
		recordGroups(json, eventsByAction).append(',');
		json.append("\"functionsById\":");
		recordGroups(json, functionsById).append(',');
		json.append("\"tickFilter\":");
		tickFilterArray(json, records);
		json.append('}');
		return json.toString();
	}

	static String tickFilter(List<ExportRecord> records) {
		TickFilterEngine<ExportRecord> engine = new TickFilterEngine<>();
		long currentTick = 0;
		for (ExportRecord record : records) {
			TickFilterEngine.Input<ExportRecord> input = tickFilterInput(record);
			engine.add(input);
			currentTick = Math.max(currentTick, input.tick());
		}
		return tickFilterSnapshots(engine.snapshots(currentTick));
	}

	static String tickFilterSnapshots(List<TickFilterEngine.Snapshot<ExportRecord>> buckets) {
		StringBuilder json = new StringBuilder(Math.max(128, buckets.size() * 512));
		json.append("{\"tickFilter\":");
		tickFilterSnapshotArray(json, buckets);
		json.append('}');
		return json.toString();
	}

	static String tickFilterArrayJson(List<TickFilterEngine.Snapshot<ExportRecord>> buckets) {
		StringBuilder json = new StringBuilder(Math.max(64, buckets.size() * 512));
		tickFilterSnapshotArray(json, buckets);
		return json.toString();
	}

	static String recording(String id, long startedAtMillis, long endedAtMillis, String file, List<ExportRecord> records) {
		StringBuilder json = new StringBuilder(Math.max(256, records.size() * 640));
		json.append('{');
		json.append("\"recording\":{");
		property(json, "id", id).append(',');
		property(json, "startedAtMillis", startedAtMillis).append(',');
		property(json, "endedAtMillis", endedAtMillis).append(',');
		property(json, "durationMillis", Math.max(0, endedAtMillis - startedAtMillis)).append(',');
		property(json, "file", file).append(',');
		property(json, "records", records.size());
		json.append("},");
		json.append("\"data\":");
		json.append(grouped(records));
		json.append('}');
		return json.toString();
	}

	static String records(List<ExportRecord> records) {
		StringBuilder json = new StringBuilder(Math.max(128, records.size() * 512));
		json.append("{\"records\":[");
		appendRecords(json, records);
		json.append("]}");
		return json.toString();
	}

	static String health(
		boolean running,
		int port,
		int records,
		long sessionId,
		long currentTick,
		long oldestRecordId,
		long latestRecordId,
		long droppedStreamRecords,
		long slowClientDisconnects
	) {
		StringBuilder json = new StringBuilder(256);
		json.append('{');
		property(json, "protocolVersion", 2).append(',');
		property(json, "running", running).append(',');
		property(json, "port", port).append(',');
		property(json, "records", records).append(',');
		property(json, "sessionId", sessionId).append(',');
		property(json, "currentTick", currentTick).append(',');
		property(json, "oldestRecordId", oldestRecordId).append(',');
		property(json, "latestRecordId", latestRecordId).append(',');
		property(json, "droppedStreamRecords", droppedStreamRecords).append(',');
		property(json, "slowClientDisconnects", slowClientDisconnects);
		json.append('}');
		return json.toString();
	}

	static String simpleObject(Map<String, String> values) {
		StringBuilder json = new StringBuilder(128);
		json.append('{');
		int index = 0;
		for (Map.Entry<String, String> entry : values.entrySet()) {
			if (index++ > 0) {
				json.append(',');
			}
			property(json, entry.getKey(), entry.getValue());
		}
		json.append('}');
		return json.toString();
	}

	private static Map<String, String> parseFields(String text) {
		Map<String, String> fields = new LinkedHashMap<>();
		for (String line : text.split("\\R")) {
			if (!line.startsWith("- ")) {
				continue;
			}

			int separator = line.indexOf(':');
			if (separator < 0) {
				continue;
			}

			String name = line.substring(2, separator).strip();
			String value = line.substring(separator + 1).strip();
			if (!name.isBlank()) {
				fields.put(name, value);
			}
		}
		return fields;
	}

	private static StringBuilder fields(StringBuilder json, Map<String, String> fields) {
		json.append('{');
		int index = 0;
		for (Map.Entry<String, String> entry : fields.entrySet()) {
			if (index++ > 0) {
				json.append(',');
			}
			quoted(json, entry.getKey()).append(':');
			quoted(json, entry.getValue());
		}
		json.append('}');
		return json;
	}

	private static StringBuilder groups(StringBuilder json, String category, String function) {
		json.append('[');
		int count = 0;
		if ("COMMAND".equals(category)) {
			count = appendGroup(json, count, "commands");
		} else if ("EVENT".equals(category)) {
			count = appendGroup(json, count, "events");
		} else {
			count = appendGroup(json, count, "other");
		}
		if (!"none".equals(function) && !function.isBlank()) {
			appendGroup(json, count, "functions");
		}
		json.append(']');
		return json;
	}

	private static int appendGroup(StringBuilder json, int count, String group) {
		if (count > 0) {
			json.append(',');
		}
		quoted(json, group);
		return count + 1;
	}

	private static StringBuilder recordsArray(StringBuilder json, List<ExportRecord> records) {
		json.append('[');
		appendRecords(json, records);
		json.append(']');
		return json;
	}

	private static void appendRecords(StringBuilder json, List<ExportRecord> records) {
		for (int index = 0; index < records.size(); index++) {
			if (index > 0) {
				json.append(',');
			}
			json.append(record(records.get(index)));
		}
	}

	private static StringBuilder recordGroups(StringBuilder json, Map<String, List<ExportRecord>> groups) {
		json.append('{');
		int index = 0;
		for (Map.Entry<String, List<ExportRecord>> entry : groups.entrySet()) {
			if (index++ > 0) {
				json.append(',');
			}
			quoted(json, entry.getKey()).append(':');
			recordsArray(json, entry.getValue());
		}
		json.append('}');
		return json;
	}

	private static StringBuilder tickFilterArray(StringBuilder json, List<ExportRecord> records) {
		TickFilterEngine<ExportRecord> engine = new TickFilterEngine<>();
		long currentTick = 0;
		for (ExportRecord record : records) {
			TickFilterEngine.Input<ExportRecord> input = tickFilterInput(record);
			engine.add(input);
			currentTick = Math.max(currentTick, input.tick());
		}
		return tickFilterSnapshotArray(json, engine.snapshots(currentTick));
	}

	private static StringBuilder tickFilterSnapshotArray(
		StringBuilder json,
		List<TickFilterEngine.Snapshot<ExportRecord>> buckets
	) {
		json.append('[');
		for (int index = 0; index < buckets.size(); index++) {
			if (index > 0) {
				json.append(',');
			}
			tickFilterBucket(json, buckets.get(index));
		}
		json.append(']');
		return json;
	}

	private static void tickFilterBucket(StringBuilder json, TickFilterEngine.Snapshot<ExportRecord> bucket) {
		json.append('{');
		property(json, "key", bucket.key()).append(',');
		property(json, "type", bucket.type().name()).append(',');
		property(json, "displayName", bucket.displayName()).append(',');
		property(json, "firstSeenTick", bucket.firstSeenTick()).append(',');
		property(json, "lastSeenTick", bucket.lastSeenTick()).append(',');
		property(json, "startMillis", bucket.startMillis()).append(',');
		property(json, "endMillis", bucket.endMillis()).append(',');
		property(json, "totalCount", bucket.totalCount()).append(',');
		property(json, "countLastSecond", bucket.countLastSecond()).append(',');
		property(json, "sourceSummary", bucket.sourceSummary()).append(',');
		property(json, "reason", bucket.reason()).append(',');
		property(json, "active", bucket.active()).append(',');
		json.append("\"recordIds\":");
		longArray(json, bucket.recordIds()).append(',');
		json.append("\"commandIds\":");
		stringArray(json, bucket.commandIds()).append(',');
		json.append("\"sampleRecords\":[");
		List<ExportRecord> samples = bucket.sampleRecords();
		for (int index = 0; index < samples.size(); index++) {
			if (index > 0) {
				json.append(',');
			}
			json.append(record(samples.get(index)));
		}
		json.append("]}");
	}

	static TickFilterEngine.Input<ExportRecord> tickFilterInput(ExportRecord record) {
		Map<String, String> fields = parseFields(record.payload().basic());
		String function = fields.getOrDefault("function", "none");
		String source = fields.getOrDefault("source", "unknown");
		String command = "COMMAND".equals(record.payload().category())
			? normalizeCommand(record.payload().subject())
			: fields.getOrDefault("command", "none");
		String action = fields.getOrDefault("action", record.payload().summary());
		long tick = parseTick(fields, record.timestampMillis() / TICK_MILLIS);
		String sourceSummary = !"none".equals(function) && !function.isBlank()
			? (isTickFunction(function) || "tick function".equals(source) ? "tick function " : "function ") + function
			: source;
		return new TickFilterEngine.Input<>(
			record.id(),
			record.payload().category(),
			record.payload().subject(),
			action,
			command,
			fields.getOrDefault("command_id", "none"),
			source,
			function,
			sourceSummary,
			tick,
			record.timestampMillis(),
			"tick function".equals(source) || isTickFunction(function),
			record
		);
	}

	private static StringBuilder longArray(StringBuilder json, List<Long> values) {
		json.append('[');
		for (int index = 0; index < values.size(); index++) {
			if (index > 0) {
				json.append(',');
			}
			json.append(values.get(index));
		}
		json.append(']');
		return json;
	}

	private static StringBuilder stringArray(StringBuilder json, List<String> values) {
		json.append('[');
		for (int index = 0; index < values.size(); index++) {
			if (index > 0) {
				json.append(',');
			}
			quoted(json, values.get(index));
		}
		json.append(']');
		return json;
	}

	private static String normalizeCommand(String command) {
		return command == null ? "" : command.trim().replaceAll("\\s+", " ");
	}

	private static long parseTick(Map<String, String> fields, long fallback) {
		String tick = fields.get("tick");
		if (tick == null || tick.isBlank()) {
			return fallback;
		}

		try {
			return Long.parseLong(tick.trim());
		} catch (NumberFormatException ignored) {
			return fallback;
		}
	}

	private static StringBuilder property(StringBuilder json, String name, String value) {
		quoted(json, name).append(':');
		quoted(json, value);
		return json;
	}

	private static StringBuilder property(StringBuilder json, String name, long value) {
		quoted(json, name).append(':').append(value);
		return json;
	}

	private static StringBuilder property(StringBuilder json, String name, int value) {
		quoted(json, name).append(':').append(value);
		return json;
	}

	private static StringBuilder property(StringBuilder json, String name, boolean value) {
		quoted(json, name).append(':').append(value);
		return json;
	}

	private static StringBuilder quoted(StringBuilder json, String value) {
		json.append('"');
		appendEscaped(json, value);
		json.append('"');
		return json;
	}

	// Appends the JSON-escaped form of {@code value} (without the surrounding quotes). Shared with
	// VisibleFunctionRecordingManager so both paths escape control characters identically.
	static StringBuilder appendEscaped(StringBuilder json, String value) {
		for (int index = 0; index < value.length(); index++) {
			char character = value.charAt(index);
			switch (character) {
				case '"' -> json.append("\\\"");
				case '\\' -> json.append("\\\\");
				case '\b' -> json.append("\\b");
				case '\f' -> json.append("\\f");
				case '\n' -> json.append("\\n");
				case '\r' -> json.append("\\r");
				case '\t' -> json.append("\\t");
				default -> {
					if (character < 0x20) {
						json.append(String.format("\\u%04x", (int) character));
					} else {
						json.append(character);
					}
				}
			}
		}
		return json;
	}

	private static boolean isTickFunction(String function) {
		if (function == null || function.isBlank() || "none".equals(function)) {
			return false;
		}

		return DatapackTickFunctionIndex.isTickFunction(function);
	}

	static final class ExportRecord {
		private final long id;
		private final VisibleFunctionEventPayload payload;
		private final long timestampMillis;
		private final long sessionId;
		private volatile String json;

		ExportRecord(long id, VisibleFunctionEventPayload payload, long timestampMillis, long sessionId) {
			this.id = id;
			this.payload = payload;
			this.timestampMillis = timestampMillis;
			this.sessionId = sessionId;
		}

		long id() {
			return id;
		}

		VisibleFunctionEventPayload payload() {
			return payload;
		}

		long timestampMillis() {
			return timestampMillis;
		}

		long sessionId() {
			return sessionId;
		}

		private String json() {
			String cached = json;
			if (cached != null) {
				return cached;
			}

			cached = buildRecord(this);
			json = cached;
			return cached;
		}
	}
}
