package com.visiblefunction;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

final class CommandTraceFormatter {
	private CommandTraceFormatter() {
	}

	static VisibleFunctionEventText format(CommandTraceContext.CommandContext context) {
		String command = context.rawCommand();
		CommandInterpretation interpretation = CommandInterpretation.from(command, context.effectiveCommand());

		StringBuilder basic = new StringBuilder();
		appendField(basic, "command_id", Long.toString(context.id()));
		appendField(basic, "source", context.source());
		appendField(basic, "function", context.function());
		appendField(basic, "function_call_id", context.functionCallIdText());
		appendField(basic, "position", context.position());
		appendNestedCommand(basic, context);
		appendFields(basic, interpretation.basicFields());

		StringBuilder detailed = new StringBuilder();
		appendField(detailed, "command_id", Long.toString(context.id()));
		appendField(detailed, "source", context.source());
		appendField(detailed, "function", context.function());
		appendField(detailed, "function_call_id", context.functionCallIdText());
		appendField(detailed, "position", context.position());
		appendNestedCommand(detailed, context);
		appendFields(detailed, interpretation.basicFields());
		appendField(detailed, "dimension", context.dimension());
		appendField(detailed, "rotation", context.rotation());
		appendField(detailed, "executor", context.executorName());
		appendField(detailed, "executor_entity", context.executorEntity());

		return new VisibleFunctionEventText("COMMAND", command, interpretation.summary(), basic.toString(), detailed.toString());
	}

	private static void appendFields(StringBuilder text, List<Field> fields) {
		for (Field field : fields) {
			appendField(text, field.name(), field.value());
		}
	}

	private static void appendNestedCommand(StringBuilder text, CommandTraceContext.CommandContext context) {
		if (context.hasNestedCommand()) {
			appendField(text, "nested_command", context.effectiveCommand());
		}
	}

	private static void appendField(StringBuilder text, String name, String value) {
		text.append("- ")
			.append(name)
			.append(": ")
			.append(value)
			.append("\n");
	}

	private record Field(String name, String value) {
	}

	private record CommandInterpretation(String summary, List<Field> basicFields) {
		private static CommandInterpretation from(String command, String effectiveCommand) {
			List<String> tokens = CommandText.tokenize(command);

			if (tokens.isEmpty()) {
				return unknown();
			}

			return switch (tokens.getFirst().toLowerCase(Locale.ROOT)) {
				case "execute" -> execute(tokens, effectiveCommand);
				case "give" -> give(tokens);
				case "effect" -> effect(tokens);
				case "kill" -> kill(tokens);
				case "tp", "teleport" -> teleport(tokens);
				case "scoreboard" -> scoreboard(tokens);
				case "data" -> data(tokens);
				default -> unknown();
			};
		}

		private static CommandInterpretation unknown() {
			return new CommandInterpretation("", List.of());
		}

		private static CommandInterpretation execute(List<String> tokens, String effectiveCommand) {
			List<Field> fields = new ArrayList<>();
			fields.add(new Field("command_type", "execute"));

			if ("store".equals(tokenOr(tokens, 1, "unknown")) && tokens.size() >= 9) {
				fields.add(new Field("action", "execute_store_" + tokenOr(tokens, 2, "unknown")));
				fields.add(new Field("store_target", tokenOr(tokens, 3, "unknown")));
				if ("storage".equals(tokenOr(tokens, 3, "unknown"))) {
					fields.add(new Field("storage", tokenOr(tokens, 4, "unknown")));
					fields.add(new Field("path", tokenOr(tokens, 5, "unknown")));
					fields.add(new Field("nbt_type", tokenOr(tokens, 6, "unknown")));
					fields.add(new Field("scale", tokenOr(tokens, 7, "unknown")));
				}
			} else {
				fields.add(new Field("action", "execute_run"));
			}

			return new CommandInterpretation("executed nested command.", fields);
		}

		private static CommandInterpretation give(List<String> tokens) {
			List<Field> fields = new ArrayList<>();
			fields.add(new Field("command_type", "give"));
			fields.add(new Field("action", "give_item"));
			fields.add(new Field("targets", tokenOr(tokens, 1, "unknown")));
			fields.add(new Field("item", tokenOr(tokens, 2, "unknown")));
			fields.add(new Field("count", tokenOr(tokens, 3, "1")));
			return new CommandInterpretation("gave item.", fields);
		}

		private static CommandInterpretation effect(List<String> tokens) {
			String mode = tokenOr(tokens, 1, "unknown");
			List<Field> fields = new ArrayList<>();
			fields.add(new Field("command_type", "effect"));
			fields.add(new Field("action", "clear".equals(mode) ? "clear_effect" : "give_effect"));
			fields.add(new Field("mode", mode));

			if ("clear".equals(mode)) {
				fields.add(new Field("targets", tokenOr(tokens, 2, "@s")));
				fields.add(new Field("effect", tokenOr(tokens, 3, "all")));
				return new CommandInterpretation("cleared effect.", fields);
			}

			fields.add(new Field("targets", tokenOr(tokens, 2, "unknown")));
			fields.add(new Field("effect", tokenOr(tokens, 3, "unknown")));
			fields.add(new Field("seconds", tokenOr(tokens, 4, "default")));
			fields.add(new Field("amplifier", tokenOr(tokens, 5, "default")));
			fields.add(new Field("hide_particles", tokenOr(tokens, 6, "false")));
			return new CommandInterpretation("gave effect.", fields);
		}

		private static CommandInterpretation kill(List<String> tokens) {
			List<Field> fields = new ArrayList<>();
			fields.add(new Field("command_type", "kill"));
			fields.add(new Field("action", "kill_entities"));
			fields.add(new Field("targets", tokenOr(tokens, 1, "@s")));
			return new CommandInterpretation("killed target.", fields);
		}

		private static CommandInterpretation teleport(List<String> tokens) {
			List<Field> fields = new ArrayList<>();
			fields.add(new Field("command_type", tokens.getFirst().toLowerCase(Locale.ROOT)));
			fields.add(new Field("action", "teleport"));

			if (tokens.size() >= 4 && isCoordinate(tokens.get(1)) && isCoordinate(tokens.get(2)) && isCoordinate(tokens.get(3))) {
				fields.add(new Field("targets", "@s"));
				fields.add(new Field("destination", join(tokens, 1, 4)));
				fields.add(new Field("rotation", joinIfPresent(tokens, 4, 6, "unchanged")));
				return new CommandInterpretation("teleported target.", fields);
			}

			fields.add(new Field("targets", tokenOr(tokens, 1, "@s")));
			if (tokens.size() >= 5 && isCoordinate(tokens.get(2)) && isCoordinate(tokens.get(3)) && isCoordinate(tokens.get(4))) {
				fields.add(new Field("destination", join(tokens, 2, 5)));
				fields.add(new Field("rotation", joinIfPresent(tokens, 5, 7, "unchanged")));
			} else {
				fields.add(new Field("destination", tokenOr(tokens, 2, "unknown")));
			}
			return new CommandInterpretation("teleported target.", fields);
		}

		private static CommandInterpretation scoreboard(List<String> tokens) {
			List<Field> fields = new ArrayList<>();
			String category = tokenOr(tokens, 1, "unknown");
			String operation = tokenOr(tokens, 2, "unknown");
			fields.add(new Field("command_type", "scoreboard"));
			fields.add(new Field("category", category));
			fields.add(new Field("operation", operation));

			if ("players".equals(category)) {
				fields.add(new Field("targets", tokenOr(tokens, 3, "unknown")));
				fields.add(new Field("objective", tokenOr(tokens, 4, "unknown")));
				fields.add(new Field("value", tokenOr(tokens, 5, "none")));
			} else if ("objectives".equals(category)) {
				fields.add(new Field("objective", tokenOr(tokens, 3, "unknown")));
				fields.add(new Field("criteria", tokenOr(tokens, 4, "none")));
			}

			fields.add(new Field("arguments", joinIfPresent(tokens, 3, tokens.size(), "none")));
			return new CommandInterpretation("changed scoreboard.", fields);
		}

		private static CommandInterpretation data(List<String> tokens) {
			List<Field> fields = new ArrayList<>();
			String action = tokenOr(tokens, 1, "unknown");
			String targetKind = tokenOr(tokens, 2, "unknown");
			fields.add(new Field("command_type", "data"));
			fields.add(new Field("action", action));
			fields.add(new Field("target_kind", targetKind));

			if ("storage".equals(targetKind)) {
				fields.add(new Field("storage", tokenOr(tokens, 3, "unknown")));
				fields.add(new Field("path", tokenOr(tokens, 4, "root")));
			} else {
				fields.add(new Field("target", tokenOr(tokens, 3, "unknown")));
				fields.add(new Field("path", tokenOr(tokens, 4, "root")));
			}

			fields.add(new Field("arguments", joinIfPresent(tokens, 5, tokens.size(), "none")));
			return new CommandInterpretation("changed data.", fields);
		}

		private static String tokenOr(List<String> tokens, int index, String fallback) {
			return index < tokens.size() ? tokens.get(index) : fallback;
		}

		private static String joinIfPresent(List<String> tokens, int start, int end, String fallback) {
			return start < tokens.size() ? join(tokens, start, Math.min(end, tokens.size())) : fallback;
		}

		private static String join(List<String> tokens, int start, int end) {
			return String.join(" ", tokens.subList(start, end));
		}

		private static boolean isCoordinate(String token) {
			if (token.startsWith("~") || token.startsWith("^")) {
				return true;
			}

			try {
				Double.parseDouble(token);
				return true;
			} catch (NumberFormatException ignored) {
				return false;
			}
		}

	}
}
