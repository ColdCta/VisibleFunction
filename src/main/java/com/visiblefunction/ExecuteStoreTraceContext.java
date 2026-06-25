package com.visiblefunction;

import net.minecraft.commands.arguments.NbtPathArgument;
import net.minecraft.nbt.Tag;
import net.minecraft.resources.Identifier;
import net.minecraft.server.commands.data.DataAccessor;
import net.minecraft.server.commands.data.StorageDataAccessor;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.function.IntFunction;

public final class ExecuteStoreTraceContext {
	private static final List<PendingStore> PENDING_STORES = new ArrayList<>();

	private ExecuteStoreTraceContext() {
	}

	public static void remember(DataAccessor accessor, NbtPathArgument.NbtPath path, boolean storeResult, CommandTraceContext.CommandContext context) {
		if (!(accessor instanceof StorageDataAccessor storageAccessor) || context == null) {
			return;
		}

		synchronized (PENDING_STORES) {
			PENDING_STORES.add(new PendingStore(storageAccessor, path.asString(), storeResult, context));
			while (PENDING_STORES.size() > 64) {
				PENDING_STORES.removeFirst();
			}
		}
	}

	public static void recordStoredData(
		DataAccessor accessor,
		NbtPathArgument.NbtPath path,
		IntFunction<Tag> tagFactory,
		boolean success,
		int result
	) {
		if (!(accessor instanceof StorageDataAccessor storageAccessor)) {
			return;
		}

		PendingStore pendingStore = consume(storageAccessor, path.asString());
		if (pendingStore == null) {
			return;
		}

		int storedValue = pendingStore.storeResult() ? result : success ? 1 : 0;
		Identifier storage = com.visiblefunction.mixin.StorageDataAccessorAccessor.class.cast(storageAccessor).visiblefunction$getId();
		var fields = DataStorageResultEventFormatter.fields();
		fields.put("modifier", pendingStore.storeResult() ? "store result" : "store success");
		fields.put("value", previewStoredValue(tagFactory, storedValue));
		fields.put("stored_numeric_value", Integer.toString(storedValue));
		fields.put("after", previewData(accessor));
		VisibleFunction.recordDataStorageResult(
			pendingStore.context(),
			"storage_modified",
			storage,
			pendingStore.path(),
			pendingStore.storeResult() ? "execute_store_result" : "execute_store_success",
			false,
			storedValue,
			fields
		);
	}

	private static PendingStore consume(StorageDataAccessor accessor, String path) {
		synchronized (PENDING_STORES) {
			Iterator<PendingStore> iterator = PENDING_STORES.iterator();
			while (iterator.hasNext()) {
				PendingStore pendingStore = iterator.next();
				if (pendingStore.matches(accessor, path)) {
					iterator.remove();
					return pendingStore;
				}
			}
		}

		return null;
	}

	private static String previewStoredValue(IntFunction<Tag> tagFactory, int value) {
		try {
			return DataStorageResultEventFormatter.preview(tagFactory.apply(value));
		} catch (Exception ignored) {
			return Integer.toString(value);
		}
	}

	private static String previewData(DataAccessor accessor) {
		try {
			return DataStorageResultEventFormatter.preview(accessor.getData());
		} catch (Exception ignored) {
			return "unavailable";
		}
	}

	private record PendingStore(StorageDataAccessor accessor, String path, boolean storeResult, CommandTraceContext.CommandContext context) {
		private boolean matches(StorageDataAccessor otherAccessor, String otherPath) {
			return accessor == otherAccessor && path.equals(otherPath);
		}
	}
}
