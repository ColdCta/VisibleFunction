package com.visiblefunction.mixin;

import com.llamalad7.mixinextras.injector.wrapmethod.WrapMethod;
import com.llamalad7.mixinextras.injector.wrapoperation.Operation;
import com.visiblefunction.CommandTraceContext;
import net.minecraft.advancements.AdvancementRewards;
import net.minecraft.server.level.ServerPlayer;
import org.spongepowered.asm.mixin.Mixin;

@Mixin(AdvancementRewards.class)
abstract class AdvancementRewardsMixin {
	@WrapMethod(method = "grant")
	private void visiblefunction$traceRewardFunction(ServerPlayer player, Operation<Void> original) {
		CommandTraceContext.TriggerContext trigger = CommandTraceContext.enterAdvancementTrigger(
			(AdvancementRewards) (Object) this,
			player
		);
		try {
			original.call(player);
		} finally {
			CommandTraceContext.exitTrigger(trigger);
		}
	}
}
