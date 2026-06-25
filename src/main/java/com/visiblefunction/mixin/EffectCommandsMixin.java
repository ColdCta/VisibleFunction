package com.visiblefunction.mixin;

import com.visiblefunction.VisibleFunction;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.core.Holder;
import net.minecraft.server.commands.EffectCommands;
import net.minecraft.world.effect.MobEffect;
import net.minecraft.world.entity.Entity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

import java.util.Collection;

@Mixin(EffectCommands.class)
abstract class EffectCommandsMixin {
	@Inject(
		method = "giveEffect(Lnet/minecraft/commands/CommandSourceStack;Ljava/util/Collection;Lnet/minecraft/core/Holder;Ljava/lang/Integer;IZ)I",
		at = @At("RETURN")
	)
	private static void visiblefunction$recordEffectGiven(
		CommandSourceStack source,
		Collection<? extends Entity> targets,
		Holder<MobEffect> effect,
		Integer duration,
		int amplifier,
		boolean hideParticles,
		CallbackInfoReturnable<Integer> callbackInfo
	) {
		VisibleFunction.recordEffectResult(source, targets, "give", effect, duration, amplifier, hideParticles, callbackInfo.getReturnValue());
	}

	@Inject(
		method = "clearEffects(Lnet/minecraft/commands/CommandSourceStack;Ljava/util/Collection;)I",
		at = @At("RETURN")
	)
	private static void visiblefunction$recordEffectsCleared(
		CommandSourceStack source,
		Collection<? extends Entity> targets,
		CallbackInfoReturnable<Integer> callbackInfo
	) {
		VisibleFunction.recordEffectResult(source, targets, "clear", null, null, 0, false, callbackInfo.getReturnValue());
	}

	@Inject(
		method = "clearEffect(Lnet/minecraft/commands/CommandSourceStack;Ljava/util/Collection;Lnet/minecraft/core/Holder;)I",
		at = @At("RETURN")
	)
	private static void visiblefunction$recordEffectCleared(
		CommandSourceStack source,
		Collection<? extends Entity> targets,
		Holder<MobEffect> effect,
		CallbackInfoReturnable<Integer> callbackInfo
	) {
		VisibleFunction.recordEffectResult(source, targets, "clear", effect, null, 0, false, callbackInfo.getReturnValue());
	}
}
