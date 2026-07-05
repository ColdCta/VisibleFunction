package com.visiblefunction;

import java.util.ArrayDeque;
import java.util.Collections;
import java.util.Deque;
import java.util.Iterator;
import java.util.Map;
import java.util.WeakHashMap;

final class RecentContextStore<S, T> {
	private final Map<S, Deque<Entry<T>>> contexts = Collections.synchronizedMap(new WeakHashMap<>());
	private final int retainTicks;
	private final int maxPerSource;

	RecentContextStore(int retainTicks, int maxPerSource) {
		this.retainTicks = retainTicks;
		this.maxPerSource = maxPerSource;
	}

	void retain(S source, T context) {
		Deque<Entry<T>> retained = contexts.computeIfAbsent(source, ignored -> new ArrayDeque<>());
		retained.addFirst(new Entry<>(context, retainTicks));
		while (retained.size() > maxPerSource) {
			retained.removeLast();
		}
	}

	T current(S source) {
		Deque<Entry<T>> retained = contexts.get(source);
		return retained == null || retained.isEmpty() ? null : retained.peekFirst().context;
	}

	void tick(S source) {
		Deque<Entry<T>> retained = contexts.get(source);
		if (retained == null) {
			return;
		}
		Iterator<Entry<T>> iterator = retained.iterator();
		while (iterator.hasNext()) {
			Entry<T> entry = iterator.next();
			entry.ticksRemaining--;
			if (entry.ticksRemaining <= 0) {
				iterator.remove();
			}
		}
		if (retained.isEmpty()) {
			contexts.remove(source);
		}
	}

	int size(S source) {
		Deque<Entry<T>> retained = contexts.get(source);
		return retained == null ? 0 : retained.size();
	}

	private static final class Entry<T> {
		private final T context;
		private int ticksRemaining;

		private Entry(T context, int ticksRemaining) {
			this.context = context;
			this.ticksRemaining = ticksRemaining;
		}
	}
}
