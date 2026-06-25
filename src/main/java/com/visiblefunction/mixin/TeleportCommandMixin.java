package com.visiblefunction.mixin;

import com.visiblefunction.TeleportResultEventFormatter;
import com.visiblefunction.VisibleFunction;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.server.commands.LookAt;
import net.minecraft.server.commands.TeleportCommand;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.Relative;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@Mixin(TeleportCommand.class)
abstract class TeleportCommandMixin {
	private static final ThreadLocal<Map<UUID, String>> visiblefunction$fromPositions = ThreadLocal.withInitial(HashMap::new);

	@Inject(
		method = "performTeleport(Lnet/minecraft/commands/CommandSourceStack;Lnet/minecraft/world/entity/Entity;Lnet/minecraft/server/level/ServerLevel;DDDLjava/util/Set;FFLnet/minecraft/server/commands/LookAt;)V",
		at = @At("HEAD")
	)
	private static void visiblefunction$captureTeleportStart(
		CommandSourceStack source,
		Entity target,
		ServerLevel level,
		double x,
		double y,
		double z,
		Set<Relative> relatives,
		float yaw,
		float pitch,
		LookAt facing,
		CallbackInfo callbackInfo
	) {
		visiblefunction$fromPositions.get().put(target.getUUID(), TeleportResultEventFormatter.formatPosition(target.getX(), target.getY(), target.getZ()));
	}

	@Inject(
		method = "performTeleport(Lnet/minecraft/commands/CommandSourceStack;Lnet/minecraft/world/entity/Entity;Lnet/minecraft/server/level/ServerLevel;DDDLjava/util/Set;FFLnet/minecraft/server/commands/LookAt;)V",
		at = @At("RETURN")
	)
	private static void visiblefunction$recordTeleportedEntity(
		CommandSourceStack source,
		Entity target,
		ServerLevel level,
		double x,
		double y,
		double z,
		Set<Relative> relatives,
		float yaw,
		float pitch,
		LookAt facing,
		CallbackInfo callbackInfo
	) {
		Map<UUID, String> fromPositions = visiblefunction$fromPositions.get();
		String from = fromPositions.remove(target.getUUID());
		if (fromPositions.isEmpty()) {
			visiblefunction$fromPositions.remove();
		}

		VisibleFunction.recordTeleportResult(
			source,
			target,
			from == null ? "unknown" : from,
			TeleportResultEventFormatter.formatPosition(target.getX(), target.getY(), target.getZ()),
			level.dimension().identifier(),
			relatives,
			yaw,
			pitch
		);
	}
}
