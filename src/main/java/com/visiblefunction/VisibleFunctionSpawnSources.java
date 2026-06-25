package com.visiblefunction;

import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntitySpawnReason;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

public final class VisibleFunctionSpawnSources {
	private static final Map<UUID, EntitySpawnReason> OVERRIDES = new ConcurrentHashMap<>();

	private VisibleFunctionSpawnSources() {
	}

	public static void mark(Entity entity, EntitySpawnReason spawnReason) {
		if (entity != null && spawnReason != null) {
			OVERRIDES.put(entity.getUUID(), spawnReason);
		}
	}

	static EntitySpawnReason consume(UUID uuid, EntitySpawnReason fallback) {
		EntitySpawnReason spawnReason = OVERRIDES.remove(uuid);
		return spawnReason == null ? fallback : spawnReason;
	}
}
