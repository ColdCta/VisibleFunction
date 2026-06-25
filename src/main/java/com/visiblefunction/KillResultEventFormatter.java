package com.visiblefunction;

import net.minecraft.world.entity.Entity;

import java.util.Collection;
import java.util.Locale;

final class KillResultEventFormatter {
	private KillResultEventFormatter() {
	}

	static VisibleFunctionEventText format(
		CommandTraceContext.CommandContext commandContext,
		Collection<? extends Entity> targets,
		int affectedTargets
	) {
		String subject = EntityTargetFormatter.summary(targets);
		String summary = String.format(Locale.ROOT, "%d/%d targets killed", affectedTargets, targets.size());

		StringBuilder basic = new StringBuilder();
		appendCommandContext(basic, commandContext);
		appendFields(basic, targets, affectedTargets);

		StringBuilder detailed = new StringBuilder();
		appendCommandContext(detailed, commandContext);
		appendFields(detailed, targets, affectedTargets);
		appendField(detailed, "target_preview", EntityTargetFormatter.preview(targets));

		return new VisibleFunctionEventText("EVENT", "entity_killed " + subject, summary, basic.toString(), detailed.toString());
	}

	private static void appendFields(StringBuilder text, Collection<? extends Entity> targets, int affectedTargets) {
		appendField(text, "event_type", "entity");
		appendField(text, "event_action", "entity_killed");
		appendField(text, "matched_targets", Integer.toString(targets.size()));
		appendField(text, "affected_targets", Integer.toString(affectedTargets));
		appendField(text, "targets", "aggregate");
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
