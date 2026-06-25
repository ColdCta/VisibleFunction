package com.visiblefunction;

import java.util.Map;

final class ScoreboardResultEventFormatter {
	private ScoreboardResultEventFormatter() {
	}

	static VisibleFunctionEventText format(
		CommandTraceContext.CommandContext commandContext,
		String action,
		String subject,
		String summary,
		Map<String, String> fields
	) {
		StringBuilder basic = new StringBuilder();
		appendCommandContext(basic, commandContext);
		appendFields(basic, action, fields);

		StringBuilder detailed = new StringBuilder();
		appendCommandContext(detailed, commandContext);
		appendFields(detailed, action, fields);

		return new VisibleFunctionEventText("EVENT", action + " " + subject, summary, basic.toString(), detailed.toString());
	}

	private static void appendFields(StringBuilder text, String action, Map<String, String> fields) {
		appendField(text, "event_type", "scoreboard");
		appendField(text, "event_action", action);
		for (Map.Entry<String, String> field : fields.entrySet()) {
			appendField(text, field.getKey(), field.getValue());
		}
		appendField(text, "query", "false");
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
