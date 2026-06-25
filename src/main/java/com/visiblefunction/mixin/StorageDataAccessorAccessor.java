package com.visiblefunction.mixin;

import net.minecraft.resources.Identifier;
import net.minecraft.server.commands.data.StorageDataAccessor;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

@Mixin(StorageDataAccessor.class)
public interface StorageDataAccessorAccessor {
	@Accessor("id")
	Identifier visiblefunction$getId();
}
