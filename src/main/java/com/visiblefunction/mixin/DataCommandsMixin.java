package com.visiblefunction.mixin;

import com.mojang.brigadier.context.CommandContext;
import com.visiblefunction.CommandTraceContext;
import com.visiblefunction.DataStorageCommandParts;
import com.visiblefunction.DataStorageResultEventFormatter;
import com.visiblefunction.VisibleFunction;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.arguments.NbtPathArgument;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.Tag;
import net.minecraft.resources.Identifier;
import net.minecraft.server.commands.data.DataAccessor;
import net.minecraft.server.commands.data.DataCommands;
import net.minecraft.server.commands.data.StorageDataAccessor;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Coerce;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

import java.util.List;
import java.util.Map;

@Mixin(DataCommands.class)
abstract class DataCommandsMixin {
	@Inject(
		method = "getData(Lnet/minecraft/commands/CommandSourceStack;Lnet/minecraft/server/commands/data/DataAccessor;)I",
		at = @At("RETURN")
	)
	private static void visiblefunction$recordStorageRootRead(
		CommandSourceStack source,
		DataAccessor accessor,
		CallbackInfoReturnable<Integer> callbackInfo
	) {
		Identifier storage = storageId(accessor);
		if (storage == null) {
			return;
		}

		Map<String, String> fields = DataStorageResultEventFormatter.fields();
		fields.put("value", previewData(accessor));
		VisibleFunction.recordDataStorageResult(source, "storage_read", storage, "root", "get", true, callbackInfo.getReturnValue(), fields);
	}

	@Inject(
		method = "getData(Lnet/minecraft/commands/CommandSourceStack;Lnet/minecraft/server/commands/data/DataAccessor;Lnet/minecraft/commands/arguments/NbtPathArgument$NbtPath;)I",
		at = @At("RETURN")
	)
	private static void visiblefunction$recordStoragePathRead(
		CommandSourceStack source,
		DataAccessor accessor,
		NbtPathArgument.NbtPath path,
		CallbackInfoReturnable<Integer> callbackInfo
	) {
		Identifier storage = storageId(accessor);
		if (storage == null) {
			return;
		}

		Map<String, String> fields = DataStorageResultEventFormatter.fields();
		fields.put("value", previewPath(accessor, path));
		VisibleFunction.recordDataStorageResult(source, "storage_read", storage, path.asString(), "get", true, callbackInfo.getReturnValue(), fields);
	}

	@Inject(
		method = "getNumeric(Lnet/minecraft/commands/CommandSourceStack;Lnet/minecraft/server/commands/data/DataAccessor;Lnet/minecraft/commands/arguments/NbtPathArgument$NbtPath;D)I",
		at = @At("RETURN")
	)
	private static void visiblefunction$recordStorageNumericRead(
		CommandSourceStack source,
		DataAccessor accessor,
		NbtPathArgument.NbtPath path,
		double scale,
		CallbackInfoReturnable<Integer> callbackInfo
	) {
		Identifier storage = storageId(accessor);
		if (storage == null) {
			return;
		}

		Map<String, String> fields = DataStorageResultEventFormatter.fields();
		fields.put("scale", Double.toString(scale));
		fields.put("value", previewPath(accessor, path));
		VisibleFunction.recordDataStorageResult(source, "storage_read", storage, path.asString(), "get", true, callbackInfo.getReturnValue(), fields);
	}

	@Inject(
		method = "mergeData(Lnet/minecraft/commands/CommandSourceStack;Lnet/minecraft/server/commands/data/DataAccessor;Lnet/minecraft/nbt/CompoundTag;)I",
		at = @At("RETURN")
	)
	private static void visiblefunction$recordStorageMerged(
		CommandSourceStack source,
		DataAccessor accessor,
		CompoundTag tag,
		CallbackInfoReturnable<Integer> callbackInfo
	) {
		Identifier storage = storageId(accessor);
		if (storage == null) {
			return;
		}

		Map<String, String> fields = DataStorageResultEventFormatter.fields();
		fields.put("value", DataStorageResultEventFormatter.preview(tag));
		fields.put("after", previewData(accessor));
		VisibleFunction.recordDataStorageResult(source, "storage_merged", storage, "root", "merge", false, callbackInfo.getReturnValue(), fields);
	}

	@Inject(
		method = "removeData(Lnet/minecraft/commands/CommandSourceStack;Lnet/minecraft/server/commands/data/DataAccessor;Lnet/minecraft/commands/arguments/NbtPathArgument$NbtPath;)I",
		at = @At("RETURN")
	)
	private static void visiblefunction$recordStorageRemoved(
		CommandSourceStack source,
		DataAccessor accessor,
		NbtPathArgument.NbtPath path,
		CallbackInfoReturnable<Integer> callbackInfo
	) {
		Identifier storage = storageId(accessor);
		if (storage == null) {
			return;
		}

		Map<String, String> fields = DataStorageResultEventFormatter.fields();
		fields.put("after", previewData(accessor));
		VisibleFunction.recordDataStorageResult(source, "storage_removed", storage, path.asString(), "remove", false, callbackInfo.getReturnValue(), fields);
	}

	@Inject(
		method = "manipulateData(Lcom/mojang/brigadier/context/CommandContext;Lnet/minecraft/server/commands/data/DataCommands$DataProvider;Lnet/minecraft/server/commands/data/DataCommands$DataManipulator;Ljava/util/List;)I",
		at = @At("RETURN")
	)
	private static void visiblefunction$recordStorageModified(
		CommandContext<CommandSourceStack> context,
		DataCommands.DataProvider targetProvider,
		@Coerce Object manipulator,
		List<Tag> sourceTags,
		CallbackInfoReturnable<Integer> callbackInfo
	) {
		DataAccessor accessor;
		try {
			accessor = targetProvider.access(context);
		} catch (Exception ignored) {
			return;
		}

		Identifier storage = storageId(accessor);
		if (storage == null) {
			return;
		}

		CommandSourceStack source = context.getSource();
		CommandTraceContext.CommandContext commandContext = CommandTraceContext.currentOrRecent(source.getServer());
		DataStorageCommandParts parts = DataStorageCommandParts.parse(commandContext == null ? "" : commandContext.effectiveCommand());
		Map<String, String> fields = DataStorageResultEventFormatter.fields();
		fields.put("modifier", parts.modifier());
		fields.put("value", DataStorageResultEventFormatter.preview(parts.value()));
		fields.put("source_tag_count", Integer.toString(sourceTags.size()));
		fields.put("source_preview", previewTags(sourceTags));
		fields.put("after", previewData(accessor));
		VisibleFunction.recordDataStorageResult(source, "storage_modified", storage, parts.path(), parts.operation(), false, callbackInfo.getReturnValue(), fields);
	}

	private static Identifier storageId(DataAccessor accessor) {
		if (accessor instanceof StorageDataAccessor storageAccessor) {
			return ((StorageDataAccessorAccessor) storageAccessor).visiblefunction$getId();
		}

		return null;
	}

	private static String previewData(DataAccessor accessor) {
		try {
			return DataStorageResultEventFormatter.preview(accessor.getData());
		} catch (Exception ignored) {
			return "unavailable";
		}
	}

	private static String previewPath(DataAccessor accessor, NbtPathArgument.NbtPath path) {
		try {
			return DataStorageResultEventFormatter.preview(DataCommands.getSingleTag(path, accessor));
		} catch (Exception ignored) {
			return "unavailable";
		}
	}

	private static String previewTags(List<Tag> tags) {
		if (tags.isEmpty()) {
			return "[]";
		}

		StringBuilder preview = new StringBuilder("[");
		for (int index = 0; index < tags.size(); index++) {
			if (index > 0) {
				preview.append(", ");
			}
			if (index >= 4) {
				preview.append("...");
				break;
			}
			preview.append(DataStorageResultEventFormatter.preview(tags.get(index)));
		}
		preview.append("]");
		return DataStorageResultEventFormatter.preview(preview.toString());
	}
}
