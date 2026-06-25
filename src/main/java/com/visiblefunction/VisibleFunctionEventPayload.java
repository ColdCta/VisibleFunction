package com.visiblefunction;

import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.Identifier;

public record VisibleFunctionEventPayload(String category, String subject, String summary, String basic, String detailed) implements CustomPacketPayload {
	private static final int MAX_FIELD_LENGTH = 8192;

	public static final CustomPacketPayload.Type<VisibleFunctionEventPayload> TYPE =
		new CustomPacketPayload.Type<>(Identifier.tryBuild(VisibleFunction.MOD_ID, "event"));

	public static final StreamCodec<RegistryFriendlyByteBuf, VisibleFunctionEventPayload> CODEC = StreamCodec.of(
		(buffer, payload) -> {
			buffer.writeUtf(payload.category(), MAX_FIELD_LENGTH);
			buffer.writeUtf(payload.subject(), MAX_FIELD_LENGTH);
			buffer.writeUtf(payload.summary(), MAX_FIELD_LENGTH);
			buffer.writeUtf(payload.basic(), MAX_FIELD_LENGTH);
			buffer.writeUtf(payload.detailed(), MAX_FIELD_LENGTH);
		},
		buffer -> new VisibleFunctionEventPayload(
			buffer.readUtf(MAX_FIELD_LENGTH),
			buffer.readUtf(MAX_FIELD_LENGTH),
			buffer.readUtf(MAX_FIELD_LENGTH),
			buffer.readUtf(MAX_FIELD_LENGTH),
			buffer.readUtf(MAX_FIELD_LENGTH)
		)
	);

	public VisibleFunctionEventPayload(VisibleFunctionEventText eventText) {
		this(eventText.category(), eventText.subject(), eventText.summary(), eventText.basic(), eventText.detailed());
	}

	@Override
	public Type<? extends CustomPacketPayload> type() {
		return TYPE;
	}
}
