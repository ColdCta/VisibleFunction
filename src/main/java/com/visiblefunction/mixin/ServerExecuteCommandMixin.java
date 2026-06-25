package com.visiblefunction.mixin;

import com.visiblefunction.CommandTraceContext;
import com.visiblefunction.ExecuteStoreTraceContext;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.arguments.NbtPathArgument;
import net.minecraft.nbt.Tag;
import net.minecraft.server.commands.ExecuteCommand;
import net.minecraft.server.commands.data.DataAccessor;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

import java.util.function.IntFunction;

@Mixin(ExecuteCommand.class)
abstract class ServerExecuteCommandMixin {
	@Inject(
		method = "storeData",
		at = @At("HEAD"),
		require = 0
	)
	private static void visiblefunction$rememberExecuteStoreData(
		CommandSourceStack source,
		DataAccessor accessor,
		NbtPathArgument.NbtPath path,
		IntFunction<Tag> tagFactory,
		boolean storeResult,
		CallbackInfoReturnable<CommandSourceStack> callbackInfo
	) {
		ExecuteStoreTraceContext.remember(
			accessor,
			path,
			storeResult,
			CommandTraceContext.currentOrRecent(source.getServer())
		);
	}

	@Inject(
		method = "lambda$storeData$0",
		at = @At("RETURN"),
		require = 0
	)
	private static void visiblefunction$recordExecuteStoreData(
		DataAccessor accessor,
		boolean storeResult,
		NbtPathArgument.NbtPath path,
		IntFunction<Tag> tagFactory,
		boolean success,
		int result,
		CallbackInfo callbackInfo
	) {
		ExecuteStoreTraceContext.recordStoredData(accessor, path, tagFactory, success, result);
	}
}
