package com.visiblefunction.mixin;

import com.visiblefunction.CommandTraceContext;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.functions.CommandFunction;
import net.minecraft.resources.Identifier;
import net.minecraft.server.ServerFunctionManager;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

import java.util.Collection;

@Mixin(ServerFunctionManager.class)
abstract class ServerFunctionManagerMixin {
	@Inject(
		method = "executeTagFunctions(Ljava/util/Collection;Lnet/minecraft/resources/Identifier;)V",
		at = @At("HEAD")
	)
	private void visiblefunction$enterTickFunctionDispatch(
		Collection<CommandFunction<CommandSourceStack>> functions,
		Identifier tag,
		CallbackInfo callbackInfo
	) {
		if ("minecraft:tick".equals(tag.toString())) {
			CommandTraceContext.enterTickFunctionDispatch();
		}
	}

	@Inject(
		method = "executeTagFunctions(Ljava/util/Collection;Lnet/minecraft/resources/Identifier;)V",
		at = @At("RETURN")
	)
	private void visiblefunction$exitTickFunctionDispatch(
		Collection<CommandFunction<CommandSourceStack>> functions,
		Identifier tag,
		CallbackInfo callbackInfo
	) {
		if ("minecraft:tick".equals(tag.toString())) {
			CommandTraceContext.exitTickFunctionDispatch();
		}
	}
}
