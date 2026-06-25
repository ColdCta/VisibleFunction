package com.visiblefunction.mixin;

import com.visiblefunction.CommandTraceContext;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.BaseCommandBlock;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(BaseCommandBlock.class)
abstract class BaseCommandBlockMixin {
	@Inject(method = "performCommand", at = @At("HEAD"))
	private void visiblefunction$enterCommandBlockTrace(ServerLevel level, CallbackInfoReturnable<Boolean> callbackInfo) {
		CommandTraceContext.enterSourceOverride("command_block");
	}

	@Inject(method = "performCommand", at = @At("RETURN"))
	private void visiblefunction$exitCommandBlockTrace(ServerLevel level, CallbackInfoReturnable<Boolean> callbackInfo) {
		CommandTraceContext.clearSourceOverride();
	}
}
