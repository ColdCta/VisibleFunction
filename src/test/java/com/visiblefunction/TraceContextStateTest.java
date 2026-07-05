package com.visiblefunction;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;

class TraceContextStateTest {
	@Test
	void stackSupportsNestedAndOutOfOrderPop() {
		TraceContextStack<Object> stack = new TraceContextStack<>();
		Object outer = new Object();
		Object middle = new Object();
		Object inner = new Object();
		stack.push(outer);
		stack.push(middle);
		stack.push(inner);

		stack.pop(middle);
		assertSame(inner, stack.current());
		stack.pop(inner);
		assertSame(outer, stack.current());
		stack.pop(outer);
		assertNull(stack.current());
	}

	@Test
	void recentContextsExpirePerSourceAndStayBounded() {
		RecentContextStore<Object, String> store = new RecentContextStore<>(5, 3);
		Object firstServer = new Object();
		Object secondServer = new Object();
		for (int index = 0; index < 5; index++) {
			store.retain(firstServer, "context-" + index);
		}
		store.retain(secondServer, "other");

		assertEquals(3, store.size(firstServer));
		assertEquals("context-4", store.current(firstServer));
		assertEquals("other", store.current(secondServer));
		for (int index = 0; index < 5; index++) {
			store.tick(firstServer);
		}
		assertNull(store.current(firstServer));
		assertEquals("other", store.current(secondServer));
	}
}
