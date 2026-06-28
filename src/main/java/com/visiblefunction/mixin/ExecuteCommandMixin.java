package com.visiblefunction.mixin;

import com.visiblefunction.CommandTraceContext;
import com.visiblefunction.VisibleFunction;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.ExecutionCommandSource;
import net.minecraft.commands.execution.ExecutionContext;
import net.minecraft.commands.execution.Frame;
import net.minecraft.commands.execution.tasks.ExecuteCommand;
import org.spongepowered.asm.mixin.Final;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(ExecuteCommand.class)
abstract class ExecuteCommandMixin {
	@Shadow
	@Final
	private String commandInput;

	@Unique
	private CommandTraceContext.CommandContext visiblefunction$commandContext;

	@Inject(
		method = "execute(Lnet/minecraft/commands/ExecutionCommandSource;Lnet/minecraft/commands/execution/ExecutionContext;Lnet/minecraft/commands/execution/Frame;)V",
		at = @At("HEAD")
	)
	private void visiblefunction$pushCommandContext(ExecutionCommandSource<?> source, ExecutionContext<?> context, Frame frame, CallbackInfo callbackInfo) {
		if (source instanceof CommandSourceStack commandSourceStack) {
			visiblefunction$commandContext = CommandTraceContext.push(
				commandInput,
				commandSourceStack,
				CommandTraceContext.functionFor(frame),
				CommandTraceContext.functionCallIdFor(frame),
				CommandTraceContext.functionIsTickFor(frame),
				CommandTraceContext.triggerFor(frame)
			);
			VisibleFunction.recordCommandTrace(visiblefunction$commandContext);
		}
	}

	@Inject(
		method = "execute(Lnet/minecraft/commands/ExecutionCommandSource;Lnet/minecraft/commands/execution/ExecutionContext;Lnet/minecraft/commands/execution/Frame;)V",
		at = @At("RETURN")
	)
	private void visiblefunction$retainCommandContext(ExecutionCommandSource<?> source, ExecutionContext<?> context, Frame frame, CallbackInfo callbackInfo) {
		if (visiblefunction$commandContext != null) {
			CommandTraceContext.pop(visiblefunction$commandContext);
			visiblefunction$commandContext = null;
		}
	}
}
