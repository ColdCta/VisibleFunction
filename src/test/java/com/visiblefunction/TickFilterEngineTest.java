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
	void highFrequencyWithoutStaticTickIdentityIsNeverCaptured() {
		TickFilterEngine<String> engine = new TickFilterEngine<>();
		for (int index = 0; index < 100; index++) {
			var result = engine.addDetailed(input(index + 1, 10, false, "none"));
			assertFalse(result.captured());
			assertTrue(result.groupIds().isEmpty());
			assertTrue(result.newlyCaptured().isEmpty());
		}
		assertTrue(engine.snapshots(10).isEmpty());
	}

	@Test
	void staticTickProducesOneTransitionOnTheFirstRecord() {
		TickFilterEngine<String> engine = new TickFilterEngine<>();
		var first = engine.addDetailed(input(1, 1, true, "demo:tick"));
		assertTrue(first.captured());
		assertEquals(2, first.groupIds().size());
		assertEquals(2, first.newlyCaptured().size());

		var second = engine.addDetailed(input(2, 2, true, "demo:tick"));
		assertTrue(second.captured());
		assertEquals(first.groupIds(), second.groupIds());
		assertTrue(second.newlyCaptured().isEmpty());
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
			engine.add(input(index + 1, index, true, "demo:tick"));
		}
		engine.removeRecord(1);

		assertTrue(engine.snapshots(8).stream().noneMatch(bucket -> bucket.recordIds().contains(1L)));
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
