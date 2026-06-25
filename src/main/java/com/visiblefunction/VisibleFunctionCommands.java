package com.visiblefunction;

import com.mojang.brigadier.arguments.BoolArgumentType;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.context.CommandContext;
import net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;

final class VisibleFunctionCommands {
	private VisibleFunctionCommands() {
	}

	static void register(VisibleFunctionSettings settings) {
		CommandRegistrationCallback.EVENT.register((dispatcher, registryAccess, environment) -> dispatcher.register(
			Commands.literal("visiblefunction")
				.executes(context -> showStatus(context, settings))
				.then(Commands.literal("status")
					.executes(context -> showStatus(context, settings)))
				.then(Commands.literal("enabled")
					.then(Commands.argument("value", BoolArgumentType.bool())
						.executes(context -> setEnabled(context, settings, BoolArgumentType.getBool(context, "value")))))
				.then(Commands.literal("output")
					.then(Commands.literal("window")
						.executes(context -> setOutputTarget(context, settings, VisibleFunctionSettings.OutputTarget.WINDOW)))
					.then(Commands.literal("chat")
						.executes(context -> setOutputTarget(context, settings, VisibleFunctionSettings.OutputTarget.CHAT)))
					.then(Commands.literal("log")
						.executes(context -> setOutputTarget(context, settings, VisibleFunctionSettings.OutputTarget.LOG)))
					.then(Commands.literal("both")
						.executes(context -> setOutputTarget(context, settings, VisibleFunctionSettings.OutputTarget.BOTH))))
				.then(Commands.literal("window")
					.then(Commands.literal("width")
						.then(Commands.argument("value", IntegerArgumentType.integer(160, 640))
							.executes(context -> setWindowWidth(context, settings, IntegerArgumentType.getInteger(context, "value")))))
					.then(Commands.literal("lines")
						.then(Commands.argument("value", IntegerArgumentType.integer(2, 24))
							.executes(context -> setWindowLines(context, settings, IntegerArgumentType.getInteger(context, "value")))))
					.then(Commands.literal("timeout")
						.then(Commands.argument("milliseconds", IntegerArgumentType.integer(1000, 60000))
							.executes(context -> setWindowTimeout(context, settings, IntegerArgumentType.getInteger(context, "milliseconds"))))))
				.then(Commands.literal("timeline")
					.then(Commands.literal("buffer")
						.then(Commands.argument("ticks", IntegerArgumentType.integer(20, 1200))
							.executes(context -> setTimelineBuffer(context, settings, IntegerArgumentType.getInteger(context, "ticks"))))))
				.then(Commands.literal("export")
					.then(Commands.literal("start")
						.executes(context -> setExportEnabled(context, settings, true)))
					.then(Commands.literal("stop")
						.executes(context -> setExportEnabled(context, settings, false)))
					.then(Commands.literal("status")
						.executes(context -> showExportStatus(context, settings)))
					.then(Commands.literal("port")
						.then(Commands.argument("value", IntegerArgumentType.integer(1024, 65535))
							.executes(context -> setExportPort(context, settings, IntegerArgumentType.getInteger(context, "value"))))))
				.then(Commands.literal("recording")
					.then(Commands.literal("toggle")
						.executes(VisibleFunctionCommands::toggleRecording))
					.then(Commands.literal("start")
						.executes(VisibleFunctionCommands::startRecording))
					.then(Commands.literal("stop")
						.executes(VisibleFunctionCommands::stopRecording))
					.then(Commands.literal("status")
						.executes(VisibleFunctionCommands::showRecordingStatus)))
		));
	}

	private static int showStatus(CommandContext<CommandSourceStack> context, VisibleFunctionSettings settings) {
		context.getSource().sendSystemMessage(Component.literal(statusText(settings)));
		return 1;
	}

	private static int setEnabled(CommandContext<CommandSourceStack> context, VisibleFunctionSettings settings, boolean enabled) {
		settings.setEnabled(enabled);
		context.getSource().sendSuccess(() -> Component.literal("VisibleFunction enabled: " + enabled), true);
		return 1;
	}

	private static int setOutputTarget(
		CommandContext<CommandSourceStack> context,
		VisibleFunctionSettings settings,
		VisibleFunctionSettings.OutputTarget outputTarget
	) {
		settings.setOutputTarget(outputTarget);
		context.getSource().sendSuccess(() -> Component.literal("VisibleFunction output: " + outputTarget.id()), true);
		return 1;
	}

	private static int setWindowWidth(CommandContext<CommandSourceStack> context, VisibleFunctionSettings settings, int width) {
		settings.setWindowWidth(width);
		syncWindowConfig(context, settings);
		context.getSource().sendSuccess(() -> Component.literal("VisibleFunction window width: " + settings.windowWidth()), false);
		return 1;
	}

	private static int setWindowLines(CommandContext<CommandSourceStack> context, VisibleFunctionSettings settings, int lines) {
		settings.setWindowMaxLines(lines);
		syncWindowConfig(context, settings);
		context.getSource().sendSuccess(() -> Component.literal("VisibleFunction window lines: " + settings.windowMaxLines()), false);
		return 1;
	}

	private static int setWindowTimeout(CommandContext<CommandSourceStack> context, VisibleFunctionSettings settings, int milliseconds) {
		settings.setWindowVisibleMillis(milliseconds);
		syncWindowConfig(context, settings);
		context.getSource().sendSuccess(() -> Component.literal("VisibleFunction window timeout: " + settings.windowVisibleMillis() + "ms"), false);
		return 1;
	}

	private static int setTimelineBuffer(CommandContext<CommandSourceStack> context, VisibleFunctionSettings settings, int ticks) {
		settings.setTimelineBufferTicks(ticks);
		syncWindowConfig(context, settings);
		context.getSource().sendSuccess(() -> Component.literal("VisibleFunction timeline buffer: " + settings.timelineBufferTicks() + " ticks"), false);
		return 1;
	}

	private static int setExportEnabled(CommandContext<CommandSourceStack> context, VisibleFunctionSettings settings, boolean enabled) {
		boolean success;
		if (enabled) {
			success = VisibleFunctionExportServer.instance().start(settings.exportPort());
			settings.setExportEnabled(success);
		} else {
			VisibleFunctionExportServer.instance().stop();
			settings.setExportEnabled(false);
			success = true;
		}

		if (success) {
			String state = enabled ? "started" : "stopped";
			String url = enabled ? " http://127.0.0.1:" + settings.exportPort() : "";
			context.getSource().sendSuccess(() -> Component.literal("VisibleFunction export " + state + url), false);
			return 1;
		}

		context.getSource().sendFailure(Component.literal("VisibleFunction export failed to start on port " + settings.exportPort()));
		return 0;
	}

	private static int setExportPort(CommandContext<CommandSourceStack> context, VisibleFunctionSettings settings, int port) {
		settings.setExportPort(port);
		if (settings.exportEnabled()) {
			boolean started = VisibleFunctionExportServer.instance().start(settings.exportPort());
			settings.setExportEnabled(started);
			if (!started) {
				context.getSource().sendFailure(Component.literal("VisibleFunction export failed to restart on port " + settings.exportPort()));
				return 0;
			}
		}
		context.getSource().sendSuccess(() -> Component.literal("VisibleFunction export port: " + settings.exportPort()), false);
		return 1;
	}

	private static int showExportStatus(CommandContext<CommandSourceStack> context, VisibleFunctionSettings settings) {
		context.getSource().sendSystemMessage(Component.literal(exportStatusText(settings)));
		return 1;
	}

	private static int toggleRecording(CommandContext<CommandSourceStack> context) {
		return sendRecordingResult(context, VisibleFunctionRecordingManager.instance().toggle());
	}

	private static int startRecording(CommandContext<CommandSourceStack> context) {
		return sendRecordingResult(context, VisibleFunctionRecordingManager.instance().start());
	}

	private static int stopRecording(CommandContext<CommandSourceStack> context) {
		return sendRecordingResult(context, VisibleFunctionRecordingManager.instance().stop());
	}

	private static int showRecordingStatus(CommandContext<CommandSourceStack> context) {
		context.getSource().sendSystemMessage(Component.literal(VisibleFunctionRecordingManager.instance().statusJson()));
		return 1;
	}

	private static int sendRecordingResult(
		CommandContext<CommandSourceStack> context,
		VisibleFunctionRecordingManager.RecordingResult result
	) {
		if (result.success()) {
			context.getSource().sendSuccess(() -> Component.literal(result.message()), false);
			return 1;
		}

		context.getSource().sendFailure(Component.literal(result.message()));
		return 0;
	}

	private static void syncWindowConfig(CommandContext<CommandSourceStack> context, VisibleFunctionSettings settings) {
		VisibleFunction.broadcastWindowConfig(settings, context.getSource().getServer().getPlayerList().getPlayers());
	}

	private static String statusText(VisibleFunctionSettings settings) {
		return "[VisibleFunction]\n"
			+ "- enabled: " + settings.enabled() + "\n"
			+ "- output: " + settings.outputTarget().id() + "\n"
			+ "- window: width=" + settings.windowWidth() + ", lines=" + settings.windowMaxLines() + ", timeout=" + settings.windowVisibleMillis() + "ms\n"
			+ "- timeline: buffer=" + settings.timelineBufferTicks() + " ticks\n"
			+ "- export: enabled=" + settings.exportEnabled() + ", port=" + settings.exportPort() + "\n"
			+ "- recording: " + VisibleFunctionRecordingManager.instance().statusJson() + "\n"
			+ "- commands: /visiblefunction window <width|lines|timeout> <value>, /visiblefunction timeline buffer <ticks>, /visiblefunction export <start|stop|status|port>, /visiblefunction recording <toggle|start|stop|status>";
	}

	private static String exportStatusText(VisibleFunctionSettings settings) {
		return "[VisibleFunction Export]\n"
			+ "- enabled: " + settings.exportEnabled() + "\n"
			+ "- running: " + VisibleFunctionExportServer.instance().running() + "\n"
			+ "- port: " + settings.exportPort() + "\n"
			+ "- records: " + VisibleFunctionExportServer.instance().recordCount() + "\n"
			+ "- health: http://127.0.0.1:" + settings.exportPort() + "/health\n"
			+ "- records: http://127.0.0.1:" + settings.exportPort() + "/api/v1/records\n"
			+ "- grouped: http://127.0.0.1:" + settings.exportPort() + "/api/v1/grouped\n"
			+ "- tick filter: http://127.0.0.1:" + settings.exportPort() + "/api/v1/tick-filter\n"
			+ "- stream: http://127.0.0.1:" + settings.exportPort() + "/api/v1/stream\n"
			+ "- recording status: http://127.0.0.1:" + settings.exportPort() + "/api/v1/recording/status\n"
			+ "- recordings: http://127.0.0.1:" + settings.exportPort() + "/api/v1/recordings\n"
			+ "- latest recording: http://127.0.0.1:" + settings.exportPort() + "/api/v1/recordings/latest";
	}
}
