package com.visiblefunction.mixin;

import com.visiblefunction.CommandTraceContext;
import net.minecraft.commands.ExecutionCommandSource;
import net.minecraft.commands.execution.ExecutionContext;
import net.minecraft.commands.execution.Frame;
import net.minecraft.commands.execution.tasks.CallFunction;
import net.minecraft.commands.functions.InstantiatedFunction;
import org.spongepowered.asm.mixin.Final;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyArg;

@Mixin(CallFunction.class)
abstract class CallFunctionMixin {
	@Shadow
	@Final
	private InstantiatedFunction<?> function;

	@ModifyArg(
		method = "execute(Lnet/minecraft/commands/ExecutionCommandSource;Lnet/minecraft/commands/execution/ExecutionContext;Lnet/minecraft/commands/execution/Frame;)V",
		at = @At(
			value = "INVOKE",
			target = "Lnet/minecraft/commands/execution/tasks/ContinuationTask;schedule(Lnet/minecraft/commands/execution/ExecutionContext;Lnet/minecraft/commands/execution/Frame;Ljava/util/List;Lnet/minecraft/commands/execution/tasks/ContinuationTask$TaskProvider;)V"
		),
		index = 1
	)
	private Frame visiblefunction$markFunctionFrame(Frame frame) {
		CommandTraceContext.markFunctionFrame(frame, function.id());
		return frame;
	}
}
