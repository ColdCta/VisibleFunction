package com.visiblefunction;

import net.minecraft.core.Holder;
import net.minecraft.world.effect.MobEffect;
import net.minecraft.world.entity.Entity;

import java.util.Collection;
import java.util.Locale;

final class EffectResultEventFormatter {
	private EffectResultEventFormatter() {
	}

	static VisibleFunctionEventText format(
		CommandTraceContext.CommandContext commandContext,
		Collection<? extends Entity> targets,
		String operation,
		Holder<MobEffect> effect,
		Integer duration,
		int amplifier,
		boolean hideParticles,
		int affectedTargets
	) {
		String effectId = effectId(effect);
		String action = "clear".equals(operation) ? "effect_cleared" : "effect_applied";
		String subject = "effect_cleared".equals(action) ? effectId : effectId;
		String summary = summary(action, effectId, targets, affectedTargets);

		StringBuilder basic = new StringBuilder();
		appendCommandContext(basic, commandContext);
		appendFields(basic, targets, operation, action, effectId, duration, amplifier, hideParticles, affectedTargets);

		StringBuilder detailed = new StringBuilder();
		appendCommandContext(detailed, commandContext);
		appendFields(detailed, targets, operation, action, effectId, duration, amplifier, hideParticles, affectedTargets);
		appendField(detailed, "target_preview", EntityTargetFormatter.preview(targets));

		return new VisibleFunctionEventText("EVENT", action + " " + subject, summary, basic.toString(), detailed.toString());
	}

	private static void appendFields(
		StringBuilder text,
		Collection<? extends Entity> targets,
		String operation,
		String action,
		String effectId,
		Integer duration,
		int amplifier,
		boolean hideParticles,
		int affectedTargets
	) {
		appendField(text, "event_type", "effect");
		appendField(text, "event_action", action);
		appendField(text, "mode", operation);
		appendField(text, "effect", effectId);
		appendField(text, "matched_targets", Integer.toString(targets.size()));
		appendField(text, "affected_targets", Integer.toString(affectedTargets));
		appendField(text, "targets", "aggregate");
		appendField(text, "query", "false");

		if ("give".equals(operation)) {
			appendField(text, "duration_ticks", duration == null ? "default" : Integer.toString(duration));
			appendField(text, "duration_seconds", duration == null ? "default" : formatSeconds(duration));
			appendField(text, "amplifier", Integer.toString(amplifier));
			appendField(text, "hide_particles", Boolean.toString(hideParticles));
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

	private static String effectId(Holder<MobEffect> effect) {
		if (effect == null) {
			return "all";
		}

		return effect.unwrapKey()
			.map(key -> key.identifier().toString())
			.orElse(effect.value().getDescriptionId());
	}

	private static String summary(String action, String effectId, Collection<? extends Entity> targets, int affectedTargets) {
		if ("effect_cleared".equals(action)) {
			return String.format(Locale.ROOT, "%s cleared from %d/%d targets", effectId, affectedTargets, targets.size());
		}

		return String.format(Locale.ROOT, "%s applied to %d/%d targets", effectId, affectedTargets, targets.size());
	}

	private static String formatSeconds(int ticks) {
		if (ticks % 20 == 0) {
			return Integer.toString(ticks / 20);
		}

		return String.format(Locale.ROOT, "%.2f", ticks / 20.0D);
	}

	private static void appendField(StringBuilder text, String name, String value) {
		text.append("- ")
			.append(name)
			.append(": ")
			.append(value)
			.append("\n");
	}
}
