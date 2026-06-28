package com.visiblefunction;

import net.minecraft.resources.Identifier;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.Relative;

import java.util.Locale;
import java.util.Set;

public final class TeleportResultEventFormatter {
	private TeleportResultEventFormatter() {
	}

	static VisibleFunctionEventText format(
		CommandTraceContext.CommandContext commandContext,
		Entity target,
		String from,
		String to,
		Identifier dimension,
		Set<Relative> relatives,
		float yaw,
		float pitch
	) {
		String subject = EntityTargetFormatter.summary(java.util.List.of(target));
		String summary = subject + " teleported";

		StringBuilder basic = new StringBuilder();
		appendCommandContext(basic, commandContext);
		appendFields(basic, subject, from, to, dimension, relatives, yaw, pitch);

		StringBuilder detailed = new StringBuilder();
		appendCommandContext(detailed, commandContext);
		appendFields(detailed, subject, from, to, dimension, relatives, yaw, pitch);
		appendField(detailed, "target_preview", EntityTargetFormatter.preview(java.util.List.of(target)));

		return new VisibleFunctionEventText("EVENT", "entity_teleported " + subject, summary, basic.toString(), detailed.toString());
	}

	private static void appendFields(
		StringBuilder text,
		String subject,
		String from,
		String to,
		Identifier dimension,
		Set<Relative> relatives,
		float yaw,
		float pitch
	) {
		appendField(text, "event_type", "entity");
		appendField(text, "event_action", "entity_teleported");
		appendField(text, "target", subject);
		appendField(text, "from", from);
		appendField(text, "to", to);
		appendField(text, "dimension", dimension.toString());
		appendField(text, "rotation", formatRotation(yaw, pitch));
		appendField(text, "relative_axes", relatives.isEmpty() ? "none" : relatives.toString());
		appendField(text, "targets", "single");
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
		CommandTraceFormatter.appendTriggerFields(text, commandContext.trigger(), false);
	}

	public static String formatPosition(double x, double y, double z) {
		return String.format(Locale.ROOT, "x=%.2f, y=%.2f, z=%.2f", x, y, z);
	}

	private static String formatRotation(float yaw, float pitch) {
		return String.format(Locale.ROOT, "yaw=%.2f, pitch=%.2f", yaw, pitch);
	}

	private static void appendField(StringBuilder text, String name, String value) {
		text.append("- ")
			.append(name)
			.append(": ")
			.append(value)
			.append("\n");
	}
}
