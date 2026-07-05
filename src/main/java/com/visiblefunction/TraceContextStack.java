package com.visiblefunction;

import java.util.ArrayDeque;
import java.util.Deque;

final class TraceContextStack<T> {
	private final Deque<T> contexts = new ArrayDeque<>();

	void push(T context) {
		contexts.push(context);
	}

	void pop(T context) {
		if (!contexts.isEmpty() && contexts.peek() == context) {
			contexts.pop();
		} else {
			contexts.remove(context);
		}
	}

	T current() {
		return contexts.peek();
	}

	boolean isEmpty() {
		return contexts.isEmpty();
	}
}
