package com.visiblefunction;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class DatapackTickFunctionIndexTest {
	@Test
	void acceptsOnlyTopLevelFunctionAndFunctionTagCalls() {
		var direct = DatapackTickFunctionIndex.functionReference("function demo:always");
		var tag = DatapackTickFunctionIndex.functionReference("/function #demo:always");

		assertEquals("demo:always", direct.id().toString());
		assertFalse(direct.tag());
		assertEquals("demo:always", tag.id().toString());
		assertTrue(tag.tag());
	}

	@Test
	void executeWrappedFunctionsDoNotEnterTheStaticTickClosure() {
		assertNull(DatapackTickFunctionIndex.functionReference(
			"execute as @a at @s run function demo:per_player"
		));
		assertNull(DatapackTickFunctionIndex.functionReference(
			"execute if score #ready state matches 1 run function demo:conditional"
		));
		assertNull(DatapackTickFunctionIndex.functionReference(
			"execute on attacker run function demo:contextual"
		));
		assertNull(DatapackTickFunctionIndex.functionReference(
			"execute store result score #x state run function demo:stored"
		));
	}
}
