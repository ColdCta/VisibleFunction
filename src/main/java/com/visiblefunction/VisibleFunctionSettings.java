package com.visiblefunction;

final class VisibleFunctionSettings {
	private static final int MIN_WINDOW_WIDTH = 160;
	private static final int MAX_WINDOW_WIDTH = 640;
	private static final int MIN_WINDOW_LINES = 2;
	private static final int MAX_WINDOW_LINES = 24;
	private static final int MIN_VISIBLE_MILLIS = 1000;
	private static final int MAX_VISIBLE_MILLIS = 60000;
	private static final int MIN_TIMELINE_BUFFER_TICKS = 20;
	private static final int MAX_TIMELINE_BUFFER_TICKS = 1200;
	private static final int MIN_EXPORT_PORT = 1024;
	private static final int MAX_EXPORT_PORT = 65535;

	private volatile boolean enabled = true;
	private volatile OutputTarget outputTarget = OutputTarget.WINDOW;
	private volatile int windowWidth = 320;
	private volatile int windowMaxLines = 6;
	private volatile int windowVisibleMillis = 8000;
	private volatile int timelineBufferTicks = 200;
	private volatile boolean exportEnabled;
	private volatile int exportPort = 17654;

	boolean enabled() {
		return enabled;
	}

	void setEnabled(boolean enabled) {
		this.enabled = enabled;
	}

	OutputTarget outputTarget() {
		return outputTarget;
	}

	void setOutputTarget(OutputTarget outputTarget) {
		this.outputTarget = outputTarget;
	}

	int windowWidth() {
		return windowWidth;
	}

	void setWindowWidth(int windowWidth) {
		this.windowWidth = clamp(windowWidth, MIN_WINDOW_WIDTH, MAX_WINDOW_WIDTH);
	}

	int windowMaxLines() {
		return windowMaxLines;
	}

	void setWindowMaxLines(int windowMaxLines) {
		this.windowMaxLines = clamp(windowMaxLines, MIN_WINDOW_LINES, MAX_WINDOW_LINES);
	}

	int windowVisibleMillis() {
		return windowVisibleMillis;
	}

	void setWindowVisibleMillis(int windowVisibleMillis) {
		this.windowVisibleMillis = clamp(windowVisibleMillis, MIN_VISIBLE_MILLIS, MAX_VISIBLE_MILLIS);
	}

	int timelineBufferTicks() {
		return timelineBufferTicks;
	}

	void setTimelineBufferTicks(int timelineBufferTicks) {
		this.timelineBufferTicks = clamp(timelineBufferTicks, MIN_TIMELINE_BUFFER_TICKS, MAX_TIMELINE_BUFFER_TICKS);
	}

	boolean exportEnabled() {
		return exportEnabled;
	}

	void setExportEnabled(boolean exportEnabled) {
		this.exportEnabled = exportEnabled;
	}

	int exportPort() {
		return exportPort;
	}

	void setExportPort(int exportPort) {
		this.exportPort = clamp(exportPort, MIN_EXPORT_PORT, MAX_EXPORT_PORT);
	}

	private static int clamp(int value, int min, int max) {
		return Math.max(min, Math.min(max, value));
	}

	enum OutputTarget {
		WINDOW("window", true, false, false),
		LOG("log", false, true, false),
		BOTH("both", true, true, false),
		CHAT("chat", false, false, true);

		private final String id;
		private final boolean window;
		private final boolean logs;
		private final boolean chat;

		OutputTarget(String id, boolean window, boolean logs, boolean chat) {
			this.id = id;
			this.window = window;
			this.logs = logs;
			this.chat = chat;
		}

		String id() {
			return id;
		}

		boolean window() {
			return window;
		}

		boolean chat() {
			return chat;
		}

		boolean logs() {
			return logs;
		}
	}
}
