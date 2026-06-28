package com.visiblefunction;

import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.entity.Entity;

import java.util.Collection;
import java.util.Locale;

final class TagResultEventFormatter {
	private static final int MAX_TARGET_PREVIEW = 4;

	private TagResultEventFormatter() {
	}

	static VisibleFunctionEventText format(
		CommandTraceContext.CommandContext commandContext,
		Collection<? extends Entity> targets,
		String operation,
		String tag,
		int affectedTargets
	) {
		String action = switch (operation) {
			case "add" -> "tag_added";
			case "remove" -> "tag_removed";
			case "list" -> "tag_listed";
			default -> "tag_updated";
		};
		String subject = "list".equals(operation) ? targetSummary(targets) : tag;
		String summary = summary(action, targets, tag, affectedTargets);

		StringBuilder basic = new StringBuilder();
		appendCommandContext(basic, commandContext);
		appendFields(basic, targets, operation, action, tag, affectedTargets);

		StringBuilder detailed = new StringBuilder();
		appendCommandContext(detailed, commandContext);
		appendFields(detailed, targets, operation, action, tag, affectedTargets);
		appendField(detailed, "target_preview", targetPreview(targets));

		return new VisibleFunctionEventText("EVENT", action + " " + subject, summary, basic.toString(), detailed.toString());
	}

	private static void appendFields(
		StringBuilder text,
		Collection<? extends Entity> targets,
		String operation,
		String action,
		String tag,
		int affectedTargets
	) {
		appendField(text, "event_type", "tag");
		appendField(text, "event_action", action);
		appendField(text, "operation", operation);
		appendField(text, "tag", tag);
		appendField(text, "matched_targets", Integer.toString(targets.size()));
		appendField(text, "affected_targets", Integer.toString(affectedTargets));
		appendField(text, "targets", "aggregate");
		appendField(text, "query", Boolean.toString("list".equals(operation)));
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
		CommandTraceFormatter.appendTriggerFields(text, commandContext.trigger(), false);
	}

	private static String summary(String action, Collection<? extends Entity> targets, String tag, int affectedTargets) {
		return switch (action) {
			case "tag_added" -> String.format(Locale.ROOT, "tag %s added to %d/%d targets", tag, affectedTargets, targets.size());
			case "tag_removed" -> String.format(Locale.ROOT, "tag %s removed from %d/%d targets", tag, affectedTargets, targets.size());
			case "tag_listed" -> String.format(Locale.ROOT, "listed tags for %d targets", targets.size());
			default -> String.format(Locale.ROOT, "tag updated for %d targets", targets.size());
		};
	}

	private static String targetSummary(Collection<? extends Entity> targets) {
		if (targets.isEmpty()) {
			return "0 targets";
		}

		if (targets.size() == 1) {
			Entity entity = targets.iterator().next();
			return BuiltInRegistries.ENTITY_TYPE.getKey(entity.getType()).toString();
		}

		return targets.size() + " targets";
	}

	private static String targetPreview(Collection<? extends Entity> targets) {
		if (targets.isEmpty()) {
			return "[]";
		}

		StringBuilder preview = new StringBuilder("[");
		int index = 0;
		for (Entity entity : targets) {
			if (index > 0) {
				preview.append(", ");
			}
			if (index >= MAX_TARGET_PREVIEW) {
				preview.append("...");
				break;
			}
			preview.append(BuiltInRegistries.ENTITY_TYPE.getKey(entity.getType()))
				.append(" ")
				.append(entity.getUUID());
			index++;
		}
		preview.append("]");
		return preview.toString();
	}

	private static void appendField(StringBuilder text, String name, String value) {
		text.append("- ")
			.append(name)
			.append(": ")
			.append(value)
			.append("\n");
	}
}
