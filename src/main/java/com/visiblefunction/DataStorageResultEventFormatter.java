package com.visiblefunction;

import net.minecraft.nbt.Tag;
import net.minecraft.resources.Identifier;

import java.util.LinkedHashMap;
import java.util.Map;

public final class DataStorageResultEventFormatter {
	private static final int MAX_PREVIEW_LENGTH = 220;

	private DataStorageResultEventFormatter() {
	}

	static VisibleFunctionEventText format(
		CommandTraceContext.CommandContext commandContext,
		String action,
		Identifier storage,
		String path,
		String operation,
		boolean query,
		int result,
		Map<String, String> extraFields
	) {
		String storageText = storage.toString();
		String subject = "root".equals(path) ? storageText : storageText + " " + path;
		String summary = summary(action, storageText, path, result);

		StringBuilder basic = new StringBuilder();
		appendCommandContext(basic, commandContext);
		appendFields(basic, action, storageText, path, operation, query, result, extraFields);

		StringBuilder detailed = new StringBuilder();
		appendCommandContext(detailed, commandContext);
		appendFields(detailed, action, storageText, path, operation, query, result, extraFields);

		return new VisibleFunctionEventText("EVENT", action + " " + subject, summary, basic.toString(), detailed.toString());
	}

	public static Map<String, String> fields() {
		return new LinkedHashMap<>();
	}

	public static String preview(Tag tag) {
		return tag == null ? "none" : preview(tag.toString());
	}

	public static String preview(String value) {
		if (value == null || value.isBlank()) {
			return "none";
		}

		String normalized = value.replace("\n", "\\n");
		if (normalized.length() <= MAX_PREVIEW_LENGTH) {
			return normalized;
		}

		return normalized.substring(0, MAX_PREVIEW_LENGTH) + "...";
	}

	private static String summary(String action, String storage, String path, int result) {
		return switch (action) {
			case "storage_read" -> storage + " read";
			case "storage_merged" -> storage + " merged";
			case "storage_modified" -> storage + " " + path + " modified (" + result + ")";
			case "storage_removed" -> storage + " " + path + " removed (" + result + ")";
			default -> storage + " updated";
		};
	}

	private static void appendFields(
		StringBuilder text,
		String action,
		String storage,
		String path,
		String operation,
		boolean query,
		int result,
		Map<String, String> extraFields
	) {
		appendField(text, "event_type", "storage");
		appendField(text, "event_action", action);
		appendField(text, "operation", operation);
		appendField(text, "storage", storage);
		appendField(text, "path", path);
		appendField(text, "result", Integer.toString(result));
		appendField(text, "query", Boolean.toString(query));
		for (Map.Entry<String, String> field : extraFields.entrySet()) {
			appendField(text, field.getKey(), field.getValue());
		}
	}

	private static void appendCommandContext(StringBuilder text, CommandTraceContext.CommandContext commandContext) {
		if (commandContext == null) {
			appendField(text, "command", "none");
			appendField(text, "command_id", "none");
			appendField(text, "source", "unknown");
			appendField(text, "function", "none");
			appendField(text, "function_call_id", "none");
			appendField(text, "position", "unknown");
			return;
		}

		appendField(text, "command", commandContext.effectiveCommand());
		if (commandContext.hasNestedCommand()) {
			appendField(text, "outer_command", commandContext.rawCommand());
		}
		appendField(text, "command_id", Long.toString(commandContext.id()));
		appendField(text, "source", commandContext.source());
		appendField(text, "function", commandContext.function());
		appendField(text, "function_call_id", commandContext.functionCallIdText());
		appendField(text, "position", commandContext.position());
	}

	private static void appendField(StringBuilder text, String name, String value) {
		text.append("- ")
			.append(name)
			.append(": ")
			.append(value)
			.append("\n");
	}
}
