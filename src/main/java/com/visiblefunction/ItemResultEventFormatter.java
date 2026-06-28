package com.visiblefunction;

import net.minecraft.commands.arguments.item.ItemInput;
import net.minecraft.core.Holder;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.item.Item;

import java.util.Collection;
import java.util.Locale;

final class ItemResultEventFormatter {
	private ItemResultEventFormatter() {
	}

	static VisibleFunctionEventText format(
		CommandTraceContext.CommandContext commandContext,
		ItemInput item,
		Collection<ServerPlayer> targets,
		int requestedCount,
		int affectedPlayers
	) {
		String itemId = itemId(item.item());
		int totalItems = requestedCount * affectedPlayers;
		String summary = String.format(Locale.ROOT, "%s x%d given to %d/%d players", itemId, requestedCount, affectedPlayers, targets.size());

		StringBuilder basic = new StringBuilder();
		appendCommandContext(basic, commandContext);
		appendFields(basic, itemId, targets, requestedCount, affectedPlayers, totalItems);

		StringBuilder detailed = new StringBuilder();
		appendCommandContext(detailed, commandContext);
		appendFields(detailed, itemId, targets, requestedCount, affectedPlayers, totalItems);
		appendField(detailed, "components", item.components().isEmpty() ? "none" : item.components().toString());
		appendField(detailed, "target_preview", EntityTargetFormatter.preview(targets));

		return new VisibleFunctionEventText("EVENT", "item_given " + itemId, summary, basic.toString(), detailed.toString());
	}

	private static void appendFields(
		StringBuilder text,
		String itemId,
		Collection<ServerPlayer> targets,
		int requestedCount,
		int affectedPlayers,
		int totalItems
	) {
		appendField(text, "event_type", "item");
		appendField(text, "event_action", "item_given");
		appendField(text, "item", itemId);
		appendField(text, "requested_count", Integer.toString(requestedCount));
		appendField(text, "target_players", Integer.toString(targets.size()));
		appendField(text, "affected_players", Integer.toString(affectedPlayers));
		appendField(text, "total_items", Integer.toString(totalItems));
		appendField(text, "targets", "aggregate");
		appendField(text, "query", "false");
	}

	private static void appendCommandContext(StringBuilder text, CommandTraceContext.CommandContext commandContext) {
		if (commandContext == null) {
			appendField(text, "command", "none");
			appendField(text, "command_id", "none");
			appendField(text, "source", "unknown");
			appendField(text, "function", "none");
			appendField(text, "function_call_id", "none");
			appendField(text, "position", "unknown");
			return;
		}

		appendField(text, "command", commandContext.effectiveCommand());
		if (commandContext.hasNestedCommand()) {
			appendField(text, "outer_command", commandContext.rawCommand());
		}
		appendField(text, "command_id", Long.toString(commandContext.id()));
		appendField(text, "source", commandContext.source());
		appendField(text, "function", commandContext.function());
		appendField(text, "function_call_id", commandContext.functionCallIdText());
		appendField(text, "position", commandContext.position());
		CommandTraceFormatter.appendTriggerFields(text, commandContext.trigger(), false);
	}

	private static String itemId(Holder<Item> item) {
		return item.unwrapKey()
			.map(key -> key.identifier().toString())
			.orElse(item.value().toString());
	}

	private static void appendField(StringBuilder text, String name, String value) {
		text.append("- ")
			.append(name)
			.append(": ")
			.append(value)
			.append("\n");
	}
}
