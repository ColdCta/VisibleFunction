package com.visiblefunction;

import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerEntityEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.fabricmc.fabric.api.networking.v1.PayloadTypeRegistry;
import net.fabricmc.fabric.api.networking.v1.ServerPlayConnectionEvents;
import net.fabricmc.fabric.api.networking.v1.ServerPlayNetworking;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.arguments.item.ItemInput;
import net.minecraft.core.Holder;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.effect.MobEffect;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntitySpawnReason;
import net.minecraft.world.entity.Relative;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Collection;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

public class VisibleFunction implements ModInitializer {
	public static final String MOD_ID = "visiblefunction";
	public static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

	private static VisibleFunction instance;

	private final VisibleFunctionSettings settings = new VisibleFunctionSettings();
	private final Map<UUID, EntitySpawnContext> pendingEntitySpawns = new ConcurrentHashMap<>();

	@Override
	public void onInitialize() {
		instance = this;
		PayloadTypeRegistry.clientboundPlay().register(VisibleFunctionEventPayload.TYPE, VisibleFunctionEventPayload.CODEC);
		PayloadTypeRegistry.clientboundPlay().register(VisibleFunctionWindowConfigPayload.TYPE, VisibleFunctionWindowConfigPayload.CODEC);
		VisibleFunctionCommands.register(settings);
		ServerPlayConnectionEvents.JOIN.register((handler, sender, server) -> sendWindowConfig(settings, handler.player));
		ServerLifecycleEvents.SERVER_STARTED.register(DatapackTickFunctionIndex::rebuild);
		ServerLifecycleEvents.END_DATA_PACK_RELOAD.register((server, resourceManager, success) -> {
			if (success) {
				DatapackTickFunctionIndex.rebuild(server, resourceManager);
			}
		});
		ServerLifecycleEvents.SERVER_STOPPING.register(server -> {
			DatapackTickFunctionIndex.clear();
			VisibleFunctionRecordingManager.instance().stopIfActive();
			VisibleFunctionExportServer.instance().stop();
		});
		ServerTickEvents.END_SERVER_TICK.register(CommandTraceContext::tick);

		ServerEntityEvents.ALLOW_LOAD.register((entity, level, spawnReason, loadedFromDisk) -> {
			EntitySpawnReason effectiveSpawnReason = VisibleFunctionSpawnSources.consume(entity.getUUID(), spawnReason);

			if (loadedFromDisk || effectiveSpawnReason == EntitySpawnReason.LOAD) {
				pendingEntitySpawns.remove(entity.getUUID());
				return true;
			}

			pendingEntitySpawns.put(entity.getUUID(), new EntitySpawnContext(effectiveSpawnReason, loadedFromDisk));
			return true;
		});

		ServerEntityEvents.ENTITY_LOAD.register((entity, level) -> {
			EntitySpawnContext context = pendingEntitySpawns.remove(entity.getUUID());

			if (context == null || context.loadedFromDisk()) {
				return;
			}

			if (!settings.enabled()) {
				return;
			}

			CommandTraceContext.CommandContext commandContext = isCommandSpawn(context.spawnReason())
				? CommandTraceContext.currentOrRecent(level.getServer())
				: null;
			emitEvent(EntityPlainTextFormatter.formatSpawnEvent(entity, level, context.spawnReason(), commandContext), level.getServer());
		});
	}

	public static void recordCommandTrace(CommandTraceContext.CommandContext commandContext) {
		VisibleFunction visibleFunction = instance;

		if (visibleFunction == null) {
			return;
		}

		visibleFunction.emitEvent(CommandTraceFormatter.format(commandContext), commandContext.server());
		for (VisibleFunctionEventText eventText : CommandResultEventFormatter.format(commandContext)) {
			visibleFunction.emitEvent(eventText, commandContext.server());
		}
	}

	public static void recordTagResult(
		CommandSourceStack source,
		Collection<? extends Entity> targets,
		String operation,
		String tag,
		int affectedTargets
	) {
		VisibleFunction visibleFunction = instance;

		if (visibleFunction == null) {
			return;
		}

		CommandTraceContext.CommandContext commandContext = CommandTraceContext.currentOrRecent(source.getServer());
		visibleFunction.emitEvent(
			TagResultEventFormatter.format(commandContext, targets, operation, tag, affectedTargets),
			source.getServer()
		);
	}

	public static void recordEffectResult(
		CommandSourceStack source,
		Collection<? extends Entity> targets,
		String operation,
		Holder<MobEffect> effect,
		Integer duration,
		int amplifier,
		boolean hideParticles,
		int affectedTargets
	) {
		VisibleFunction visibleFunction = instance;

		if (visibleFunction == null) {
			return;
		}

		CommandTraceContext.CommandContext commandContext = CommandTraceContext.currentOrRecent(source.getServer());
		visibleFunction.emitEvent(
			EffectResultEventFormatter.format(commandContext, targets, operation, effect, duration, amplifier, hideParticles, affectedTargets),
			source.getServer()
		);
	}

	public static void recordKillResult(
		CommandSourceStack source,
		Collection<? extends Entity> targets,
		int affectedTargets
	) {
		VisibleFunction visibleFunction = instance;

		if (visibleFunction == null) {
			return;
		}

		CommandTraceContext.CommandContext commandContext = CommandTraceContext.currentOrRecent(source.getServer());
		visibleFunction.emitEvent(
			KillResultEventFormatter.format(commandContext, targets, affectedTargets),
			source.getServer()
		);
	}

	public static void recordItemGiven(
		CommandSourceStack source,
		ItemInput item,
		Collection<ServerPlayer> targets,
		int requestedCount,
		int affectedPlayers
	) {
		VisibleFunction visibleFunction = instance;

		if (visibleFunction == null) {
			return;
		}

		CommandTraceContext.CommandContext commandContext = CommandTraceContext.currentOrRecent(source.getServer());
		visibleFunction.emitEvent(
			ItemResultEventFormatter.format(commandContext, item, targets, requestedCount, affectedPlayers),
			source.getServer()
		);
	}

	public static void recordTeleportResult(
		CommandSourceStack source,
		Entity target,
		String from,
		String to,
		Identifier dimension,
		Set<Relative> relatives,
		float yaw,
		float pitch
	) {
		VisibleFunction visibleFunction = instance;

		if (visibleFunction == null) {
			return;
		}

		CommandTraceContext.CommandContext commandContext = CommandTraceContext.currentOrRecent(source.getServer());
		visibleFunction.emitEvent(
			TeleportResultEventFormatter.format(commandContext, target, from, to, dimension, relatives, yaw, pitch),
			source.getServer()
		);
	}

	public static void recordScoreboardResult(
		CommandSourceStack source,
		String action,
		String subject,
		String summary,
		Map<String, String> fields
	) {
		VisibleFunction visibleFunction = instance;

		if (visibleFunction == null) {
			return;
		}

		CommandTraceContext.CommandContext commandContext = CommandTraceContext.currentOrRecent(source.getServer());
		visibleFunction.emitEvent(
			ScoreboardResultEventFormatter.format(commandContext, action, subject, summary, fields),
			source.getServer()
		);
	}

	public static void recordDataStorageResult(
		CommandSourceStack source,
		String action,
		Identifier storage,
		String path,
		String operation,
		boolean query,
		int result,
		Map<String, String> fields
	) {
		VisibleFunction visibleFunction = instance;

		if (visibleFunction == null) {
			return;
		}

		CommandTraceContext.CommandContext commandContext = CommandTraceContext.currentOrRecent(source.getServer());
		visibleFunction.emitEvent(
			DataStorageResultEventFormatter.format(commandContext, action, storage, path, operation, query, result, fields),
			source.getServer()
		);
	}

	public static void recordDataStorageResult(
		CommandTraceContext.CommandContext commandContext,
		String action,
		Identifier storage,
		String path,
		String operation,
		boolean query,
		int result,
		Map<String, String> fields
	) {
		VisibleFunction visibleFunction = instance;

		if (visibleFunction == null || commandContext == null) {
			return;
		}

		visibleFunction.emitEvent(
			DataStorageResultEventFormatter.format(commandContext, action, storage, path, operation, query, result, fields),
			commandContext.server()
		);
	}

	private static boolean isCommandSpawn(EntitySpawnReason spawnReason) {
		return spawnReason == EntitySpawnReason.COMMAND || spawnReason == EntitySpawnReason.MOB_SUMMONED;
	}

	private void emitEvent(VisibleFunctionEventText eventText, MinecraftServer server) {
		if (!settings.enabled()) {
			return;
		}

		eventText = withTick(eventText, server);

		if (settings.outputTarget().logs()) {
			LOGGER.info("\n{}\n{}", eventText.header(), eventText.detailed());
		}

		boolean recordingActive = VisibleFunctionRecordingManager.instance().active();
		VisibleFunctionEventPayload payload = null;
		if (settings.outputTarget().window() || settings.exportEnabled() || recordingActive) {
			payload = new VisibleFunctionEventPayload(eventText);
		}

		if (settings.outputTarget().window() && payload != null) {
			for (ServerPlayer player : server.getPlayerList().getPlayers()) {
				if (ServerPlayNetworking.canSend(player, VisibleFunctionEventPayload.TYPE)) {
					ServerPlayNetworking.send(player, payload);
				}
			}
		}

		if (settings.exportEnabled() && payload != null) {
			VisibleFunctionExportServer.instance().publish(payload);
		}

		if (recordingActive && payload != null) {
			VisibleFunctionRecordingManager.instance().publish(payload);
		}

		if (settings.outputTarget().chat()) {
			server.getPlayerList().broadcastSystemMessage(Component.literal(eventText.header()), false);
		}
	}

	private static VisibleFunctionEventText withTick(VisibleFunctionEventText eventText, MinecraftServer server) {
		String tickLine = "- tick: " + server.overworld().getGameTime() + "\n";
		return new VisibleFunctionEventText(
			eventText.category(),
			eventText.subject(),
			eventText.summary(),
			prefixTickIfMissing(eventText.basic(), tickLine),
			prefixTickIfMissing(eventText.detailed(), tickLine)
		);
	}

	private static String prefixTickIfMissing(String text, String tickLine) {
		return text.contains("- tick: ") ? text : tickLine + text;
	}

	static void sendWindowConfig(VisibleFunctionSettings settings, ServerPlayer player) {
		if (ServerPlayNetworking.canSend(player, VisibleFunctionWindowConfigPayload.TYPE)) {
			ServerPlayNetworking.send(player, new VisibleFunctionWindowConfigPayload(settings));
		}
	}

	static void broadcastWindowConfig(VisibleFunctionSettings settings, Iterable<ServerPlayer> players) {
		for (ServerPlayer player : players) {
			sendWindowConfig(settings, player);
		}
	}

	private record EntitySpawnContext(EntitySpawnReason spawnReason, boolean loadedFromDisk) {
	}
}
