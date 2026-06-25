package com.visiblefunction;

import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.entity.Entity;

import java.util.Collection;

final class EntityTargetFormatter {
	private static final int MAX_TARGET_PREVIEW = 4;

	private EntityTargetFormatter() {
	}

	static String summary(Collection<? extends Entity> targets) {
		if (targets.isEmpty()) {
			return "0 targets";
		}

		if (targets.size() == 1) {
			Entity entity = targets.iterator().next();
			return entityType(entity);
		}

		return targets.size() + " targets";
	}

	static String preview(Collection<? extends Entity> targets) {
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
			preview.append(entityType(entity))
				.append(" ")
				.append(entity.getUUID());
			index++;
		}
		preview.append("]");
		return preview.toString();
	}

	private static String entityType(Entity entity) {
		return BuiltInRegistries.ENTITY_TYPE.getKey(entity.getType()).toString();
	}
}
