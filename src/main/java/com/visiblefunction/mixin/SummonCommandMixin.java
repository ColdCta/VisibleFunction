package com.visiblefunction.mixin;

import com.visiblefunction.VisibleFunctionSpawnSources;
import net.minecraft.server.commands.SummonCommand;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntitySpawnReason;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyArg;

@Mixin(SummonCommand.class)
abstract class SummonCommandMixin {
	@ModifyArg(
		method = "createEntity",
		at = @At(
			value = "INVOKE",
			target = "Lnet/minecraft/server/level/ServerLevel;tryAddFreshEntityWithPassengers(Lnet/minecraft/world/entity/Entity;)Z"
		),
		index = 0
	)
	private static Entity visiblefunction$markCommandSummonedEntity(Entity entity) {
		VisibleFunctionSpawnSources.mark(entity, EntitySpawnReason.COMMAND);
		return entity;
	}
}
