package com.visiblefunction;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Deque;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

final class TickFilterEngine<T> {
	static final int WINDOW_TICKS = 20;
	static final int HIGH_FREQUENCY_THRESHOLD = 8;
	static final int MAX_SAMPLE_RECORDS = 6;
	static final int MAX_BUCKETS = 4096;
	private static final int DEFAULT_MAX_RECORD_IDS_PER_BUCKET = 8192;
	private static final int MAX_KEY_LENGTH = 768;
	private static final int MAX_DISPLAY_NAME_LENGTH = 256;

	private final Map<String, MutableBucket<T>> buckets = new LinkedHashMap<>();
	private final int maxRecordIdsPerBucket;
	private final int maxSamplesPerBucket;

	TickFilterEngine() {
		this(DEFAULT_MAX_RECORD_IDS_PER_BUCKET, MAX_SAMPLE_RECORDS);
	}

	TickFilterEngine(int maxRecordIdsPerBucket, int maxSamplesPerBucket) {
		this.maxRecordIdsPerBucket = Math.max(0, maxRecordIdsPerBucket);
		this.maxSamplesPerBucket = Math.max(0, maxSamplesPerBucket);
	}

	boolean add(Input<T> input) {
		boolean captured = false;
		for (BucketSpec spec : specs(input)) {
			MutableBucket<T> bucket = buckets.get(spec.key());
			if (bucket == null) {
				ensureCapacity(input.tick());
				bucket = new MutableBucket<>(spec, input, maxRecordIdsPerBucket, maxSamplesPerBucket);
				buckets.put(spec.key(), bucket);
			}
			bucket.add(input);
			captured |= bucket.captured();
		}
		return captured;
	}

	void removeRecord(long recordId) {
		for (MutableBucket<T> bucket : buckets.values()) {
			bucket.removeRecord(recordId);
		}
	}

	boolean isCaptured(Input<T> input) {
		for (BucketSpec spec : specs(input)) {
			MutableBucket<T> bucket = buckets.get(spec.key());
			if (bucket != null && bucket.captured()) {
				return true;
			}
		}
		return false;
	}

	Snapshot<T> bucketFor(Input<T> input, long currentTick) {
		for (BucketSpec spec : specs(input)) {
			MutableBucket<T> bucket = buckets.get(spec.key());
			if (bucket != null && bucket.captured()) {
				return bucket.snapshot(currentTick);
			}
		}
		return null;
	}

	List<Snapshot<T>> snapshots(long currentTick) {
		List<Snapshot<T>> result = new ArrayList<>();
		for (MutableBucket<T> bucket : buckets.values()) {
			if (bucket.captured()) {
				result.add(bucket.snapshot(currentTick));
			}
		}
		result.sort(Comparator
			.comparingInt((Snapshot<T> bucket) -> bucket.countLastSecond())
			.reversed()
			.thenComparing(Comparator.comparingLong((Snapshot<T> bucket) -> bucket.lastSeenTick()).reversed()));
		return List.copyOf(result);
	}

	List<Snapshot<T>> snapshots(BucketType type, boolean active, long currentTick) {
		return snapshots(currentTick).stream()
			.filter(bucket -> bucket.type() == type && bucket.active() == active)
			.toList();
	}

	void clearInactive(long currentTick) {
		buckets.entrySet().removeIf(entry -> {
			MutableBucket<T> bucket = entry.getValue();
			return bucket.captured() && !bucket.active(currentTick);
		});
	}

	void clear() {
		buckets.clear();
	}

	int capturedCount() {
		int count = 0;
		for (MutableBucket<T> bucket : buckets.values()) {
			if (bucket.captured()) {
				count++;
			}
		}
		return count;
	}

	private void ensureCapacity(long currentTick) {
		if (buckets.size() < MAX_BUCKETS) {
			return;
		}

		String candidate = null;
		long oldestTick = Long.MAX_VALUE;
		for (Map.Entry<String, MutableBucket<T>> entry : buckets.entrySet()) {
			MutableBucket<T> bucket = entry.getValue();
			if (!bucket.active(currentTick) && bucket.lastSeenTick < oldestTick) {
				candidate = entry.getKey();
				oldestTick = bucket.lastSeenTick;
			}
		}
		if (candidate == null) {
			for (Map.Entry<String, MutableBucket<T>> entry : buckets.entrySet()) {
				if (entry.getValue().lastSeenTick < oldestTick) {
					candidate = entry.getKey();
					oldestTick = entry.getValue().lastSeenTick;
				}
			}
		}
		if (candidate != null) {
			buckets.remove(candidate);
		}
	}

	private static <T> List<BucketSpec> specs(Input<T> input) {
		List<BucketSpec> specs = new ArrayList<>(3);
		if ("COMMAND".equals(input.category())) {
			String command = normalize(input.command().isBlank() ? input.displayName() : input.command());
			if (!command.isBlank()) {
				specs.add(new BucketSpec(
					boundedKey("COMMAND:" + command + "|" + input.source() + "|" + input.functionId()),
					BucketType.COMMAND,
					boundedDisplayName(command)
				));
			}
		}
		if ("EVENT".equals(input.category())) {
			specs.add(new BucketSpec(
				boundedKey("EVENT:" + input.eventAction() + "|" + input.displayName() + "|" + input.command()),
				BucketType.EVENT,
				boundedDisplayName(input.displayName())
			));
		}
		if (hasFunction(input.functionId())) {
			specs.add(new BucketSpec(
				boundedKey("FUNCTION:" + input.functionId()),
				BucketType.FUNCTION,
				boundedDisplayName(input.functionId())
			));
		}
		return specs;
	}

	private static boolean hasFunction(String functionId) {
		return functionId != null && !functionId.isBlank() && !"none".equals(functionId);
	}

	private static String normalize(String command) {
		return command == null ? "" : command.trim().replaceAll("\\s+", " ");
	}

	private static String boundedKey(String key) {
		if (key.length() <= MAX_KEY_LENGTH) {
			return key;
		}
		return key.substring(0, MAX_KEY_LENGTH - 17) + "#" + Integer.toUnsignedString(key.hashCode(), 16);
	}

	private static String boundedDisplayName(String displayName) {
		if (displayName.length() <= MAX_DISPLAY_NAME_LENGTH) {
			return displayName;
		}
		return displayName.substring(0, MAX_DISPLAY_NAME_LENGTH - 3) + "...";
	}

	enum BucketType {
		COMMAND,
		FUNCTION,
		EVENT
	}

	record Input<T>(
		long recordId,
		String category,
		String displayName,
		String eventAction,
		String command,
		String commandId,
		String source,
		String functionId,
		String sourceSummary,
		long tick,
		long timestampMillis,
		boolean tickFunction,
		T sample
	) {
		Input {
			category = value(category, "OTHER");
			displayName = value(displayName, "unknown");
			eventAction = value(eventAction, "none");
			command = value(command, "none");
			commandId = value(commandId, "none");
			source = value(source, "unknown");
			functionId = value(functionId, "none");
			sourceSummary = value(sourceSummary, source);
		}

		private static String value(String value, String fallback) {
			return value == null || value.isBlank() ? fallback : value;
		}
	}

	record Snapshot<T>(
		String key,
		BucketType type,
		String displayName,
		long firstSeenTick,
		long lastSeenTick,
		long startMillis,
		long endMillis,
		long totalCount,
		int countLastSecond,
		String sourceSummary,
		String reason,
		boolean active,
		List<Long> recordIds,
		List<String> commandIds,
		List<T> sampleRecords
	) {
	}

	private record BucketSpec(String key, BucketType type, String displayName) {
	}

	private static final class MutableBucket<T> {
		private final String key;
		private final BucketType type;
		private final String displayName;
		private final long firstSeenTick;
		private final Deque<TickCount> recentCounts = new ArrayDeque<>();
		private final Deque<Sample<T>> sampleRecords = new ArrayDeque<>();
		private final Set<Long> recordIds = new LinkedHashSet<>();
		private final Map<Long, String> commandIdByRecord = new LinkedHashMap<>();
		private final Map<String, Integer> commandIdCounts = new LinkedHashMap<>();
		private final int maxRecordIds;
		private final int maxSamples;
		private long lastSeenTick;
		private long startMillis;
		private long endMillis;
		private long totalCount;
		private String sourceSummary;
		private boolean highFrequency;
		private boolean tickFunction;

		private MutableBucket(BucketSpec spec, Input<T> input, int maxRecordIds, int maxSamples) {
			key = spec.key();
			type = spec.type();
			displayName = spec.displayName();
			firstSeenTick = input.tick();
			lastSeenTick = input.tick();
			startMillis = input.timestampMillis();
			endMillis = input.timestampMillis();
			sourceSummary = input.sourceSummary();
			this.maxRecordIds = maxRecordIds;
			this.maxSamples = maxSamples;
		}

		private void add(Input<T> input) {
			totalCount++;
			lastSeenTick = input.tick();
			startMillis = Math.min(startMillis, input.timestampMillis());
			endMillis = Math.max(endMillis, input.timestampMillis());
			sourceSummary = input.sourceSummary();
			tickFunction |= input.tickFunction() || "tick function".equals(input.source());

			TickCount latest = recentCounts.peekLast();
			if (latest != null && latest.tick == input.tick()) {
				latest.count++;
			} else {
				recentCounts.addLast(new TickCount(input.tick(), 1));
			}
			pruneRecent(input.tick());
			highFrequency |= recentCount() >= HIGH_FREQUENCY_THRESHOLD;

			recordIds.add(input.recordId());
			if (!"none".equals(input.commandId())) {
				commandIdByRecord.put(input.recordId(), input.commandId());
				commandIdCounts.merge(input.commandId(), 1, Integer::sum);
			}
			while (recordIds.size() > maxRecordIds) {
				Iterator<Long> iterator = recordIds.iterator();
				long removedId = iterator.next();
				iterator.remove();
				removeCommandId(removedId);
			}

			if (maxSamples > 0 && sampleRecords.size() >= maxSamples) {
				sampleRecords.removeFirst();
			}
			if (maxSamples > 0) {
				sampleRecords.addLast(new Sample<>(input.recordId(), input.sample()));
			}
		}

		private void removeRecord(long recordId) {
			recordIds.remove(recordId);
			removeCommandId(recordId);
			sampleRecords.removeIf(sample -> sample.recordId == recordId);
		}

		private void removeCommandId(long recordId) {
			String commandId = commandIdByRecord.remove(recordId);
			if (commandId == null) {
				return;
			}
			int remaining = commandIdCounts.getOrDefault(commandId, 1) - 1;
			if (remaining <= 0) {
				commandIdCounts.remove(commandId);
			} else {
				commandIdCounts.put(commandId, remaining);
			}
		}

		private boolean captured() {
			return highFrequency || tickFunction;
		}

		private boolean active(long currentTick) {
			pruneRecent(currentTick);
			return captured() && recentCount() > 0;
		}

		private Snapshot<T> snapshot(long currentTick) {
			pruneRecent(currentTick);
			List<T> samples = sampleRecords.stream().map(Sample::value).toList();
			return new Snapshot<>(
				key,
				type,
				displayName,
				firstSeenTick,
				lastSeenTick,
				startMillis,
				endMillis,
				totalCount,
				recentCount(),
				tickFunction ? tickSourceSummary(sourceSummary) : sourceSummary,
				reason(),
				captured() && recentCount() > 0,
				List.copyOf(recordIds),
				List.copyOf(commandIdCounts.keySet()),
				samples
			);
		}

		private String reason() {
			if (tickFunction && highFrequency) {
				return "tick function + high frequency";
			}
			return tickFunction ? "tick function" : "high frequency";
		}

		private int recentCount() {
			long count = 0;
			for (TickCount tickCount : recentCounts) {
				count += tickCount.count;
			}
			return (int) Math.min(Integer.MAX_VALUE, count);
		}

		private void pruneRecent(long currentTick) {
			while (!recentCounts.isEmpty() && currentTick - recentCounts.peekFirst().tick > WINDOW_TICKS) {
				recentCounts.removeFirst();
			}
		}

		private static String tickSourceSummary(String sourceSummary) {
			if (sourceSummary == null || sourceSummary.isBlank() || "unknown".equals(sourceSummary)) {
				return "tick function";
			}
			return sourceSummary.startsWith("tick function") ? sourceSummary : "tick function " + sourceSummary;
		}
	}

	private static final class TickCount {
		private final long tick;
		private int count;

		private TickCount(long tick, int count) {
			this.tick = tick;
			this.count = count;
		}
	}

	private record Sample<T>(long recordId, T value) {
	}
}
