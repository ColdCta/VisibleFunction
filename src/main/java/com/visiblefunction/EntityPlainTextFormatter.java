package com.visiblefunction;

import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntitySpawnReason;
import net.minecraft.world.entity.LivingEntity;

import java.util.Locale;

final class EntityPlainTextFormatter {
	private EntityPlainTextFormatter() {
	}

	static String formatSpawn(Entity entity, ServerLevel level, EntitySpawnReason spawnReason) {
		return formatSpawnEvent(entity, level, spawnReason, null).detailed();
	}

	static VisibleFunctionEventText formatSpawnEvent(Entity entity, ServerLevel level, EntitySpawnReason spawnReason) {
		return formatSpawnEvent(entity, level, spawnReason, null);
	}

	static VisibleFunctionEventText formatSpawnEvent(
		Entity entity,
		ServerLevel level,
		EntitySpawnReason spawnReason,
		CommandTraceContext.CommandContext commandContext
	) {
		String entityId = BuiltInRegistries.ENTITY_TYPE.getKey(entity.getType()).toString();
		String displayName = entity.getName().getString();
		String action = spawnAction(spawnReason);
		String source = spawnSource(spawnReason);

		String summary = action + " by " + source + ".";
		StringBuilder basic = new StringBuilder();
		appendCommandContext(basic, commandContext, source, formatPosition(entity));
		appendField(basic, "spawn_reason", spawnReasonName(spawnReason));
		appendField(basic, "entity_position", formatPosition(entity));

		if (entity instanceof LivingEntity livingEntity) {
			appendField(basic, "health", String.format(Locale.ROOT, "%.1f/%.1f", livingEntity.getHealth(), livingEntity.getMaxHealth()));
		}

		StringBuilder detailed = new StringBuilder();
		appendField(detailed, "name", displayName);
		appendField(detailed, "entity_id", entityId);
		appendField(detailed, "uuid", entity.getUUID().toString());
		appendCommandContext(detailed, commandContext, source, formatPosition(entity));
		appendField(detailed, "spawn_reason", spawnReasonName(spawnReason));
		appendField(detailed, "dimension", level.dimension().identifier().toString());
		appendField(detailed, "entity_position", formatPosition(entity));
		appendField(detailed, "rotation", formatRotation(entity));
		appendField(detailed, "passengers", Integer.toString(entity.getPassengers().size()));
		appendField(detailed, "vehicle", entity.getVehicle() == null ? "none" : BuiltInRegistries.ENTITY_TYPE.getKey(entity.getVehicle().getType()).toString());
		appendField(detailed, "tags", entity.entityTags().isEmpty() ? "[]" : entity.entityTags().toString());

		if (entity instanceof LivingEntity livingEntity) {
			appendField(detailed, "health", String.format(Locale.ROOT, "%.1f/%.1f", livingEntity.getHealth(), livingEntity.getMaxHealth()));
			appendField(detailed, "armor", Integer.toString(livingEntity.getArmorValue()));
			appendField(detailed, "alive", Boolean.toString(livingEntity.isAlive()));
			appendField(detailed, "baby", Boolean.toString(livingEntity.isBaby()));
			appendField(detailed, "active_effects", Integer.toString(livingEntity.getActiveEffects().size()));
		}

		return new VisibleFunctionEventText("EVENT", entityId, summary, basic.toString(), detailed.toString());
	}

	static String formatSpawnSummary(Entity entity, EntitySpawnReason spawnReason) {
		String entityId = BuiltInRegistries.ENTITY_TYPE.getKey(entity.getType()).toString();
		return String.format(
			Locale.ROOT,
			"[ EVENT ] %s %s by %s at %.2f %.2f %.2f (%s)",
			entityId,
			spawnAction(spawnReason),
			spawnSource(spawnReason),
			entity.getX(),
			entity.getY(),
			entity.getZ(),
			spawnReasonName(spawnReason)
		);
	}

	private static void appendField(StringBuilder text, String name, String value) {
		text.append("- ")
			.append(name)
			.append(": ")
			.append(value)
			.append("\n");
	}

	private static void appendCommandContext(
		StringBuilder text,
		CommandTraceContext.CommandContext commandContext,
		String fallbackSource,
		String fallbackPosition
	) {
		if (commandContext == null) {
			appendField(text, "command", "none");
			appendField(text, "command_id", "none");
			appendField(text, "source", fallbackSource);
			appendField(text, "function", "none");
			appendField(text, "function_call_id", "none");
			appendField(text, "position", fallbackPosition);
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

	private static String formatPosition(Entity entity) {
		return String.format(Locale.ROOT, "x=%.2f, y=%.2f, z=%.2f", entity.getX(), entity.getY(), entity.getZ());
	}

	private static String formatRotation(Entity entity) {
		return String.format(Locale.ROOT, "yaw=%.2f, pitch=%.2f", entity.getYRot(), entity.getXRot());
	}

	private static String spawnAction(EntitySpawnReason spawnReason) {
		return switch (spawnReason) {
			case COMMAND, MOB_SUMMONED -> "summoned";
			case null -> "spawned";
			default -> "spawned";
		};
	}

	private static String spawnReasonName(EntitySpawnReason spawnReason) {
		return spawnReason == null ? "UNKNOWN" : spawnReason.name();
	}

	private static String spawnSource(EntitySpawnReason spawnReason) {
		return switch (spawnReason) {
			case COMMAND, MOB_SUMMONED -> "commands";
			case SPAWNER, TRIAL_SPAWNER -> "spawner";
			case NATURAL -> "natural";
			case SPAWN_ITEM_USE, BUCKET -> "item";
			case STRUCTURE, CHUNK_GENERATION -> "world_generation";
			case BREEDING -> "breeding";
			case DIMENSION_TRAVEL -> "dimension_travel";
			case null -> "unknown";
			default -> "game";
		};
	}
}
