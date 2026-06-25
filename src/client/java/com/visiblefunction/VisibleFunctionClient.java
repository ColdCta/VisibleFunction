package com.visiblefunction;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayNetworking;
import net.fabricmc.fabric.api.client.rendering.v1.hud.HudElementRegistry;
import net.minecraft.resources.Identifier;

public class VisibleFunctionClient implements ClientModInitializer {
	@Override
	public void onInitializeClient() {
		ClientPlayNetworking.registerGlobalReceiver(VisibleFunctionEventPayload.TYPE, (payload, context) ->
			context.client().execute(() -> VisibleFunctionHud.addEvent(payload))
		);
		ClientPlayNetworking.registerGlobalReceiver(VisibleFunctionWindowConfigPayload.TYPE, (payload, context) ->
			context.client().execute(() -> VisibleFunctionHud.applyConfig(payload))
		);
		HudElementRegistry.addLast(
			Identifier.tryBuild(VisibleFunction.MOD_ID, "event_window"),
			VisibleFunctionHud::render
		);
	}
}
