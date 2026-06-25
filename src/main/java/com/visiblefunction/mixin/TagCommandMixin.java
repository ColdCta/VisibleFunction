package com.visiblefunction.mixin;

import com.visiblefunction.VisibleFunction;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.server.commands.TagCommand;
import net.minecraft.world.entity.Entity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

import java.util.Collection;

@Mixin(TagCommand.class)
abstract class TagCommandMixin {
	@Inject(
		method = "addTag(Lnet/minecraft/commands/CommandSourceStack;Ljava/util/Collection;Ljava/lang/String;)I",
		at = @At("RETURN")
	)
	private static void visiblefunction$recordTagAdded(
		CommandSourceStack source,
		Collection<? extends Entity> targets,
		String tag,
		CallbackInfoReturnable<Integer> callbackInfo
	) {
		VisibleFunction.recordTagResult(source, targets, "add", tag, callbackInfo.getReturnValue());
	}

	@Inject(
		method = "removeTag(Lnet/minecraft/commands/CommandSourceStack;Ljava/util/Collection;Ljava/lang/String;)I",
		at = @At("RETURN")
	)
	private static void visiblefunction$recordTagRemoved(
		CommandSourceStack source,
		Collection<? extends Entity> targets,
		String tag,
		CallbackInfoReturnable<Integer> callbackInfo
	) {
		VisibleFunction.recordTagResult(source, targets, "remove", tag, callbackInfo.getReturnValue());
	}

	@Inject(
		method = "listTags(Lnet/minecraft/commands/CommandSourceStack;Ljava/util/Collection;)I",
		at = @At("RETURN")
	)
	private static void visiblefunction$recordTagsListed(
		CommandSourceStack source,
		Collection<? extends Entity> targets,
		CallbackInfoReturnable<Integer> callbackInfo
	) {
		VisibleFunction.recordTagResult(source, targets, "list", "none", callbackInfo.getReturnValue());
	}
}
