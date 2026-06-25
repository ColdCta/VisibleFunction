package com.visiblefunction;

import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.Identifier;

public record VisibleFunctionWindowConfigPayload(int width, int maxLines, int visibleMillis, int timelineBufferTicks) implements CustomPacketPayload {
	public static final CustomPacketPayload.Type<VisibleFunctionWindowConfigPayload> TYPE =
		new CustomPacketPayload.Type<>(Identifier.tryBuild(VisibleFunction.MOD_ID, "window_config"));

	public static final StreamCodec<RegistryFriendlyByteBuf, VisibleFunctionWindowConfigPayload> CODEC = StreamCodec.of(
		(buffer, payload) -> {
			buffer.writeVarInt(payload.width());
			buffer.writeVarInt(payload.maxLines());
			buffer.writeVarInt(payload.visibleMillis());
			buffer.writeVarInt(payload.timelineBufferTicks());
		},
		buffer -> new VisibleFunctionWindowConfigPayload(buffer.readVarInt(), buffer.readVarInt(), buffer.readVarInt(), buffer.readVarInt())
	);

	public VisibleFunctionWindowConfigPayload(VisibleFunctionSettings settings) {
		this(settings.windowWidth(), settings.windowMaxLines(), settings.windowVisibleMillis(), settings.timelineBufferTicks());
	}

	@Override
	public Type<? extends CustomPacketPayload> type() {
		return TYPE;
	}
}
