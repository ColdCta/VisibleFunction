package com.visiblefunction.mixin;

import com.visiblefunction.VisibleFunctionHud;
import net.minecraft.client.Minecraft;
import net.minecraft.client.KeyboardHandler;
import net.minecraft.client.input.KeyEvent;
import org.lwjgl.glfw.GLFW;
import org.spongepowered.asm.mixin.Final;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(KeyboardHandler.class)
abstract class KeyboardHandlerMixin {
	@Shadow
	@Final
	private Minecraft minecraft;

	@Inject(method = "keyPress", at = @At("HEAD"), cancellable = true)
	private void visiblefunction$focusWindow(long window, int action, KeyEvent keyEvent, CallbackInfo callbackInfo) {
		if (window != minecraft.getWindow().handle() || action != GLFW.GLFW_PRESS || minecraft.gui.screen() != null) {
			return;
		}

		if (keyEvent.key() == GLFW.GLFW_KEY_BACKSLASH) {
			VisibleFunctionHud.openScreen();
			callbackInfo.cancel();
			return;
		}

		if (keyEvent.key() == GLFW.GLFW_KEY_RIGHT_BRACKET && minecraft.getConnection() != null) {
			minecraft.getConnection().sendCommand("visiblefunction recording toggle");
			callbackInfo.cancel();
		}
	}
}
