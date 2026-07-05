package com.visiblefunction;

import net.minecraft.client.DeltaTracker;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphicsExtractor;

import java.util.ArrayList;
import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

public final class VisibleFunctionHud {
	private static final int PADDING = 6;
	private static final int HEADER_HEIGHT = 13;
	private static final int MARGIN = 8;
	private static final int TICK_MILLIS = 50;
	private static final int FUNCTION_CALL_GAP_MILLIS = 250;
	private static final int MAX_CLIENT_RECORDS = 20000;
	private static final int CLIENT_RECORD_PRUNE_BATCH = 1000;
	private static final List<EventRecord> RECORDS = new ArrayList<>();
	private static final TraceStore TRACE_STORE = new TraceStore();
	private static final TickFilterEngine<EventRecord> TICK_FILTER = new TickFilterEngine<>();
	private static final Set<EventRecord> OLDER_HISTORY_RECORDS = Collections.newSetFromMap(new IdentityHashMap<>());
	private static final Set<EventRecord> HISTORY_FILTERED_RECORDS = Collections.newSetFromMap(new IdentityHashMap<>());

	private static long nextRecordId = 1;
	private static int windowWidth = 320;
	private static int maxVisibleLines = 6;
	private static int visibleMillis = 8000;
	private static int timelineBufferTicks = 200;
	private static boolean timelinePaused;
	private static long timelineStartedAtMillis = System.currentTimeMillis();
	private static long timelinePausedAtMillis;

	private VisibleFunctionHud() {
	}

	static void addEvent(VisibleFunctionEventPayload payload) {
		EventRecord record = EventRecord.from(payload, nextRecordId++);
		RECORDS.add(record);
		TRACE_STORE.add(record);
		if (updateTickFilter(record)) {
			HISTORY_FILTERED_RECORDS.add(record);
		}
		pruneRetainedRecords();
	}

	private static void pruneRetainedRecords() {
		int overflow = RECORDS.size() - MAX_CLIENT_RECORDS;
		if (overflow <= CLIENT_RECORD_PRUNE_BATCH) {
			return;
		}

		List<EventRecord> removed = new ArrayList<>(RECORDS.subList(0, overflow));
		RECORDS.subList(0, overflow).clear();
		for (EventRecord record : removed) {
			TRACE_STORE.remove(record);
			TICK_FILTER.removeRecord(record.id());
			OLDER_HISTORY_RECORDS.remove(record);
			HISTORY_FILTERED_RECORDS.remove(record);
		}
	}

	static void applyConfig(VisibleFunctionWindowConfigPayload payload) {
		windowWidth = payload.width();
		maxVisibleLines = payload.maxLines();
		visibleMillis = payload.visibleMillis();
		timelineBufferTicks = payload.timelineBufferTicks();
	}

	static void render(GuiGraphicsExtractor guiGraphics, DeltaTracker deltaTracker) {
		EventGroup group = latestVisibleGroup();

		if (group == null) {
			return;
		}

		Minecraft minecraft = Minecraft.getInstance();
		Font font = minecraft.font;
		int width = Math.min(windowWidth, guiGraphics.guiWidth() - MARGIN * 2);
		int x = guiGraphics.guiWidth() - width - MARGIN;
		drawGroupWindow(guiGraphics, font, x, MARGIN, width, group, maxVisibleLines);
	}

	public static void openScreen() {
		Minecraft.getInstance().setScreenAndShow(new VisibleFunctionScreen());
	}

	static EventRecord latestRecord() {
		return RECORDS.isEmpty() ? null : RECORDS.getLast();
	}

	static List<EventRecord> records() {
		return List.copyOf(RECORDS);
	}

	static TraceStore traceStore() {
		return TRACE_STORE;
	}

	static boolean isHistoryOlder(EventRecord record) {
		return OLDER_HISTORY_RECORDS.contains(record);
	}

	static boolean isHistoryFiltered(EventRecord record) {
		return HISTORY_FILTERED_RECORDS.contains(record);
	}

	static void moveRecentHistoryToOlder() {
		for (EventRecord record : RECORDS) {
			if (!OLDER_HISTORY_RECORDS.contains(record)) {
				OLDER_HISTORY_RECORDS.add(record);
			}
		}
	}

	static void clearOlderHistoryRecords() {
		RECORDS.removeIf(record -> {
			if (OLDER_HISTORY_RECORDS.contains(record)) {
				TRACE_STORE.remove(record);
				HISTORY_FILTERED_RECORDS.remove(record);
				return true;
			}

			return false;
		});
		OLDER_HISTORY_RECORDS.clear();
	}

	static boolean isTickFiltered(EventRecord record) {
		return TICK_FILTER.isCaptured(tickFilterInput(record));
	}

	static List<TickFilterBucket> tickFilterBuckets(TickBucketType type) {
		return tickFilterBuckets(type, true);
	}

	static List<TickFilterBucket> tickFilterBuckets(TickBucketType type, boolean active) {
		TickFilterEngine.BucketType engineType = TickFilterEngine.BucketType.valueOf(type.name());
		return TICK_FILTER.snapshots(engineType, active, currentTick()).stream()
			.map(TickFilterBucket::new)
			.toList();
	}

	static void clearInactiveTickFilterBuckets() {
		TICK_FILTER.clearInactive(currentTick());
		HISTORY_FILTERED_RECORDS.removeIf(record -> !TICK_FILTER.isCaptured(tickFilterInput(record)));
	}

	static int capturedTickFilterBucketCount() {
		return TICK_FILTER.capturedCount();
	}

	static int configuredWidth() {
		return windowWidth;
	}

	static int configuredMaxLines() {
		return maxVisibleLines;
	}

	static int configuredTimelineBufferTicks() {
		return timelineBufferTicks;
	}

	static boolean timelinePaused() {
		return timelinePaused;
	}

	static void toggleTimelinePaused() {
		if (timelinePaused) {
			timelinePaused = false;
			timelineStartedAtMillis = System.currentTimeMillis();
			timelinePausedAtMillis = 0;
			return;
		}

		timelinePaused = true;
		timelinePausedAtMillis = System.currentTimeMillis();
	}

	static long timelineNowMillis() {
		return timelinePaused ? timelinePausedAtMillis : System.currentTimeMillis();
	}

	static long timelineStartedAtMillis() {
		return timelineStartedAtMillis;
	}

	static TickFilterBucket tickFilterBucketFor(EventRecord record) {
		TickFilterEngine.Snapshot<EventRecord> snapshot = TICK_FILTER.bucketFor(tickFilterInput(record), currentTick());
		return snapshot == null ? null : new TickFilterBucket(snapshot);
	}

	static DrawnWindow drawRecordWindow(
		GuiGraphicsExtractor guiGraphics,
		Font font,
		int x,
		int y,
		int width,
		EventRecord record,
		boolean focused,
		boolean detailed,
		int lineLimit
	) {
		List<String> lines = linesFor(record, detailed);
		int lineHeight = font.lineHeight + 2;
		int height = PADDING * 2 + HEADER_HEIGHT + Math.min(lineLimit, lines.size()) * lineHeight;

		guiGraphics.fill(x, y, x + width, y + height, focused ? 0xDD101015 : 0xAA101015);
		guiGraphics.outline(x, y, width, height, focused ? 0xFFF0C36D : 0xCC6EA8FE);

		Rect subjectRect = drawHeader(guiGraphics, font, x, y, width, record, detailed);
		int lineY = y + PADDING + HEADER_HEIGHT;
		int textWidth = width - PADDING * 2;
		for (int index = 0; index < Math.min(lineLimit, lines.size()); index++) {
			guiGraphics.text(font, trimToWidth(font, lines.get(index), textWidth), x + PADDING, lineY, 0xFFE6E6E6);
			lineY += lineHeight;
		}

		return new DrawnWindow(height, subjectRect);
	}

	private static void drawGroupWindow(GuiGraphicsExtractor guiGraphics, Font font, int x, int y, int width, EventGroup group, int lineLimit) {
		List<String> lines = group.lines();
		int lineHeight = font.lineHeight + 2;
		int height = PADDING * 2 + HEADER_HEIGHT + Math.min(lineLimit, lines.size()) * lineHeight;

		guiGraphics.fill(x, y, x + width, y + height, 0xAA101015);
		guiGraphics.outline(x, y, width, height, 0xCC6EA8FE);
		drawGroupHeader(guiGraphics, font, x, y, width, group);

		int lineY = y + PADDING + HEADER_HEIGHT;
		int textWidth = width - PADDING * 2;
		for (int index = 0; index < Math.min(lineLimit, lines.size()); index++) {
			guiGraphics.text(font, trimToWidth(font, lines.get(index), textWidth), x + PADDING, lineY, 0xFFE6E6E6);
			lineY += lineHeight;
		}
	}

	private static Rect drawHeader(
		GuiGraphicsExtractor guiGraphics,
		Font font,
		int x,
		int y,
		int width,
		EventRecord record,
		boolean detailed
	) {
		String prefix = detailed ? "[ DETAILED #" + record.id() + " ] " : "[ " + record.type() + " #" + record.id() + " ] ";
		String suffix = detailed ? detailedHeaderSuffix(record) : (record.summary().isBlank() ? "" : " " + record.summary());
		int textY = y + PADDING;
		int prefixX = x + PADDING;
		int subjectX = prefixX + font.width(prefix);
		int suffixX = subjectX + font.width(record.subject());
		int maxSuffixWidth = x + width - PADDING - suffixX;

		guiGraphics.text(font, prefix, prefixX, textY, detailed ? 0xFFFFD28A : colorFor(record.type()));
		guiGraphics.text(font, record.subject(), subjectX, textY, 0xFFFFFFFF);
		guiGraphics.text(font, trimToWidth(font, suffix, maxSuffixWidth), suffixX, textY, 0xFFE6E6E6);

		return new Rect(subjectX, textY, font.width(record.subject()), font.lineHeight);
	}

	private static void drawGroupHeader(GuiGraphicsExtractor guiGraphics, Font font, int x, int y, int width, EventGroup group) {
		String prefix = "[ " + group.type() + " ] ";
		String subject = group.subject();
		String suffix = group.summary().isBlank() ? "" : " " + group.summary();
		int textY = y + PADDING;
		int prefixX = x + PADDING;
		int subjectX = prefixX + font.width(prefix);
		int suffixX = subjectX + font.width(subject);
		int maxSuffixWidth = x + width - PADDING - suffixX;

		guiGraphics.text(font, prefix, prefixX, textY, colorFor(group.type()));
		guiGraphics.text(font, subject, subjectX, textY, 0xFFFFFFFF);
		guiGraphics.text(font, trimToWidth(font, suffix, maxSuffixWidth), suffixX, textY, 0xFFE6E6E6);
	}

	private static String detailedHeaderSuffix(EventRecord record) {
		return "EVENT".equals(record.type()) ? "(mob):" : ":";
	}

	private static EventGroup latestVisibleGroup() {
		long now = System.currentTimeMillis();

		for (int index = RECORDS.size() - 1; index >= 0; index--) {
			EventRecord record = RECORDS.get(index);
			if (now - record.timestampMillis() > visibleMillis) {
				break;
			}

			if (!isTickFiltered(record)) {
				return EventGroup.fromRecord(RECORDS, index);
			}
		}

		return null;
	}

	private static List<String> linesFor(EventRecord record, boolean detailed) {
		List<Field> fields = detailed ? record.detailedFields() : record.basicFields();
		List<String> lines = new ArrayList<>();
		lines.add("- record_id: #" + record.id());

		if (record.isCommand()) {
			lines.add("- command_id: " + record.commandContext().displayCommandId());
			lines.add("- function_call_id: " + record.commandContext().displayFunctionCallId());
			lines.add("- triggered_events: " + TRACE_STORE.eventsByCommandId(record.commandContext().numericCommandId()).size());
		} else if (record.commandContext().hasCommandId()) {
			lines.add("- caused_by_command: " + record.commandContext().displayCommandId());
			lines.add("- function_call_id: " + record.commandContext().displayFunctionCallId());
			EventRecord sourceCommand = TRACE_STORE.commandFor(record);
			if (sourceCommand != null) {
				lines.add("- source_record: #" + sourceCommand.id());
			}
		}

		for (Field field : fields) {
			if ("command_id".equals(field.name()) || "function_call_id".equals(field.name())) {
				continue;
			}
			lines.add("- " + field.name() + ": " + field.value());
		}

		return lines;
	}

	private static int colorFor(String type) {
		return switch (type) {
			case "COMMAND" -> 0xFFB9F18D;
			case "EVENT" -> 0xFF9FC5FF;
			default -> 0xFFFFD28A;
		};
	}

	static String trimToWidth(Font font, String text, int width) {
		if (font.width(text) <= width) {
			return text;
		}

		String ellipsis = "...";
		int ellipsisWidth = font.width(ellipsis);
		return font.plainSubstrByWidth(text, Math.max(0, width - ellipsisWidth)) + ellipsis;
	}

	private static boolean updateTickFilter(EventRecord record) {
		return TICK_FILTER.add(tickFilterInput(record));
	}

	private static TickFilterEngine.Input<EventRecord> tickFilterInput(EventRecord record) {
		CommandRef context = record.commandContext();
		long tick = recordTick(record);
		String action = record.field("action");
		return new TickFilterEngine.Input<>(
			record.id(),
			record.type(),
			record.subject(),
			action.isBlank() ? record.summary() : action,
			context.command(),
			context.commandId(),
			context.source(),
			context.function(),
			context.sourceSummary(),
			tick,
			record.timestampMillis(),
			"tick function".equals(context.source()) || isTickFunction(context.function()),
			record
		);
	}

	private static long toTick(long timestampMillis) {
		return timestampMillis / TICK_MILLIS;
	}

	private static long recordTick(EventRecord record) {
		String tick = record.field("tick");
		if (!tick.isBlank()) {
			try {
				return Long.parseLong(tick);
			} catch (NumberFormatException ignored) {
			}
		}
		return toTick(record.timestampMillis());
	}

	private static long currentTick() {
		Minecraft minecraft = Minecraft.getInstance();
		return minecraft.level == null ? toTick(System.currentTimeMillis()) : minecraft.level.getGameTime();
	}

	private static boolean isTickFunction(String function) {
		if (function == null || function.isBlank() || "none".equals(function)) {
			return false;
		}
		if (DatapackTickFunctionIndex.isTickFunction(function)) {
			return true;
		}

		int separator = function.indexOf(':');
		String path = separator >= 0 ? function.substring(separator + 1) : function;
		return "tick".equals(path) || path.endsWith("/tick") || path.startsWith("tick/") || path.contains("/tick/");
	}

	record Field(String name, String value) {
	}

	record EventRecord(
		long id,
		String type,
		String subject,
		String summary,
		List<Field> basicFields,
		List<Field> detailedFields,
		CommandRef commandContext,
		long timestampMillis
	) {
		static EventRecord from(VisibleFunctionEventPayload payload, long id) {
			List<Field> basicFields = parseFields(payload.basic());
			List<Field> detailedFields = parseFields(payload.detailed());
			return new EventRecord(
				id,
				payload.category(),
				payload.subject(),
				payload.summary(),
				basicFields,
				detailedFields,
				CommandRef.from(payload, basicFields),
				System.currentTimeMillis()
			);
		}

		boolean isCommand() {
			return "COMMAND".equals(type);
		}

		boolean isEvent() {
			return "EVENT".equals(type);
		}

		String field(String name) {
			for (Field field : basicFields) {
				if (field.name().equals(name)) {
					return field.value();
				}
			}
			return "";
		}
	}

	record CommandRef(String command, String commandId, String source, String function, String functionCallId) {
		static CommandRef from(VisibleFunctionEventPayload payload, List<Field> fields) {
			String command = "COMMAND".equals(payload.category()) ? payload.subject() : fieldValue(fields, "command", "none");
			return new CommandRef(
				command,
				fieldValue(fields, "command_id", "none"),
				fieldValue(fields, "source", "unknown"),
				fieldValue(fields, "function", "none"),
				fieldValue(fields, "function_call_id", "none")
			);
		}

		boolean hasCommandId() {
			return !"none".equals(commandId) && !commandId.isBlank();
		}

		String displayCommandId() {
			return hasCommandId() ? "#" + commandId : "none";
		}

		boolean hasFunctionCallId() {
			return !"none".equals(functionCallId) && !functionCallId.isBlank();
		}

		String displayFunctionCallId() {
			return hasFunctionCallId() ? "#" + functionCallId : "none";
		}

		long numericCommandId() {
			if (!hasCommandId()) {
				return -1;
			}

			try {
				return Long.parseLong(commandId);
			} catch (NumberFormatException ignored) {
				return -1;
			}
		}

		long numericFunctionCallId() {
			if (!hasFunctionCallId()) {
				return -1;
			}

			try {
				return Long.parseLong(functionCallId);
			} catch (NumberFormatException ignored) {
				return -1;
			}
		}

		String sourceSummary() {
			if (!"none".equals(function)) {
				return (isTickFunction(function) ? "tick function " : "function ") + function;
			}

			return source;
		}
	}

	static final class TraceStore {
		private final Map<Long, EventRecord> recordsById = new LinkedHashMap<>();
		private final Map<Long, EventRecord> commandsByCommandId = new LinkedHashMap<>();
		private final Map<Long, List<EventRecord>> eventsByCommandId = new LinkedHashMap<>();
		private final Map<Long, List<EventRecord>> recordsByFunctionCallId = new LinkedHashMap<>();
		private final Map<String, List<Long>> functionCallsByFunctionId = new LinkedHashMap<>();
		private final Map<EventRecord, Long> functionCallIdsByRecord = new IdentityHashMap<>();
		private long nextSyntheticFunctionCallId = -1;
		private String lastFunctionId = "none";
		private long lastFunctionCallId = -1;
		private long lastFunctionRecordMillis = Long.MIN_VALUE;

		private void add(EventRecord record) {
			recordsById.put(record.id(), record);
			indexCommand(record);
			indexFunctionCall(record);
		}

		private void remove(EventRecord record) {
			recordsById.remove(record.id());

			long commandId = record.commandContext().numericCommandId();
			if (commandId >= 0) {
				if (record.isCommand()) {
					commandsByCommandId.remove(commandId);
				} else {
					removeFromList(eventsByCommandId, commandId, record);
				}
			}

			Long functionCallId = functionCallIdsByRecord.remove(record);
			if (functionCallId != null) {
				removeFromList(recordsByFunctionCallId, functionCallId, record);
				List<EventRecord> records = recordsByFunctionCallId.get(functionCallId);
				if (records == null || records.isEmpty()) {
					String functionId = record.commandContext().function();
					List<Long> calls = functionCallsByFunctionId.get(functionId);
					if (calls != null) {
						calls.remove(functionCallId);
						if (calls.isEmpty()) {
							functionCallsByFunctionId.remove(functionId);
						}
					}
				}
			}
		}

		EventRecord recordById(long recordId) {
			return recordsById.get(recordId);
		}

		EventRecord commandByCommandId(long commandId) {
			return commandsByCommandId.get(commandId);
		}

		EventRecord commandFor(EventRecord record) {
			long commandId = record.commandContext().numericCommandId();
			return commandId < 0 ? null : commandByCommandId(commandId);
		}

		List<EventRecord> eventsByCommandId(long commandId) {
			List<EventRecord> events = eventsByCommandId.get(commandId);
			return events == null ? List.of() : List.copyOf(events);
		}

		List<EventRecord> recordsByFunctionCallId(long functionCallId) {
			List<EventRecord> records = recordsByFunctionCallId.get(functionCallId);
			return records == null ? List.of() : List.copyOf(records);
		}

		List<Long> functionCallsByFunctionId(String functionId) {
			List<Long> calls = functionCallsByFunctionId.get(functionId);
			return calls == null ? List.of() : List.copyOf(calls);
		}

		List<String> functionIds() {
			return List.copyOf(functionCallsByFunctionId.keySet());
		}

		long functionCallId(EventRecord record) {
			return functionCallIdsByRecord.getOrDefault(record, -1L);
		}

		private void indexCommand(EventRecord record) {
			long commandId = record.commandContext().numericCommandId();
			if (commandId < 0) {
				return;
			}

			if (record.isCommand()) {
				commandsByCommandId.put(commandId, record);
			} else {
				eventsByCommandId.computeIfAbsent(commandId, ignored -> new ArrayList<>()).add(record);
			}
		}

		private void indexFunctionCall(EventRecord record) {
			String functionId = record.commandContext().function();
			if ("none".equals(functionId)) {
				return;
			}

			long functionCallId = functionCallIdFor(record, functionId);
			functionCallIdsByRecord.put(record, functionCallId);
			recordsByFunctionCallId.computeIfAbsent(functionCallId, ignored -> new ArrayList<>()).add(record);
			functionCallsByFunctionId.computeIfAbsent(functionId, ignored -> new ArrayList<>());

			List<Long> functionCalls = functionCallsByFunctionId.get(functionId);
			if (functionCalls.isEmpty() || functionCalls.getLast() != functionCallId) {
				functionCalls.add(functionCallId);
			}
		}

		private long functionCallIdFor(EventRecord record, String functionId) {
			long providedCallId = record.commandContext().numericFunctionCallId();
			if (providedCallId >= 0) {
				return providedCallId;
			}

			if (functionId.equals(lastFunctionId)
				&& lastFunctionCallId < 0
				&& record.timestampMillis() - lastFunctionRecordMillis <= FUNCTION_CALL_GAP_MILLIS) {
				lastFunctionRecordMillis = record.timestampMillis();
				return lastFunctionCallId;
			}

			lastFunctionId = functionId;
			lastFunctionCallId = nextSyntheticFunctionCallId--;
			lastFunctionRecordMillis = record.timestampMillis();
			return lastFunctionCallId;
		}

		private static <K> void removeFromList(Map<K, List<EventRecord>> index, K key, EventRecord record) {
			List<EventRecord> records = index.get(key);
			if (records != null) {
				records.remove(record);
				if (records.isEmpty()) {
					index.remove(key);
				}
			}
		}
	}

	enum TickBucketType {
		COMMAND("Commands"),
		FUNCTION("Functions"),
		EVENT("Events");

		private final String label;

		TickBucketType(String label) {
			this.label = label;
		}

		String label() {
			return label;
		}
	}

	static final class TickFilterBucket {
		private final TickFilterEngine.Snapshot<EventRecord> snapshot;

		private TickFilterBucket(TickFilterEngine.Snapshot<EventRecord> snapshot) {
			this.snapshot = snapshot;
		}

		String key() {
			return snapshot.key();
		}

		TickBucketType type() {
			return TickBucketType.valueOf(snapshot.type().name());
		}

		String displayName() {
			return snapshot.displayName();
		}

		long firstSeenTick() {
			return snapshot.firstSeenTick();
		}

		long lastSeenTick() {
			return snapshot.lastSeenTick();
		}

		long totalCount() {
			return snapshot.totalCount();
		}

		int countLastSecond() {
			return snapshot.countLastSecond();
		}

		String sourceSummary() {
			return snapshot.sourceSummary();
		}

		List<EventRecord> sampleRecords() {
			return snapshot.sampleRecords();
		}

		boolean active() {
			return snapshot.active();
		}

		String reason() {
			return snapshot.reason();
		}

		long millisSinceLastSeen() {
			return Math.max(0, currentTick() - snapshot.lastSeenTick()) * TICK_MILLIS;
		}
	}

	record EventGroup(String type, String subject, String summary, List<String> lines) {
		static EventGroup fromLatest(List<EventRecord> records) {
			return fromRecord(records, records.size() - 1);
		}

		static EventGroup fromRecord(List<EventRecord> records, int latestIndex) {
			EventRecord latest = records.get(latestIndex);
			CommandRef context = latest.commandContext();

			if (context.hasCommandId()) {
				List<EventRecord> related = relatedToCommand(records, context.commandId(), latestIndex);
				if (related.size() > 1) {
					return commandGroup(context, related);
				}
			}

			return new EventGroup(latest.type(), latest.subject(), latest.summary(), linesForCompactRecord(latest));
		}

		private static List<EventRecord> relatedToCommand(List<EventRecord> records, String commandId, int latestIndex) {
			List<EventRecord> related = new ArrayList<>();

			for (int index = latestIndex; index >= 0; index--) {
				EventRecord record = records.get(index);
				if (commandId.equals(record.commandContext().commandId())) {
					related.addFirst(record);
					continue;
				}

				if (!related.isEmpty()) {
					break;
				}
			}

			return related;
		}

		private static EventGroup commandGroup(CommandRef commandContext, List<EventRecord> related) {
			int eventCount = 0;
			Map<String, Integer> summoned = new LinkedHashMap<>();
			Map<String, Integer> eventActions = new LinkedHashMap<>();
			List<String> scoreboard = new ArrayList<>();

			for (EventRecord record : related) {
				if (record.isEvent()) {
					eventCount++;
					if (!record.field("event_action").isBlank()) {
						eventActions.merge(record.field("event_action"), 1, Integer::sum);
					}
					if (record.summary().contains("summoned")) {
						summoned.merge(record.subject(), 1, Integer::sum);
					}
				}

				if ("scoreboard".equals(record.field("event_type")) || "scoreboard".equals(record.field("command_type"))) {
					scoreboard.add(record.field("arguments"));
				}
			}

			List<String> lines = new ArrayList<>();
			lines.add("- command_id: " + commandContext.displayCommandId());
			lines.add("- events: " + eventCount);
			if (!summoned.isEmpty()) {
				lines.add("- summoned: " + summarizeCounts(summoned));
			}
			if (!eventActions.isEmpty()) {
				lines.add("- actions: " + summarizeCounts(eventActions));
			}
			if (!scoreboard.isEmpty()) {
				lines.add("- scoreboard: " + String.join("; ", scoreboard));
			}
			if (lines.size() == 1) {
				lines.add("- records: " + related.size());
			}

			return new EventGroup("COMMAND", commandContext.command(), "", lines);
		}

		private static List<String> linesForCompactRecord(EventRecord record) {
			List<String> lines = new ArrayList<>();
			lines.add("- record_id: #" + record.id());
			if (record.isCommand()) {
				lines.add("- command_id: " + record.commandContext().displayCommandId());
				lines.add("- function_call_id: " + record.commandContext().displayFunctionCallId());
				lines.add("- triggered_events: " + TRACE_STORE.eventsByCommandId(record.commandContext().numericCommandId()).size());
			} else if (record.commandContext().hasCommandId()) {
				lines.add("- caused_by_command: " + record.commandContext().displayCommandId());
				lines.add("- function_call_id: " + record.commandContext().displayFunctionCallId());
				EventRecord sourceCommand = TRACE_STORE.commandFor(record);
				if (sourceCommand != null) {
					lines.add("- source_record: #" + sourceCommand.id());
				}
			}
			for (Field field : record.basicFields()) {
				if ("command_id".equals(field.name()) || "function_call_id".equals(field.name())) {
					continue;
				}
				lines.add("- " + field.name() + ": " + field.value());
			}
			return lines;
		}

		private static String summarizeCounts(Map<String, Integer> counts) {
			List<String> parts = new ArrayList<>();
			for (Map.Entry<String, Integer> entry : counts.entrySet()) {
				parts.add(entry.getKey() + " x" + entry.getValue());
			}
			return String.join(", ", parts);
		}
	}

	record DrawnWindow(int height, Rect subjectRect) {
	}

	record Rect(int x, int y, int width, int height) {
		static Rect empty() {
			return new Rect(0, 0, 0, 0);
		}

		boolean contains(double mouseX, double mouseY) {
			return width > 0 && height > 0
				&& mouseX >= x
				&& mouseY >= y
				&& mouseX < x + width
				&& mouseY < y + height;
		}
	}

	private static List<Field> parseFields(String text) {
		List<Field> fields = new ArrayList<>();

		for (String rawLine : text.split("\\R")) {
			String line = rawLine.strip();

			if (!line.startsWith("- ")) {
				continue;
			}

			int separator = line.indexOf(": ");
			if (separator <= 2) {
				continue;
			}

			fields.add(new Field(line.substring(2, separator), line.substring(separator + 2)));
		}

		return fields;
	}

	private static String fieldValue(List<Field> fields, String name, String fallback) {
		for (Field field : fields) {
			if (field.name().equals(name)) {
				return field.value();
			}
		}
		return fallback;
	}
}
