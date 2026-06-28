package com.visiblefunction.mixin;

import com.llamalad7.mixinextras.injector.wrapmethod.WrapMethod;
import com.llamalad7.mixinextras.injector.wrapoperation.Operation;
import com.visiblefunction.CommandTraceContext;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.item.enchantment.EnchantedItemInUse;
import net.minecraft.world.item.enchantment.effects.RunFunction;
import net.minecraft.world.phys.Vec3;
import org.spongepowered.asm.mixin.Mixin;

@Mixin(RunFunction.class)
abstract class RunFunctionMixin {
	@WrapMethod(method = "apply")
	private void visiblefunction$traceEnchantmentFunction(
		ServerLevel level,
		int enchantmentLevel,
		EnchantedItemInUse item,
		Entity entity,
		Vec3 position,
		Operation<Void> original
	) {
		CommandTraceContext.TriggerContext trigger = CommandTraceContext.enterEnchantmentTrigger(
			(RunFunction) (Object) this,
			level,
			entity,
			position
		);
		try {
			original.call(level, enchantmentLevel, item, entity, position);
		} finally {
			CommandTraceContext.exitTrigger(trigger);
		}
	}
}
