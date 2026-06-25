package com.visiblefunction.mixin;

import com.visiblefunction.VisibleFunction;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.arguments.item.ItemInput;
import net.minecraft.server.commands.GiveCommand;
import net.minecraft.server.level.ServerPlayer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

import java.util.Collection;

@Mixin(GiveCommand.class)
abstract class GiveCommandMixin {
	@Inject(
		method = "giveItem(Lnet/minecraft/commands/CommandSourceStack;Lnet/minecraft/commands/arguments/item/ItemInput;Ljava/util/Collection;I)I",
		at = @At("RETURN")
	)
	private static void visiblefunction$recordGivenItems(
		CommandSourceStack source,
		ItemInput item,
		Collection<ServerPlayer> targets,
		int count,
		CallbackInfoReturnable<Integer> callbackInfo
	) {
		VisibleFunction.recordItemGiven(source, item, targets, count, callbackInfo.getReturnValue());
	}
}
