package com.visiblefunction;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TickFilterEngineTest {
	@Test
	void tickFunctionIsCapturedImmediatelyAndBecomesInactive() {
		TickFilterEngine<String> engine = new TickFilterEngine<>();
		TickFilterEngine.Input<String> input = input(1, 0, true, "demo:tick");

		assertTrue(engine.add(input));
		assertTrue(engine.snapshots(0).getFirst().active());
		assertFalse(engine.snapshots(21).getFirst().active());
		assertEquals("tick function", engine.snapshots(21).getFirst().reason());
	}

	@Test
	void highFrequencyUsesCountsPerTickInsteadOfOneQueueEntryPerRecord() {
		TickFilterEngine<String> engine = new TickFilterEngine<>();
		for (int index = 0; index < TickFilterEngine.HIGH_FREQUENCY_THRESHOLD; index++) {
			engine.add(input(index + 1, 10, false, "none"));
		}

		var bucket = engine.snapshots(10).getFirst();
		assertEquals(TickFilterEngine.HIGH_FREQUENCY_THRESHOLD, bucket.countLastSecond());
		assertEquals("high frequency", bucket.reason());
	}

	@Test
	void eighthRecordProducesOneTransitionAndEarlierRecordsShareTheGroupId() {
		TickFilterEngine<String> engine = new TickFilterEngine<>();
		String groupId = null;
		for (int index = 0; index < TickFilterEngine.HIGH_FREQUENCY_THRESHOLD; index++) {
			var result = engine.addDetailed(input(index + 1, index, false, "none"));
			assertEquals(1, result.groupIds().size());
			if (groupId == null) {
				groupId = result.groupIds().getFirst();
			}
			assertEquals(groupId, result.groupIds().getFirst());
			assertEquals(index == TickFilterEngine.HIGH_FREQUENCY_THRESHOLD - 1 ? 1 : 0, result.newlyCaptured().size());
		}

		var ninth = engine.addDetailed(input(9, 9, false, "none"));
		assertTrue(ninth.captured());
		assertTrue(ninth.newlyCaptured().isEmpty());
		assertEquals(groupId, ninth.capturedGroupIds().getFirst());
	}

	@Test
	void canonicalGroupIdsAreStableAcrossEngineRecomputation() {
		var first = new TickFilterEngine<String>().addDetailed(input(1, 10, true, "demo:tick"));
		var recomputed = new TickFilterEngine<String>().addDetailed(input(1, 10, true, "demo:tick"));

		assertEquals(first.groupIds(), recomputed.groupIds());
		assertEquals(32, first.groupIds().getFirst().length());
	}

	@Test
	void functionBucketParentsCommandAndEventBuckets() {
		TickFilterEngine<String> engine = new TickFilterEngine<>();
		engine.addDetailed(input(1, 10, true, "demo:tick"));
		engine.addDetailed(eventInput(2, 10, "demo:tick"));

		var snapshots = engine.snapshots(10);
		var function = snapshots.stream().filter(bucket -> bucket.type() == TickFilterEngine.BucketType.FUNCTION).findFirst().orElse(null);
		assertNotNull(function);
		var children = snapshots.stream().filter(bucket -> bucket.type() != TickFilterEngine.BucketType.FUNCTION).toList();
		assertEquals(2, children.size());
		assertTrue(children.stream().allMatch(bucket -> function.groupId().equals(bucket.parentGroupId())));
		assertTrue(children.stream().allMatch(bucket -> "demo:tick".equals(bucket.functionId())));
	}

	@Test
	void removingRetainedRecordDropsItsMembership() {
		TickFilterEngine<String> engine = new TickFilterEngine<>();
		for (int index = 0; index < 8; index++) {
			engine.add(input(index + 1, index, false, "none"));
		}
		engine.removeRecord(1);

		assertFalse(engine.snapshots(8).getFirst().recordIds().contains(1L));
	}

	private static TickFilterEngine.Input<String> input(long id, long tick, boolean tickFunction, String function) {
		return new TickFilterEngine.Input<>(
			id,
			"COMMAND",
			"say hi",
			"none",
			"say hi",
			"command-1",
			tickFunction ? "tick function" : "function",
			function,
			tickFunction ? "tick function " + function : "function",
			tick,
			tick * 50,
			tickFunction,
			"sample-" + id
		);
	}

	private static TickFilterEngine.Input<String> eventInput(long id, long tick, String function) {
		return new TickFilterEngine.Input<>(
			id,
			"EVENT",
			"score changed",
			"score changed",
			"execute as @a",
			"command-1",
			"tick function",
			function,
			"tick function " + function,
			tick,
			tick * 50,
			true,
			"sample-" + id
		);
	}
}
