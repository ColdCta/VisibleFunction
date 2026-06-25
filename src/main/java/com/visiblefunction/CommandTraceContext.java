package com.visiblefunction;

import com.visiblefunction.mixin.CommandSourceStackAccessor;
import net.minecraft.commands.CommandSource;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.execution.Frame;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.Identifier;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.vehicle.minecart.MinecartCommandBlock;
import net.minecraft.world.phys.Vec2;
import net.minecraft.world.phys.Vec3;

import java.util.ArrayDeque;
import java.util.Collections;
import java.util.Deque;
import java.util.Iterator;
import java.util.Locale;
import java.util.Map;
import java.util.WeakHashMap;
import java.util.concurrent.atomic.AtomicLong;

public final class CommandTraceContext {
	private static final int RETAIN_TICKS = 5;
	private static final ThreadLocal<String> SOURCE_OVERRIDE = new ThreadLocal<>();
	private static final ThreadLocal<Boolean> TICK_FUNCTION_DISPATCH = ThreadLocal.withInitial(() -> false);
	private static final ThreadLocal<Deque<CommandContext>> ACTIVE_CONTEXTS = ThreadLocal.withInitial(ArrayDeque::new);
	private static final Map<Frame, FunctionFrame> FUNCTION_FRAMES = Collections.synchronizedMap(new WeakHashMap<>());
	private static final Map<MinecraftServer, Deque<RetainedCommandContext>> RECENT_CONTEXTS = Collections.synchronizedMap(new WeakHashMap<>());
	private static final AtomicLong NEXT_COMMAND_ID = new AtomicLong(1);
	private static final AtomicLong NEXT_FUNCTION_CALL_ID = new AtomicLong(1);

	private CommandTraceContext() {
	}

	public static void enterSourceOverride(String source) {
		SOURCE_OVERRIDE.set(source);
	}

	public static void clearSourceOverride() {
		SOURCE_OVERRIDE.remove();
	}

	public static void enterTickFunctionDispatch() {
		TICK_FUNCTION_DISPATCH.set(true);
	}

	public static void exitTickFunctionDispatch() {
		TICK_FUNCTION_DISPATCH.set(false);
	}

	public static void markFunctionFrame(Frame frame, Identifier functionId) {
		FUNCTION_FRAMES.put(frame, new FunctionFrame(functionId, NEXT_FUNCTION_CALL_ID.getAndIncrement(), isTickFunctionFrame(functionId)));
	}

	public static Identifier functionFor(Frame frame) {
		FunctionFrame functionFrame = FUNCTION_FRAMES.get(frame);
		return functionFrame == null ? null : functionFrame.functionId();
	}

	public static long functionCallIdFor(Frame frame) {
		FunctionFrame functionFrame = FUNCTION_FRAMES.get(frame);
		return functionFrame == null ? -1 : functionFrame.callId();
	}

	public static boolean functionIsTickFor(Frame frame) {
		FunctionFrame functionFrame = FUNCTION_FRAMES.get(frame);
		return functionFrame != null && functionFrame.tickFunction();
	}

	public static CommandContext push(String commandInput, CommandSourceStack sourceStack, Identifier functionId, long functionCallId) {
		CommandContext context = build(commandInput, sourceStack, functionId, functionCallId, functionId != null && DatapackTickFunctionIndex.isTickFunction(functionId));
		ACTIVE_CONTEXTS.get().push(context);
		return context;
	}

	public static CommandContext push(String commandInput, CommandSourceStack sourceStack, Identifier functionId, long functionCallId, boolean tickFunction) {
		CommandContext context = build(commandInput, sourceStack, functionId, functionCallId, tickFunction);
		ACTIVE_CONTEXTS.get().push(context);
		return context;
	}

	public static void pop(CommandContext context) {
		Deque<CommandContext> activeContexts = ACTIVE_CONTEXTS.get();

		if (!activeContexts.isEmpty() && activeContexts.peek() == context) {
			activeContexts.pop();
		} else {
			activeContexts.remove(context);
		}

		retain(context);
	}

	public static CommandContext currentOrRecent(MinecraftServer server) {
		Deque<CommandContext> activeContexts = ACTIVE_CONTEXTS.get();

		if (!activeContexts.isEmpty()) {
			return activeContexts.peek();
		}

		Deque<RetainedCommandContext> retainedContexts = RECENT_CONTEXTS.get(server);
		return retainedContexts == null || retainedContexts.isEmpty() ? null : retainedContexts.peekFirst().context();
	}

	public static void tick(MinecraftServer server) {
		Deque<RetainedCommandContext> retainedContexts = RECENT_CONTEXTS.get(server);

		if (retainedContexts == null) {
			return;
		}

		Iterator<RetainedCommandContext> iterator = retainedContexts.iterator();
		while (iterator.hasNext()) {
			RetainedCommandContext retainedContext = iterator.next();
			retainedContext.tick();

			if (retainedContext.expired()) {
				iterator.remove();
			}
		}
	}

	private static CommandContext build(String commandInput, CommandSourceStack sourceStack, Identifier functionId, long functionCallId, boolean tickFunction) {
		String source = sourceKind(sourceStack, functionId, tickFunction);
		Entity entity = sourceStack.getEntity();
		String rawCommand = CommandText.normalize(commandInput);
		String effectiveCommand = CommandText.effectiveCommand(rawCommand);
		return new CommandContext(
			NEXT_COMMAND_ID.getAndIncrement(),
			rawCommand,
			effectiveCommand,
			source,
			functionId,
			functionCallId,
			formatPosition(sourceStack.getPosition()),
			sourceStack.getLevel().dimension().identifier().toString(),
			formatRotation(sourceStack.getRotation()),
			sourceStack.getTextName().isBlank() ? "unknown" : sourceStack.getTextName(),
			entity == null ? "none" : formatEntity(entity),
			sourceStack.getServer()
		);
	}

	private static void retain(CommandContext context) {
		Deque<RetainedCommandContext> retainedContexts = RECENT_CONTEXTS.computeIfAbsent(context.server(), ignored -> new ArrayDeque<>());
		retainedContexts.addFirst(new RetainedCommandContext(context, RETAIN_TICKS));

		while (retainedContexts.size() > 32) {
			retainedContexts.removeLast();
		}
	}

	private static boolean isTickFunctionFrame(Identifier functionId) {
		if (Boolean.TRUE.equals(TICK_FUNCTION_DISPATCH.get())) {
			return true;
		}

		Deque<CommandContext> activeContexts = ACTIVE_CONTEXTS.get();
		if (!activeContexts.isEmpty() && "tick function".equals(activeContexts.peek().source())) {
			return true;
		}

		return DatapackTickFunctionIndex.isTickFunction(functionId);
	}

	private static String sourceKind(CommandSourceStack sourceStack, Identifier functionId, boolean tickFunction) {
		if (functionId != null) {
			return tickFunction ? "tick function" : "function";
		}

		String override = SOURCE_OVERRIDE.get();
		if (override != null) {
			return override;
		}

		if (sourceStack.isPlayer() || sourceStack.getEntity() instanceof ServerPlayer) {
			return "player";
		}

		if (sourceStack.getEntity() instanceof MinecartCommandBlock) {
			return "command_block";
		}

		CommandSource source = ((CommandSourceStackAccessor) sourceStack).visiblefunction$source();
		if (source instanceof MinecraftServer) {
			return "server";
		}

		if (source.getClass().getName().contains("BaseCommandBlock$CloseableCommandBlockSource")) {
			return "command_block";
		}

		return "unknown";
	}

	private static String formatPosition(Vec3 position) {
		return String.format(Locale.ROOT, "x=%.2f, y=%.2f, z=%.2f", position.x(), position.y(), position.z());
	}

	private static String formatRotation(Vec2 rotation) {
		return String.format(Locale.ROOT, "yaw=%.2f, pitch=%.2f", rotation.y, rotation.x);
	}

	private static String formatEntity(Entity entity) {
		return BuiltInRegistries.ENTITY_TYPE.getKey(entity.getType()) + " " + entity.getUUID();
	}

	public record CommandContext(
		long id,
		String rawCommand,
		String effectiveCommand,
		String source,
		Identifier functionId,
		long functionCallId,
		String position,
		String dimension,
		String rotation,
		String executorName,
		String executorEntity,
		MinecraftServer server
	) {
		public String function() {
			return functionId == null ? "none" : functionId.toString();
		}

		public String functionCallIdText() {
			return functionCallId < 0 ? "none" : Long.toString(functionCallId);
		}

		public boolean hasNestedCommand() {
			return !rawCommand.equals(effectiveCommand);
		}
	}

	private record FunctionFrame(Identifier functionId, long callId, boolean tickFunction) {
	}

	private static final class RetainedCommandContext {
		private final CommandContext context;
		private int ticksRemaining;

		private RetainedCommandContext(CommandContext context, int ticksRemaining) {
			this.context = context;
			this.ticksRemaining = ticksRemaining;
		}

		private CommandContext context() {
			return context;
		}

		private void tick() {
			ticksRemaining--;
		}

		private boolean expired() {
			return ticksRemaining <= 0;
		}
	}
}
