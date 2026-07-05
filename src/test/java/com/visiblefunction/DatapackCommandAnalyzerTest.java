package com.visiblefunction;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class DatapackCommandAnalyzerTest {
	@Test
	void preservesExecuteConditionsSelectorsAndNestedFunctionCall() {
		var warnings = new ArrayList<String>();
		var analysis = DatapackCommandAnalyzer.analyze(
			"demo:tick",
			4,
			"execute as @s[scores={timer=0},tag=ready] if score #x timer matches 1.. run function demo:next",
			warnings
		);

		assertTrue(warnings.isEmpty());
		assertTrue(analysis.execute().present());
		assertEquals("/function demo:next", analysis.execute().runCommand());
		assertEquals("demo:next", analysis.calls().getFirst().id());
		assertFalse(analysis.execute().conditions().isEmpty());
		assertTrue(analysis.variablesRead().stream().anyMatch(value -> value.contains("timer")));
		assertTrue(analysis.selectors().stream().anyMatch(selector -> selector.raw().startsWith("@s")));
	}

	@Test
	void indexesStorageWrites() {
		var analysis = DatapackCommandAnalyzer.analyze(
			"demo:write",
			2,
			"data modify storage demo:cache wave.current set value 3",
			new ArrayList<>()
		);
		assertTrue(analysis.variablesWritten().stream().anyMatch(value -> value.contains("storage:demo:cache")));
	}
}
