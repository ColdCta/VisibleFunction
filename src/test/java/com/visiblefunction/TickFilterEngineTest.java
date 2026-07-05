package com.visiblefunction;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
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
}
