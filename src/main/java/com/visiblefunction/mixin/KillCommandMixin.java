package com.visiblefunction.mixin;

import com.visiblefunction.VisibleFunction;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.server.commands.KillCommand;
import net.minecraft.world.entity.Entity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

import java.util.Collection;

@Mixin(KillCommand.class)
abstract class KillCommandMixin {
	@Inject(
		method = "kill(Lnet/minecraft/commands/CommandSourceStack;Ljava/util/Collection;)I",
		at = @At("RETURN")
	)
	private static void visiblefunction$recordKilledEntities(
		CommandSourceStack source,
		Collection<? extends Entity> targets,
		CallbackInfoReturnable<Integer> callbackInfo
	) {
		VisibleFunction.recordKillResult(source, targets, callbackInfo.getReturnValue());
	}
}
