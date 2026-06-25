package com.visiblefunction;

import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.input.CharacterEvent;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.network.chat.Component;
import org.lwjgl.glfw.GLFW;

import java.util.ArrayList;
import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

public final class VisibleFunctionScreen extends Screen {
	private static final int PADDING = 8;
	private static final int ROW_HEIGHT = 24;
	private static final int FILTER_HEIGHT = 16;
	private static final int TREE_ROW_HEIGHT = 16;
	private static final int TREE_CONTROL_HEIGHT = FILTER_HEIGHT + 8;
	private static final int TIMELINE_HEIGHT = 132;
	private static final int TIMELINE_TICK_MILLIS = 50;
	private static final int TIMELINE_DEFAULT_BUFFER_TICKS = 200;
	private static final int TIMELINE_TICK_TRACKS = 6;
	private static final int TIMELINE_TICK_LINE_COLOR = 0xFFFF4050;
	private static final int TIMELINE_TICK_LINE_SELECTED_COLOR = 0xFFFFD28A;

	private ViewMode viewMode = ViewMode.HISTORY;
	private FilterMode filterMode = FilterMode.ALL;
	private VisibleFunctionHud.TickBucketType tickBucketType = VisibleFunctionHud.TickBucketType.COMMAND;
	private int timelineBufferTicks = TIMELINE_DEFAULT_BUFFER_TICKS;
	private int scrollOffset;
	private int olderScrollOffset;
	private int treeScrollOffset;
	private int olderTreeScrollOffset;
	private int tickFilterScrollOffset;
	private int inactiveTickFilterScrollOffset;
	private int selectedIndex = -1;
	private int selectedTreeIndex = -1;
	private int selectedTickBucketIndex = -1;
	private int recentFunctionCallCount;
	private int olderFunctionCallCount;
	private boolean detailed = true;
	private String searchText = "";
	private TimelineTarget timelineSelection;
	private final Set<VisibleFunctionHud.EventRecord> timelineHighlightedRecords = Collections.newSetFromMap(new IdentityHashMap<>());
	private VisibleFunctionHud.Rect timelinePanelRect = VisibleFunctionHud.Rect.empty();
	private List<VisibleFunctionHud.EventRecord> visibleRecords = List.of();
	private List<VisibleFunctionHud.EventRecord> recentRecords = List.of();
	private List<VisibleFunctionHud.EventRecord> olderRecords = List.of();
	private List<TreeRow> treeRows = List.of();
	private List<TreeRow> recentTreeRows = List.of();
	private List<TreeRow> olderTreeRows = List.of();
	private List<VisibleFunctionHud.TickFilterBucket> tickBuckets = List.of();
	private List<VisibleFunctionHud.TickFilterBucket> activeTickBuckets = List.of();
	private List<VisibleFunctionHud.TickFilterBucket> inactiveTickBuckets = List.of();
	private final List<ClickableViewRect> viewRects = new ArrayList<>();
	private final List<ClickableRect> filterRects = new ArrayList<>();
	private final List<TickBucketTabRect> tickBucketTabRects = new ArrayList<>();
	private final List<RowRect> rowRects = new ArrayList<>();
	private final List<TreeRowRect> treeRowRects = new ArrayList<>();
	private final List<TickBucketRect> tickBucketRects = new ArrayList<>();
	private final List<HistoryActionButtonRect> historyActionButtonRects = new ArrayList<>();
	private final List<TickFilterActionButtonRect> tickFilterActionButtonRects = new ArrayList<>();
	private final List<TimelineHitRect> timelineHitRects = new ArrayList<>();
	private final List<TimelineControlButtonRect> timelineControlButtonRects = new ArrayList<>();

	VisibleFunctionScreen() {
		super(Component.literal("VisibleFunction"));
	}

	@Override
	public void extractRenderState(GuiGraphicsExtractor guiGraphics, int mouseX, int mouseY, float partialTick) {
		clearInteractiveRects();
		setHistoryRecords(filteredRecords());
		this.treeRows = functionTreeRows();
		this.tickBuckets = tickFilterBuckets();
		clampSelection();

		int leftWidth = Math.min(360, Math.max(240, this.width / 3));
		int rightX = leftWidth + PADDING * 2;
		int rightWidth = this.width - rightX - PADDING;
		int top = PADDING;
		int listY;

		drawViewTabs(guiGraphics, PADDING, top);

		if (viewMode == ViewMode.HISTORY) {
			drawFilters(guiGraphics, PADDING, top + FILTER_HEIGHT + 4);
			drawSearch(guiGraphics, PADDING, top + FILTER_HEIGHT * 2 + 8, leftWidth);
			listY = top + FILTER_HEIGHT * 3 + PADDING;
		} else if (viewMode == ViewMode.FUNCTION_TREE) {
			drawSearch(guiGraphics, PADDING, top + FILTER_HEIGHT + 4, leftWidth);
			listY = top + FILTER_HEIGHT * 2 + PADDING;
		} else {
			drawFilteredNotice(guiGraphics, PADDING, top + FILTER_HEIGHT + 4, leftWidth);
			drawSearch(guiGraphics, PADDING, top + FILTER_HEIGHT * 2 + 8, leftWidth);
			listY = top + FILTER_HEIGHT * 3 + PADDING;
		}

		int listHeight = this.height - listY - PADDING;

		if (viewMode == ViewMode.HISTORY) {
			drawHistory(guiGraphics, PADDING, listY, leftWidth, listHeight);
		} else if (viewMode == ViewMode.FUNCTION_TREE) {
			if (treeRows.isEmpty()) {
				drawEmptyList(guiGraphics, PADDING, listY, leftWidth, listHeight, "VisibleFunction has no function records yet.");
			} else {
				drawFunctionTree(guiGraphics, PADDING, listY, leftWidth, listHeight);
			}
		} else {
			if (tickBuckets.isEmpty()) {
				drawTickFilterEmpty(guiGraphics, PADDING, listY, leftWidth, listHeight);
			} else {
				drawTickFilter(guiGraphics, PADDING, listY, leftWidth, listHeight);
			}
		}

		if (viewMode == ViewMode.TICK_FILTER) {
			if (tickBuckets.isEmpty()) {
				drawEmptyDetail(guiGraphics, rightX, top, rightWidth, "No tick/high-frequency buckets yet.");
			} else {
				drawTickBucketDetail(guiGraphics, rightX, top, rightWidth);
			}
		} else {
			VisibleFunctionHud.EventRecord selected = selectedRecord();
			if (selected == null) {
				drawEmptyDetail(guiGraphics, rightX, top, rightWidth, "Select a record to inspect details.");
			} else {
				int lineLimit = Math.max(VisibleFunctionHud.configuredMaxLines(), detailed ? 18 : 8);
				VisibleFunctionHud.drawRecordWindow(
					guiGraphics,
					this.font,
					rightX,
					top,
					rightWidth,
					selected,
					true,
					detailed,
					lineLimit
				);
			}
		}

		guiGraphics.text(
			this.font,
			helpText(),
			rightX,
			this.height - 18,
			0xFFBFC7D5
		);
		drawTimeline(guiGraphics, rightX, rightWidth);
	}

	@Override
	public boolean mouseClicked(MouseButtonEvent event, boolean doubleClick) {
		if (event.button() != 0) {
			return super.mouseClicked(event, doubleClick);
		}

		if (handleTimelineClick(event, doubleClick)) {
			return true;
		}

		for (ClickableRect rect : filterRects) {
			if (rect.rect().contains(event.x(), event.y())) {
				clearTimelineSelection();
				filterMode = rect.filterMode();
				scrollOffset = 0;
				treeScrollOffset = 0;
				olderTreeScrollOffset = 0;
				selectedIndex = -1;
				selectedTreeIndex = -1;
				return true;
			}
		}

		for (ClickableViewRect rect : viewRects) {
			if (rect.rect().contains(event.x(), event.y())) {
				clearTimelineSelection();
				setViewMode(rect.viewMode());
				return true;
			}
		}

		for (TickBucketTabRect rect : tickBucketTabRects) {
			if (rect.rect().contains(event.x(), event.y())) {
				clearTimelineSelection();
				tickBucketType = rect.type();
				tickFilterScrollOffset = 0;
				inactiveTickFilterScrollOffset = 0;
				selectedTickBucketIndex = -1;
				return true;
			}
		}

		for (TickFilterActionButtonRect rect : tickFilterActionButtonRects) {
			if (rect.rect().contains(event.x(), event.y())) {
				clearTimelineSelection();
				VisibleFunctionHud.clearInactiveTickFilterBuckets();
				inactiveTickFilterScrollOffset = 0;
				selectedTickBucketIndex = -1;
				return true;
			}
		}

		for (RowRect rowRect : rowRects) {
			if (rowRect.rect().contains(event.x(), event.y())) {
				clearTimelineSelection();
				selectedIndex = rowRect.recordIndex();
				return true;
			}
		}

		for (TreeRowRect rowRect : treeRowRects) {
			if (rowRect.rect().contains(event.x(), event.y())) {
				clearTimelineSelection();
				selectedTreeIndex = rowRect.rowIndex();
				TreeRow row = treeRows.get(selectedTreeIndex);
				if (row.record() != null) {
					selectedIndex = visibleRecords.indexOf(row.record());
				}
				return true;
			}
		}

		for (TickBucketRect bucketRect : tickBucketRects) {
			if (bucketRect.rect().contains(event.x(), event.y())) {
				clearTimelineSelection();
				selectedTickBucketIndex = bucketRect.bucketIndex();
				return true;
			}
		}

		for (HistoryActionButtonRect rect : historyActionButtonRects) {
			if (rect.rect().contains(event.x(), event.y())) {
				clearTimelineSelection();
				if (rect.action() == HistoryAction.MOVE_TO_OLDER) {
					VisibleFunctionHud.moveRecentHistoryToOlder();
					scrollOffset = 0;
					olderScrollOffset = 0;
					treeScrollOffset = 0;
					olderTreeScrollOffset = 0;
					selectedTreeIndex = -1;
				} else if (rect.action() == HistoryAction.CLEAR_OLDER) {
					VisibleFunctionHud.clearOlderHistoryRecords();
					olderScrollOffset = 0;
					treeScrollOffset = 0;
					olderTreeScrollOffset = 0;
					selectedTreeIndex = -1;
				}
				selectedIndex = -1;
				return true;
			}
		}

		detailed = !detailed;
		return true;
	}

	private boolean handleTimelineClick(MouseButtonEvent event, boolean doubleClick) {
		if (!timelinePanelRect.contains(event.x(), event.y())) {
			return false;
		}

		for (TimelineControlButtonRect rect : timelineControlButtonRects) {
			if (rect.rect().contains(event.x(), event.y())) {
				VisibleFunctionHud.toggleTimelinePaused();
				clearTimelineSelection();
				return true;
			}
		}

		for (int index = timelineHitRects.size() - 1; index >= 0; index--) {
			TimelineHitRect hitRect = timelineHitRects.get(index);
			if (!hitRect.rect().contains(event.x(), event.y())) {
				continue;
			}

			timelineHighlightedRecords.clear();
			if (doubleClick) {
				jumpToTimelineTarget(hitRect.target());
				timelineSelection = null;
			} else {
				timelineSelection = hitRect.target();
			}
			return true;
		}

		clearTimelineSelection();
		return true;
	}

	@Override
	public boolean mouseScrolled(double mouseX, double mouseY, double scrollX, double scrollY) {
		if (viewMode == ViewMode.HISTORY && visibleRecords.isEmpty()) {
			return true;
		}

		if (viewMode == ViewMode.FUNCTION_TREE && treeRows.isEmpty()) {
			return true;
		}

		if (viewMode == ViewMode.TICK_FILTER && tickBuckets.isEmpty()) {
			return true;
		}

		if (viewMode == ViewMode.HISTORY) {
			if (mouseY >= historyOlderSectionY()) {
				olderScrollOffset = Math.max(0, Math.min(Math.max(0, olderRecords.size() - visibleOlderRowCount()), olderScrollOffset - (int) Math.signum(scrollY)));
			} else {
				scrollOffset = Math.max(0, Math.min(Math.max(0, recentRecords.size() - visibleRecentRowCount()), scrollOffset - (int) Math.signum(scrollY)));
			}
		} else if (viewMode == ViewMode.FUNCTION_TREE) {
			if (mouseY >= functionTreeOlderSectionY()) {
				olderTreeScrollOffset = Math.max(0, Math.min(Math.max(0, olderTreeRows.size() - visibleOlderTreeRowCount()), olderTreeScrollOffset - (int) Math.signum(scrollY)));
			} else {
				treeScrollOffset = Math.max(0, Math.min(Math.max(0, recentTreeRows.size() - visibleRecentTreeRowCount()), treeScrollOffset - (int) Math.signum(scrollY)));
			}
		} else {
			if (mouseY >= tickFilterInactiveSectionY()) {
				inactiveTickFilterScrollOffset = Math.max(0, Math.min(Math.max(0, inactiveTickBuckets.size() - visibleInactiveTickBucketRowCount()), inactiveTickFilterScrollOffset - (int) Math.signum(scrollY)));
			} else {
				tickFilterScrollOffset = Math.max(0, Math.min(Math.max(0, activeTickBuckets.size() - visibleTickBucketRowCount()), tickFilterScrollOffset - (int) Math.signum(scrollY)));
			}
		}
		return true;
	}

	@Override
	public boolean keyPressed(KeyEvent event) {
		return switch (event.key()) {
			case GLFW.GLFW_KEY_1 -> numberShortcut(FilterMode.ALL, VisibleFunctionHud.TickBucketType.COMMAND);
			case GLFW.GLFW_KEY_2 -> numberShortcut(FilterMode.COMMANDS, VisibleFunctionHud.TickBucketType.FUNCTION);
			case GLFW.GLFW_KEY_3 -> numberShortcut(FilterMode.EVENTS, VisibleFunctionHud.TickBucketType.EVENT);
			case GLFW.GLFW_KEY_4 -> viewMode == ViewMode.HISTORY ? setFilter(FilterMode.FUNCTION) : true;
			case GLFW.GLFW_KEY_5 -> viewMode == ViewMode.HISTORY ? setFilter(FilterMode.HIDE_PLAYER) : true;
			case GLFW.GLFW_KEY_T -> {
				setViewMode(viewMode.next());
				yield true;
			}
			case GLFW.GLFW_KEY_BACKSPACE -> {
				if (!searchText.isEmpty()) {
					searchText = searchText.substring(0, searchText.length() - 1);
					scrollOffset = 0;
					olderScrollOffset = 0;
					selectedIndex = -1;
				}
				yield true;
			}
			case GLFW.GLFW_KEY_ENTER, GLFW.GLFW_KEY_KP_ENTER -> {
				if (timelineSelection != null) {
					jumpToTimelineTarget(timelineSelection);
					timelineSelection = null;
				} else if (!jumpToSourceCommand()) {
					detailed = !detailed;
				}
				yield true;
			}
			case GLFW.GLFW_KEY_UP -> {
				moveSelection(-1);
				yield true;
			}
			case GLFW.GLFW_KEY_DOWN -> {
				moveSelection(1);
				yield true;
			}
			default -> super.keyPressed(event);
		};
	}

	@Override
	public boolean charTyped(CharacterEvent event) {
		if (!event.isAllowedChatCharacter()) {
			return false;
		}

		String character = event.codepointAsString();
		if ("\\".equals(character)) {
			return true;
		}

		searchText += character;
		scrollOffset = 0;
		olderScrollOffset = 0;
		treeScrollOffset = 0;
		olderTreeScrollOffset = 0;
		tickFilterScrollOffset = 0;
		inactiveTickFilterScrollOffset = 0;
		selectedIndex = -1;
		selectedTreeIndex = -1;
		selectedTickBucketIndex = -1;
		return true;
	}

	@Override
	public boolean isPauseScreen() {
		return false;
	}

	private void drawFilters(GuiGraphicsExtractor guiGraphics, int x, int y) {
		int cursorX = x;

		for (FilterMode mode : FilterMode.values()) {
			String label = mode.label();
			int width = this.font.width(label) + 12;
			int color = mode == filterMode ? 0xDD31486A : 0xAA101015;
			guiGraphics.fill(cursorX, y, cursorX + width, y + FILTER_HEIGHT, color);
			guiGraphics.outline(cursorX, y, width, FILTER_HEIGHT, mode == filterMode ? 0xFFF0C36D : 0xCC6EA8FE);
			guiGraphics.text(this.font, label, cursorX + 6, y + 4, 0xFFE6E6E6);
			filterRects.add(new ClickableRect(new VisibleFunctionHud.Rect(cursorX, y, width, FILTER_HEIGHT), mode));
			cursorX += width + 4;
		}
	}

	private void drawViewTabs(GuiGraphicsExtractor guiGraphics, int x, int y) {
		int cursorX = x;
		boolean hasTickFilterCaptures = VisibleFunctionHud.capturedTickFilterBucketCount() > 0;

		for (ViewMode mode : ViewMode.values()) {
			String label = mode.label();
			int width = this.font.width(label) + 12;
			boolean activeTickFilterTab = mode == ViewMode.TICK_FILTER && hasTickFilterCaptures;
			int color = mode == viewMode ? 0xDD31486A : activeTickFilterTab ? 0xAA5A3F10 : 0xAA101015;
			guiGraphics.fill(cursorX, y, cursorX + width, y + FILTER_HEIGHT, color);
			guiGraphics.outline(cursorX, y, width, FILTER_HEIGHT, mode == viewMode || activeTickFilterTab ? 0xFFF0C36D : 0xCC6EA8FE);
			guiGraphics.text(this.font, label, cursorX + 6, y + 4, 0xFFE6E6E6);
			viewRects.add(new ClickableViewRect(new VisibleFunctionHud.Rect(cursorX, y, width, FILTER_HEIGHT), mode));
			cursorX += width + 4;
		}
	}

	private void drawTickBucketTabs(GuiGraphicsExtractor guiGraphics, int x, int y) {
		int cursorX = x;

		for (VisibleFunctionHud.TickBucketType type : VisibleFunctionHud.TickBucketType.values()) {
			String label = type.label();
			int width = this.font.width(label) + 12;
			int color = type == tickBucketType ? 0xDD31486A : 0xAA101015;
			guiGraphics.fill(cursorX, y, cursorX + width, y + FILTER_HEIGHT, color);
			guiGraphics.outline(cursorX, y, width, FILTER_HEIGHT, type == tickBucketType ? 0xFFF0C36D : 0xCC6EA8FE);
			guiGraphics.text(this.font, label, cursorX + 6, y + 4, 0xFFE6E6E6);
			tickBucketTabRects.add(new TickBucketTabRect(new VisibleFunctionHud.Rect(cursorX, y, width, FILTER_HEIGHT), type));
			cursorX += width + 4;
		}
	}

	private void drawSearch(GuiGraphicsExtractor guiGraphics, int x, int y, int width) {
		guiGraphics.fill(x, y, x + width, y + FILTER_HEIGHT, 0xAA101015);
		guiGraphics.outline(x, y, width, FILTER_HEIGHT, 0x884E6E9E);
		String label = searchText.isBlank() ? "search: type entity / scoreboard / storage" : "search: " + searchText;
		guiGraphics.text(this.font, VisibleFunctionHud.trimToWidth(this.font, label, width - 12), x + 6, y + 4, searchText.isBlank() ? 0xFF8892A6 : 0xFFE6E6E6);
	}

	private void drawFilteredNotice(GuiGraphicsExtractor guiGraphics, int x, int y, int width) {
		int count = VisibleFunctionHud.capturedTickFilterBucketCount();
		String label = count > 0
			? "[ FILTERED ] " + count + " high-frequency groups moved to Tick Filter."
			: "[ FILTERED ] no high-frequency groups captured yet.";
		guiGraphics.text(this.font, VisibleFunctionHud.trimToWidth(this.font, label, width), x, y + 4, count > 0 ? 0xFFFFD28A : 0xFF8892A6);
	}

	private void drawEmptyList(GuiGraphicsExtractor guiGraphics, int x, int y, int width, int height, String message) {
		guiGraphics.fill(x, y, x + width, y + height, 0xAA101015);
		guiGraphics.outline(x, y, width, height, 0xCC6EA8FE);
		guiGraphics.text(this.font, VisibleFunctionHud.trimToWidth(this.font, message, width - 12), x + 6, y + 8, 0xFFE6E6E6);
	}

	private void drawTickFilterEmpty(GuiGraphicsExtractor guiGraphics, int x, int y, int width, int height) {
		drawTickBucketTabs(guiGraphics, x, y);
		int listY = y + FILTER_HEIGHT + 4;
		int listHeight = height - FILTER_HEIGHT - 4;
		drawEmptyList(guiGraphics, x, listY, width, listHeight, "No matching tick/high-frequency buckets.");
	}

	private void drawEmptyDetail(GuiGraphicsExtractor guiGraphics, int x, int y, int width, String message) {
		int height = Math.min(this.height - y - 28, 96);
		guiGraphics.fill(x, y, x + width, y + height, 0xDD101015);
		guiGraphics.outline(x, y, width, height, 0xCC6EA8FE);
		guiGraphics.text(this.font, VisibleFunctionHud.trimToWidth(this.font, message, width - 12), x + 6, y + 8, 0xFFE6E6E6);
	}

	private void drawTimeline(GuiGraphicsExtractor guiGraphics, int x, int width) {
		timelineBufferTicks = VisibleFunctionHud.configuredTimelineBufferTicks();
		int availableWidth = Math.max(240, this.width - x - PADDING);
		int timelineWidth = Math.min(560, Math.max(320, Math.min(width, availableWidth)));
		int timelineX = Math.max(x, this.width - timelineWidth - PADDING);
		int timelineY = Math.max(PADDING + 112, this.height - TIMELINE_HEIGHT - PADDING - 22);
		timelinePanelRect = new VisibleFunctionHud.Rect(timelineX, timelineY, timelineWidth, TIMELINE_HEIGHT);

		guiGraphics.fill(timelineX, timelineY, timelineX + timelineWidth, timelineY + TIMELINE_HEIGHT, 0xDD101015);
		guiGraphics.outline(timelineX, timelineY, timelineWidth, TIMELINE_HEIGHT, 0xCC6EA8FE);
		guiGraphics.text(this.font, "TIME LINE", timelineX + 6, timelineY + 5, 0xFFFFD28A);
		drawTimelinePauseButton(guiGraphics, timelineX, timelineY, timelineWidth);
		guiGraphics.fill(timelineX + 72, timelineY + 10, timelineX + timelineWidth - 170, timelineY + 11, 0x884E6E9E);
		String bufferLabel = "buffer " + timelineBufferTicks + "t" + (VisibleFunctionHud.timelinePaused() ? " | paused" : "");
		guiGraphics.text(this.font, VisibleFunctionHud.trimToWidth(this.font, bufferLabel, 112), timelineX + timelineWidth - 164, timelineY + 5, VisibleFunctionHud.timelinePaused() ? 0xFFFFD28A : 0xFFBFC7D5);

		int axisX = timelineX + 78;
		int axisWidth = Math.max(36, timelineWidth - 92);
		long now = VisibleFunctionHud.timelineNowMillis();
		long start = Math.max(VisibleFunctionHud.timelineStartedAtMillis(), now - (long) timelineBufferTicks * TIMELINE_TICK_MILLIS);
		drawTimelineLanes(guiGraphics, timelineX, timelineY, axisX, axisWidth);

		List<TimelineTarget> targets = timelineTargets(now, start);
		drawTimelineConnections(guiGraphics, targets, axisX, axisWidth, start, now);
		drawTimelineTickBars(guiGraphics, targets, axisX, axisWidth, start, now);
		for (TimelineTarget target : targets) {
			drawTimelineTarget(guiGraphics, target, axisX, axisWidth, start, now);
		}

		drawTimelineSelection(guiGraphics, timelineX, timelineY, timelineWidth);
	}

	private void drawTimelinePauseButton(GuiGraphicsExtractor guiGraphics, int x, int y, int width) {
		String label = VisibleFunctionHud.timelinePaused() ? "Resume" : "Pause";
		int buttonWidth = this.font.width(label) + 12;
		int buttonX = x + width - buttonWidth - 6;
		int buttonY = y + 3;
		guiGraphics.fill(buttonX, buttonY, buttonX + buttonWidth, buttonY + FILTER_HEIGHT, 0xAA101015);
		guiGraphics.outline(buttonX, buttonY, buttonWidth, FILTER_HEIGHT, VisibleFunctionHud.timelinePaused() ? 0xFFFFD28A : 0xCC6EA8FE);
		guiGraphics.text(this.font, label, buttonX + 6, buttonY + 4, 0xFFE6E6E6);
		timelineControlButtonRects.add(new TimelineControlButtonRect(new VisibleFunctionHud.Rect(buttonX, buttonY, buttonWidth, FILTER_HEIGHT)));
	}

	private void drawTimelineLanes(GuiGraphicsExtractor guiGraphics, int x, int y, int axisX, int axisWidth) {
		for (TimelineLane lane : TimelineLane.values()) {
			int laneY = timelineLaneY(y, lane);
			guiGraphics.text(this.font, lane.label(), x + 6, laneY - 4, lane.color());
			if (lane == TimelineLane.TICK) {
				for (int track = 0; track < TIMELINE_TICK_TRACKS; track++) {
					int trackY = timelineTickTrackY(y, track);
					guiGraphics.fill(axisX, trackY, axisX + axisWidth, trackY + 1, 0x332D3D5A);
				}
				int top = timelineTickTrackY(y, 0) - 7;
				int bottom = timelineTickTrackY(y, TIMELINE_TICK_TRACKS - 1) + 7;
				guiGraphics.fill(axisX - 1, top, axisX, bottom, 0x886EA8FE);
			} else {
				guiGraphics.fill(axisX, laneY, axisX + axisWidth, laneY + 1, 0x665A6F8F);
			}
		}
	}

	private void drawTimelineConnections(
		GuiGraphicsExtractor guiGraphics,
		List<TimelineTarget> targets,
		int axisX,
		int axisWidth,
		long start,
		long now
	) {
		Map<String, TimelineTarget> targetsByKey = new LinkedHashMap<>();
		for (TimelineTarget target : targets) {
			targetsByKey.put(target.key(), target);
		}

		for (TimelineTarget target : targets) {
			if (target.lane() == TimelineLane.EVENTS) {
				TimelineTarget commandTarget = targetsByKey.get(TimelineLane.COMMANDS.name() + ":" + target.bucket().tick());
				if (commandTarget != null) {
					drawTimelineConnection(guiGraphics, target, commandTarget, axisX, axisWidth, start, now, 0x668DAEFF);
				}
			}

			if (target.lane() == TimelineLane.COMMANDS || target.lane() == TimelineLane.EVENTS) {
				TimelineTarget functionTarget = targetsByKey.get(TimelineLane.FUNCTIONS.name() + ":" + target.bucket().tick());
				if (functionTarget != null) {
					drawTimelineConnection(guiGraphics, target, functionTarget, axisX, axisWidth, start, now, 0x66FFD28A);
				}
			}
		}
	}

	private void drawTimelineConnection(
		GuiGraphicsExtractor guiGraphics,
		TimelineTarget from,
		TimelineTarget to,
		int axisX,
		int axisWidth,
		long start,
		long now,
		int color
	) {
		int x1 = timelineTargetX(from, axisX, axisWidth, start, now);
		int y1 = timelineTargetY(from);
		int x2 = timelineTargetX(to, axisX, axisWidth, start, now);
		int y2 = timelineTargetY(to);
		guiGraphics.fill(Math.min(x1, x2), y1, Math.max(x1, x2) + 1, y1 + 1, color);
		guiGraphics.fill(x2, Math.min(y1, y2), x2 + 1, Math.max(y1, y2) + 1, color);
	}

	private void drawTimelineTickBars(
		GuiGraphicsExtractor guiGraphics,
		List<TimelineTarget> targets,
		int axisX,
		int axisWidth,
		long start,
		long now
	) {
		int laneY = timelineLaneY(timelinePanelRect.y(), TimelineLane.TICK);
		int[] segmentStart = new int[TIMELINE_TICK_TRACKS];
		int[] segmentEnd = new int[TIMELINE_TICK_TRACKS];
		for (int index = 0; index < TIMELINE_TICK_TRACKS; index++) {
			segmentStart[index] = -1;
			segmentEnd[index] = -1;
		}

		for (TimelineTarget target : targets) {
			if (target.lane() != TimelineLane.TICK) {
				continue;
			}

			int track = Math.max(0, Math.min(TIMELINE_TICK_TRACKS - 1, target.tickTrack()));
			int markerX = timelineTargetX(target, axisX, axisWidth, start, now);

			if (segmentStart[track] < 0 || markerX > segmentEnd[track] + 5) {
				drawTimelineTickBar(guiGraphics, segmentStart[track], segmentEnd[track], timelineTickTrackY(timelinePanelRect.y(), track));
				segmentStart[track] = markerX;
				segmentEnd[track] = markerX + 10;
				continue;
			}

			segmentEnd[track] = Math.max(segmentEnd[track], markerX + 10);
		}

		for (int track = 0; track < TIMELINE_TICK_TRACKS; track++) {
			drawTimelineTickBar(guiGraphics, segmentStart[track], segmentEnd[track], timelineTickTrackY(timelinePanelRect.y(), track));
		}
	}

	private void drawTimelineTickBar(GuiGraphicsExtractor guiGraphics, int start, int end, int laneY) {
		if (start < 0 || end < start) {
			return;
		}

		guiGraphics.fill(start, laneY, end, laneY + 1, TIMELINE_TICK_LINE_COLOR);
	}

	private void drawTimelineTarget(
		GuiGraphicsExtractor guiGraphics,
		TimelineTarget target,
		int axisX,
		int axisWidth,
		long start,
		long now
	) {
		int markerX = timelineTargetX(target, axisX, axisWidth, start, now);
		int laneY = timelineTargetY(target);
		boolean selected = timelineSelection != null && timelineSelection.sameTarget(target);

		if (target.lane() == TimelineLane.TICK) {
			if (selected) {
				guiGraphics.fill(markerX - 5, laneY - 1, markerX + 12, laneY + 2, TIMELINE_TICK_LINE_SELECTED_COLOR);
			}
			timelineHitRects.add(new TimelineHitRect(new VisibleFunctionHud.Rect(markerX - 4, laneY - 5, 18, 10), target));
			return;
		}

		int color = selected ? 0xFFFFD28A : target.lane().color();
		if (target.aggregate()) {
			String label = timelineCountLabel(target.markerCount());
			int labelWidth = this.font.width(label) + 6;
			int boxX = markerX - labelWidth / 2;
			guiGraphics.fill(boxX, laneY - 7, boxX + labelWidth, laneY + 7, 0xDD101015);
			guiGraphics.outline(boxX, laneY - 7, labelWidth, 14, color);
			guiGraphics.text(this.font, label, boxX + 3, laneY - 4, color);
			timelineHitRects.add(new TimelineHitRect(new VisibleFunctionHud.Rect(boxX - 2, laneY - 9, labelWidth + 4, 18), target));
			return;
		}

		guiGraphics.fill(markerX - 2, laneY - 5, markerX + 3, laneY + 6, color);
		timelineHitRects.add(new TimelineHitRect(new VisibleFunctionHud.Rect(markerX - 5, laneY - 8, 11, 16), target));
	}

	private String timelineCountLabel(int count) {
		return count > 99 ? "99+" : Integer.toString(count);
	}

	private void drawTimelineSelection(GuiGraphicsExtractor guiGraphics, int x, int y, int width) {
		if (timelineSelection == null) {
			guiGraphics.text(this.font, "click a marker for summary, double-click to jump", x + 6, y + TIMELINE_HEIGHT - 14, 0xFF8892A6);
			return;
		}

		String summary = timelineSelectionSummary(timelineSelection);
		guiGraphics.text(this.font, VisibleFunctionHud.trimToWidth(this.font, summary, width - 12), x + 6, y + TIMELINE_HEIGHT - 14, 0xFFE6E6E6);
	}

	private String timelineSelectionSummary(TimelineTarget target) {
		int count = target.markerCount();
		return count + " " + target.summaryNoun(count) + " occurred.";
	}

	private int timelineLaneY(int timelineY, TimelineLane lane) {
		return timelineY + switch (lane) {
			case COMMANDS -> 32;
			case EVENTS -> 48;
			case FUNCTIONS -> 64;
			case TICK -> 83;
		};
	}

	private int timelineTickTrackY(int timelineY, int track) {
		return timelineY + 78 + track * 5;
	}

	private int timelineTargetX(TimelineTarget target, int axisX, int axisWidth, long start, long now) {
		long clampedTimestamp = Math.max(start, Math.min(now, target.timestampMillis()));
		return axisX + (int) (((clampedTimestamp - start) * axisWidth) / Math.max(1L, now - start));
	}

	private int timelineTargetY(TimelineTarget target) {
		if (target.lane() == TimelineLane.TICK) {
			return timelineTickTrackY(timelinePanelRect.y(), target.tickTrack());
		}

		return timelineLaneY(timelinePanelRect.y(), target.lane());
	}

	private void drawHistory(GuiGraphicsExtractor guiGraphics, int x, int y, int width, int height) {
		int recentHeight = historyRecentHeight();
		int olderY = y + recentHeight + PADDING;
		int olderHeight = Math.max(36, height - recentHeight - PADDING);

		drawHistorySection(guiGraphics, x, y, width, recentHeight, "Recent", recentRecords, 0, scrollOffset, false);
		drawHistorySection(guiGraphics, x, olderY, width, olderHeight, "Older", olderRecords, recentRecords.size(), olderScrollOffset, true);
	}

	private void drawHistorySection(
		GuiGraphicsExtractor guiGraphics,
		int x,
		int y,
		int width,
		int height,
		String label,
		List<VisibleFunctionHud.EventRecord> records,
		int baseIndex,
		int sectionScrollOffset,
		boolean clearable
	) {
		guiGraphics.fill(x, y, x + width, y + height, 0xAA101015);
		guiGraphics.outline(x, y, width, height, 0xCC6EA8FE);
		guiGraphics.text(this.font, label + " (" + records.size() + ")", x + 6, y + 5, 0xFFFFD28A);

		drawHistoryActionButton(guiGraphics, x, y, width, records.isEmpty(), clearable);

		if (records.isEmpty()) {
			String empty = clearable ? "No older matching records." : "No recent matching records.";
			guiGraphics.text(this.font, VisibleFunctionHud.trimToWidth(this.font, empty, width - 12), x + 6, y + 24, 0xFF8892A6);
			return;
		}

		int rows = historySectionRowCount(height);
		int end = Math.min(records.size(), sectionScrollOffset + rows);
		int rowY = y + 22;

		for (int index = sectionScrollOffset; index < end; index++) {
			VisibleFunctionHud.EventRecord record = records.get(index);
			int recordIndex = baseIndex + index;
			boolean selected = recordIndex == selectedIndex;
			boolean highlighted = timelineHighlightedRecords.contains(record);
			int rowColor = selected ? 0x6631486A : highlighted ? 0x665E5222 : 0x00101015;
			guiGraphics.fill(x + 4, rowY, x + width - 4, rowY + ROW_HEIGHT - 3, rowColor);
			if (highlighted) {
				guiGraphics.outline(x + 4, rowY, width - 8, ROW_HEIGHT - 3, 0xCCFFD28A);
			}
			guiGraphics.text(this.font, "[" + record.type() + " #" + record.id() + "]", x + 8, rowY + 3, colorFor(record.type()));
			guiGraphics.text(this.font, VisibleFunctionHud.trimToWidth(this.font, record.subject(), width - 112), x + 98, rowY + 3, 0xFFFFFFFF);
			String summary = record.summary().isBlank() ? record.field("action") : record.summary();
			guiGraphics.text(this.font, VisibleFunctionHud.trimToWidth(this.font, summary, width - 16), x + 8, rowY + 13, 0xFFBFC7D5);
			rowRects.add(new RowRect(new VisibleFunctionHud.Rect(x + 4, rowY, width - 8, ROW_HEIGHT - 3), recordIndex));
			rowY += ROW_HEIGHT;
		}

		guiGraphics.text(this.font, (sectionScrollOffset + 1) + "-" + end + " / " + records.size(), x + 8, y + height - 12, 0xFF8892A6);
	}

	private void drawHistoryActionButton(
		GuiGraphicsExtractor guiGraphics,
		int x,
		int y,
		int width,
		boolean disabled,
		boolean clearable
	) {
		String text = clearable ? "Clear" : "Move to Older";
		HistoryAction action = clearable ? HistoryAction.CLEAR_OLDER : HistoryAction.MOVE_TO_OLDER;
		int buttonWidth = this.font.width(text) + 12;
		int buttonX = x + width - buttonWidth - 6;
		int buttonY = y + 3;
		guiGraphics.fill(buttonX, buttonY, buttonX + buttonWidth, buttonY + FILTER_HEIGHT, disabled ? 0x55101015 : 0xAA101015);
		guiGraphics.outline(buttonX, buttonY, buttonWidth, FILTER_HEIGHT, disabled ? 0x555A6F8F : 0xFFF0C36D);
		guiGraphics.text(this.font, text, buttonX + 6, buttonY + 4, disabled ? 0xFF8892A6 : 0xFFE6E6E6);
		if (!disabled) {
			historyActionButtonRects.add(new HistoryActionButtonRect(new VisibleFunctionHud.Rect(buttonX, buttonY, buttonWidth, FILTER_HEIGHT), action));
		}
	}

	private void drawFunctionTree(GuiGraphicsExtractor guiGraphics, int x, int y, int width, int height) {
		treeRowRects.clear();
		guiGraphics.fill(x, y, x + width, y + height, 0xAA101015);
		guiGraphics.outline(x, y, width, height, 0xCC6EA8FE);
		drawFunctionTreeControls(guiGraphics, x, y, width);

		int contentY = y + TREE_CONTROL_HEIGHT;
		int contentHeight = height - TREE_CONTROL_HEIGHT;
		int recentHeight = functionTreeRecentHeight(contentHeight);
		int olderY = contentY + recentHeight + PADDING;
		int olderHeight = Math.max(36, contentHeight - recentHeight - PADDING);

		drawFunctionTreeSection(guiGraphics, x, contentY, width, recentHeight, "Recent Function Calls", recentTreeRows, 0, treeScrollOffset);
		drawFunctionTreeSection(guiGraphics, x, olderY, width, olderHeight, "Older Function Calls", olderTreeRows, recentTreeRows.size(), olderTreeScrollOffset);
	}

	private void drawFunctionTreeSection(
		GuiGraphicsExtractor guiGraphics,
		int x,
		int y,
		int width,
		int height,
		String label,
		List<TreeRow> rows,
		int baseIndex,
		int sectionScrollOffset
	) {
		guiGraphics.fill(x + 4, y, x + width - 4, y + height, 0x66101015);
		guiGraphics.outline(x + 4, y, width - 8, height, 0x884E6E9E);
		guiGraphics.text(this.font, label + " (" + countFunctionHeaders(rows) + ")", x + 10, y + 5, 0xFFFFD28A);

		if (rows.isEmpty()) {
			String empty = label.startsWith("Older") ? "No older function calls." : "No recent function calls.";
			guiGraphics.text(this.font, VisibleFunctionHud.trimToWidth(this.font, empty, width - 20), x + 10, y + 24, 0xFF8892A6);
			return;
		}

		int visibleRows = treeSectionRowCount(height);
		int end = Math.min(rows.size(), sectionScrollOffset + visibleRows);
		int rowY = y + 22;

		for (int index = sectionScrollOffset; index < end; index++) {
			TreeRow row = rows.get(index);
			int rowIndex = baseIndex + index;
			boolean selected = rowIndex == selectedTreeIndex;
			boolean highlighted = row.record() != null && timelineHighlightedRecords.contains(row.record());
			int rowColor = selected ? 0x6631486A : highlighted ? 0x665E5222 : 0x00101015;
			guiGraphics.fill(x + 8, rowY, x + width - 8, rowY + TREE_ROW_HEIGHT - 2, rowColor);
			if (highlighted) {
				guiGraphics.outline(x + 8, rowY, width - 16, TREE_ROW_HEIGHT - 2, 0xCCFFD28A);
			}
			guiGraphics.text(this.font, VisibleFunctionHud.trimToWidth(this.font, row.text(), width - 22), x + 12, rowY + 3, row.color());
			treeRowRects.add(new TreeRowRect(new VisibleFunctionHud.Rect(x + 8, rowY, width - 16, TREE_ROW_HEIGHT - 2), rowIndex));
			rowY += TREE_ROW_HEIGHT;
		}

		guiGraphics.text(this.font, (sectionScrollOffset + 1) + "-" + end + " / " + rows.size(), x + 10, y + height - 12, 0xFF8892A6);
	}

	private void drawFunctionTreeControls(GuiGraphicsExtractor guiGraphics, int x, int y, int width) {
		String counts = "Recent " + recentFunctionCallCount + " / Older " + olderFunctionCallCount;
		guiGraphics.text(this.font, VisibleFunctionHud.trimToWidth(this.font, counts, width - 180), x + 6, y + 6, 0xFFFFD28A);

		int clearWidth = this.font.width("Clear Older") + 12;
		int moveWidth = this.font.width("Move to Older") + 12;
		int clearX = x + width - clearWidth - 6;
		int moveX = clearX - moveWidth - 4;
		drawHistoryActionButtonAt(guiGraphics, moveX, y + 3, moveWidth, "Move to Older", recentFunctionCallCount == 0, HistoryAction.MOVE_TO_OLDER);
		drawHistoryActionButtonAt(guiGraphics, clearX, y + 3, clearWidth, "Clear Older", olderFunctionCallCount == 0, HistoryAction.CLEAR_OLDER);
	}

	private void drawHistoryActionButtonAt(
		GuiGraphicsExtractor guiGraphics,
		int x,
		int y,
		int width,
		String text,
		boolean disabled,
		HistoryAction action
	) {
		guiGraphics.fill(x, y, x + width, y + FILTER_HEIGHT, disabled ? 0x55101015 : 0xAA101015);
		guiGraphics.outline(x, y, width, FILTER_HEIGHT, disabled ? 0x555A6F8F : 0xFFF0C36D);
		guiGraphics.text(this.font, text, x + 6, y + 4, disabled ? 0xFF8892A6 : 0xFFE6E6E6);
		if (!disabled) {
			historyActionButtonRects.add(new HistoryActionButtonRect(new VisibleFunctionHud.Rect(x, y, width, FILTER_HEIGHT), action));
		}
	}

	private void drawTickFilter(GuiGraphicsExtractor guiGraphics, int x, int y, int width, int height) {
		tickBucketRects.clear();
		drawTickBucketTabs(guiGraphics, x, y);
		int listY = y + FILTER_HEIGHT + 4;
		int listHeight = height - FILTER_HEIGHT - 4;
		int activeHeight = tickFilterActiveHeight();
		int inactiveY = listY + activeHeight + PADDING;
		int inactiveHeight = tickFilterInactiveHeight();

		drawTickFilterSection(guiGraphics, x, listY, width, activeHeight, "Active", activeTickBuckets, 0, tickFilterScrollOffset, false);
		drawTickFilterSection(guiGraphics, x, inactiveY, width, inactiveHeight, "Inactive", inactiveTickBuckets, activeTickBuckets.size(), inactiveTickFilterScrollOffset, true);
	}

	private void drawTickFilterSection(
		GuiGraphicsExtractor guiGraphics,
		int x,
		int y,
		int width,
		int height,
		String label,
		List<VisibleFunctionHud.TickFilterBucket> buckets,
		int baseIndex,
		int sectionScrollOffset,
		boolean inactive
	) {
		guiGraphics.fill(x, y, x + width, y + height, inactive ? 0x88101015 : 0xAA101015);
		guiGraphics.outline(x, y, width, height, inactive ? 0x885A6F8F : 0xCC6EA8FE);
		guiGraphics.text(this.font, label + " (" + buckets.size() + ")", x + 6, y + 5, inactive ? 0xFF8892A6 : 0xFFFFD28A);

		if (inactive) {
			drawTickFilterClearButton(guiGraphics, x, y, width, buckets.isEmpty());
		}

		if (buckets.isEmpty()) {
			String empty = inactive ? "No inactive tick groups." : "No active tick groups.";
			guiGraphics.text(this.font, VisibleFunctionHud.trimToWidth(this.font, empty, width - 12), x + 6, y + 24, 0xFF8892A6);
			return;
		}

		int rows = tickBucketSectionRowCount(height);
		int end = Math.min(buckets.size(), sectionScrollOffset + rows);
		int rowY = y + 22;

		for (int index = sectionScrollOffset; index < end; index++) {
			VisibleFunctionHud.TickFilterBucket bucket = buckets.get(index);
			int bucketIndex = baseIndex + index;
			boolean selected = bucketIndex == selectedTickBucketIndex;
			int rowColor = selected ? 0x6631486A : 0x00101015;
			guiGraphics.fill(x + 4, rowY, x + width - 4, rowY + ROW_HEIGHT - 3, rowColor);
			guiGraphics.text(this.font, "[" + bucket.type().label() + "]", x + 8, rowY + 3, inactive ? 0xFFBFC7D5 : 0xFFFFD28A);
			guiGraphics.text(this.font, VisibleFunctionHud.trimToWidth(this.font, bucket.displayName(), width - 122), x + 102, rowY + 3, inactive ? 0xFFBFC7D5 : 0xFFFFFFFF);
			String summary = bucket.countLastSecond() + "/s, total " + bucket.totalCount() + ", " + bucket.reason();
			guiGraphics.text(this.font, VisibleFunctionHud.trimToWidth(this.font, summary, width - 16), x + 8, rowY + 13, inactive ? 0xFF8892A6 : 0xFFBFC7D5);
			tickBucketRects.add(new TickBucketRect(new VisibleFunctionHud.Rect(x + 4, rowY, width - 8, ROW_HEIGHT - 3), bucketIndex));
			rowY += ROW_HEIGHT;
		}

		guiGraphics.text(this.font, (sectionScrollOffset + 1) + "-" + end + " / " + buckets.size(), x + 8, y + height - 12, 0xFF8892A6);
	}

	private void drawTickFilterClearButton(GuiGraphicsExtractor guiGraphics, int x, int y, int width, boolean disabled) {
		String text = "Clear Inactive";
		int buttonWidth = this.font.width(text) + 12;
		int buttonX = x + width - buttonWidth - 6;
		int buttonY = y + 3;
		guiGraphics.fill(buttonX, buttonY, buttonX + buttonWidth, buttonY + FILTER_HEIGHT, disabled ? 0x55101015 : 0xAA101015);
		guiGraphics.outline(buttonX, buttonY, buttonWidth, FILTER_HEIGHT, disabled ? 0x555A6F8F : 0xFFF0C36D);
		guiGraphics.text(this.font, text, buttonX + 6, buttonY + 4, disabled ? 0xFF8892A6 : 0xFFE6E6E6);
		if (!disabled) {
			tickFilterActionButtonRects.add(new TickFilterActionButtonRect(new VisibleFunctionHud.Rect(buttonX, buttonY, buttonWidth, FILTER_HEIGHT)));
		}
	}

	private void drawTickBucketDetail(GuiGraphicsExtractor guiGraphics, int x, int y, int width) {
		VisibleFunctionHud.TickFilterBucket bucket = selectedTickBucket();
		int lineHeight = this.font.lineHeight + 2;
		int height = Math.min(this.height - y - 28, 210);

		guiGraphics.fill(x, y, x + width, y + height, 0xDD101015);
		guiGraphics.outline(x, y, width, height, 0xFFF0C36D);
		guiGraphics.text(this.font, "[ TICK FILTER ] ", x + 6, y + 6, 0xFFFFD28A);
		guiGraphics.text(this.font, VisibleFunctionHud.trimToWidth(this.font, bucket.displayName(), width - 112), x + 112, y + 6, 0xFFFFFFFF);

		List<String> lines = new ArrayList<>();
		lines.add("- frequency: " + bucket.countLastSecond() + "/s");
		lines.add("- status: " + (bucket.active() ? "active" : "inactive"));
		lines.add("- total: " + bucket.totalCount());
		lines.add("- reason: " + bucket.reason());
		lines.add("- source: " + bucket.sourceSummary());
		lines.add("- first seen: tick " + bucket.firstSeenTick());
		lines.add("- last seen: tick " + bucket.lastSeenTick());
		lines.add("- last: " + bucket.millisSinceLastSeen() + "ms ago");
		lines.add("- samples:");
		for (VisibleFunctionHud.EventRecord record : bucket.sampleRecords()) {
			lines.add("  #" + record.id() + " " + record.commandContext().command() + " -> [" + record.type() + "] " + record.subject());
		}

		int lineY = y + 22;
		for (String line : lines) {
			guiGraphics.text(this.font, VisibleFunctionHud.trimToWidth(this.font, line, width - 12), x + 6, lineY, 0xFFE6E6E6);
			lineY += lineHeight;
			if (lineY > y + height - lineHeight) {
				break;
			}
		}
	}

	private List<VisibleFunctionHud.EventRecord> filteredRecords() {
		List<VisibleFunctionHud.EventRecord> records = VisibleFunctionHud.records();
		List<VisibleFunctionHud.EventRecord> filtered = new ArrayList<>();

		for (int index = records.size() - 1; index >= 0; index--) {
			VisibleFunctionHud.EventRecord record = records.get(index);
			if (filterMode.matches(record)
				&& matchesSearch(record)
				&& !VisibleFunctionHud.isHistoryFiltered(record)
				&& !VisibleFunctionHud.isTickFiltered(record)) {
				filtered.add(record);
			}
		}

		return filtered;
	}

	private List<VisibleFunctionHud.TickFilterBucket> tickFilterBuckets() {
		List<VisibleFunctionHud.TickFilterBucket> active = new ArrayList<>();
		List<VisibleFunctionHud.TickFilterBucket> inactive = new ArrayList<>();

		for (VisibleFunctionHud.TickFilterBucket bucket : VisibleFunctionHud.tickFilterBuckets(tickBucketType, true)) {
			if (matchesSearch(bucket)) {
				active.add(bucket);
			}
		}

		for (VisibleFunctionHud.TickFilterBucket bucket : VisibleFunctionHud.tickFilterBuckets(tickBucketType, false)) {
			if (matchesSearch(bucket)) {
				inactive.add(bucket);
			}
		}

		this.activeTickBuckets = List.copyOf(active);
		this.inactiveTickBuckets = List.copyOf(inactive);

		List<VisibleFunctionHud.TickFilterBucket> buckets = new ArrayList<>(active.size() + inactive.size());
		buckets.addAll(active);
		buckets.addAll(inactive);
		return List.copyOf(buckets);
	}

	private List<TimelineTarget> timelineTargets(long now, long start) {
		List<TimelineTarget> targets = new ArrayList<>();
		Map<Long, TimelineBucket> buckets = new LinkedHashMap<>();
		Map<String, Integer> tickTracks = new LinkedHashMap<>();

		for (VisibleFunctionHud.EventRecord record : VisibleFunctionHud.records()) {
			if (record.timestampMillis() < start || record.timestampMillis() > now) {
				continue;
			}

			long tick = timelineTick(record.timestampMillis());
			TimelineBucket bucket = buckets.computeIfAbsent(tick, TimelineBucket::new);
			boolean tickFiltered = VisibleFunctionHud.isHistoryFiltered(record) || VisibleFunctionHud.isTickFiltered(record);
			bucket.add(record, tickFiltered);
		}

		for (TimelineBucket bucket : buckets.values()) {
			if (!bucket.commands().isEmpty()) {
				targets.add(new TimelineTarget(TimelineLane.COMMANDS, bucket, -1));
			}
			if (!bucket.events().isEmpty()) {
				targets.add(new TimelineTarget(TimelineLane.EVENTS, bucket, -1));
			}
			if (!bucket.functions().isEmpty()) {
				targets.add(new TimelineTarget(TimelineLane.FUNCTIONS, bucket, -1));
			}
			if (!bucket.tickRecords().isEmpty()) {
				targets.add(new TimelineTarget(TimelineLane.TICK, bucket, timelineTickTrack(bucket, tickTracks)));
			}
		}

		return targets;
	}

	private long timelineTick(long timestampMillis) {
		return timestampMillis / TIMELINE_TICK_MILLIS;
	}

	private int timelineTickTrack(TimelineBucket bucket, Map<String, Integer> tickTracks) {
		String key = timelineTickTrackKey(bucket);
		Integer existing = tickTracks.get(key);
		if (existing != null) {
			return existing;
		}

		int next = tickTracks.size() % TIMELINE_TICK_TRACKS;
		tickTracks.put(key, next);
		return next;
	}

	private String timelineTickTrackKey(TimelineBucket bucket) {
		VisibleFunctionHud.EventRecord record = bucket.primaryRecord(TimelineLane.TICK);
		if (record == null) {
			return "TICK:" + bucket.tick();
		}

		VisibleFunctionHud.TickFilterBucket tickBucket = VisibleFunctionHud.tickFilterBucketFor(record);
		if (tickBucket != null) {
			return tickBucket.key();
		}

		if (!"none".equals(record.commandContext().function())) {
			return "FUNCTION:" + record.commandContext().function();
		}

		if (record.isCommand()) {
			return "COMMAND:" + record.commandContext().command();
		}

		return "EVENT:" + record.subject();
	}

	private List<TreeRow> functionTreeRows() {
		VisibleFunctionHud.TraceStore traceStore = VisibleFunctionHud.traceStore();
		List<FunctionNode> functions = new ArrayList<>();
		List<TreeRow> recentRows = new ArrayList<>();
		List<TreeRow> olderRows = new ArrayList<>();
		String query = searchText.strip().toLowerCase(Locale.ROOT);
		boolean searchBlank = query.isEmpty();

		for (String functionId : traceStore.functionIds()) {
			for (long functionCallId : traceStore.functionCallsByFunctionId(functionId)) {
				List<VisibleFunctionHud.EventRecord> callRecords = traceStore.recordsByFunctionCallId(functionCallId);
				if (callRecords.isEmpty()) {
					continue;
				}

				List<VisibleFunctionHud.EventRecord> includedRecords = new ArrayList<>();
				FunctionNode functionNode = new FunctionNode(functionId, functionCallId, Long.MAX_VALUE, Long.MIN_VALUE, null, new ArrayList<>());
				for (VisibleFunctionHud.EventRecord record : callRecords) {
					if (VisibleFunctionHud.isTickFiltered(record)) {
						continue;
					}

					includedRecords.add(record);
					CommandNode commandNode = findOrCreateCommandNode(functionNode, record);
					if (record.isCommand()) {
						commandNode.commandRecord = record;
					} else if (!commandNode.events.contains(record)) {
						commandNode.events.add(record);
					}
				}

				if (!functionNode.commands().isEmpty()) {
					functions.add(functionNode.withTimeRange(includedRecords));
				}
			}
		}

		functions.sort((left, right) -> Long.compare(right.lastSeenMillis(), left.lastSeenMillis()));

		for (FunctionNode functionNode : functions) {
			boolean functionMatches = !searchBlank && functionNode.function().toLowerCase(Locale.ROOT).contains(query);
			List<TreeRow> functionRows = new ArrayList<>();

			for (CommandNode commandNode : functionNode.commands()) {
				boolean commandMatches = searchBlank || functionMatches || commandNodeMatches(commandNode, query);
				List<VisibleFunctionHud.EventRecord> visibleEvents = new ArrayList<>();

				for (VisibleFunctionHud.EventRecord event : commandNode.events()) {
					if (commandMatches || matchesSearch(event)) {
						visibleEvents.add(event);
					}
				}

				if (!commandMatches && visibleEvents.isEmpty()) {
					continue;
				}

				functionRows.add(TreeRow.command("|- " + commandNodeLabel(commandNode), commandNode.representativeRecord()));
				for (VisibleFunctionHud.EventRecord event : visibleEvents) {
					functionRows.add(TreeRow.event("|  \\- record #" + event.id() + " [" + event.type() + "] " + event.subject() + " " + event.summary(), event));
				}
			}

			if (!functionRows.isEmpty()) {
				List<TreeRow> targetRows = functionNode.isOlder() ? olderRows : recentRows;
				targetRows.add(TreeRow.header(functionHeader(functionNode)));
				targetRows.addAll(functionRows);
			}
		}

		recentFunctionCallCount = countFunctionHeaders(recentRows);
		olderFunctionCallCount = countFunctionHeaders(olderRows);
		this.recentTreeRows = List.copyOf(recentRows);
		this.olderTreeRows = List.copyOf(olderRows);

		List<TreeRow> rows = new ArrayList<>(recentRows.size() + olderRows.size());
		rows.addAll(recentRows);
		rows.addAll(olderRows);
		return rows;
	}

	private String functionHeader(FunctionNode functionNode) {
		StringBuilder header = new StringBuilder(functionNode.function())
			.append(" call #")
			.append(functionNode.functionCallId())
			.append(" | last ")
			.append(relativeTime(functionNode.lastSeenMillis()));

		if (functionNode.firstSeenMillis() != functionNode.lastSeenMillis()) {
			header.append(" | span ")
				.append(duration(functionNode.firstSeenMillis(), functionNode.lastSeenMillis()));
		}

		header.append(" | commands ")
			.append(functionNode.commands().size());
		return header.toString();
	}

	private int countFunctionHeaders(List<TreeRow> rows) {
		int count = 0;
		for (TreeRow row : rows) {
			if (row.kind() == TreeRowKind.HEADER) {
				count++;
			}
		}
		return count;
	}

	private String relativeTime(long timestampMillis) {
		long ageMillis = Math.max(0, System.currentTimeMillis() - timestampMillis);
		if (ageMillis < 1000) {
			return "now";
		}
		if (ageMillis < 60_000) {
			return ageMillis / 1000 + "s ago";
		}
		if (ageMillis < 3_600_000) {
			return ageMillis / 60_000 + "m ago";
		}
		return ageMillis / 3_600_000 + "h ago";
	}

	private String duration(long firstMillis, long lastMillis) {
		long durationMillis = Math.max(0, lastMillis - firstMillis);
		if (durationMillis < 1000) {
			return durationMillis + "ms";
		}
		if (durationMillis < 60_000) {
			return durationMillis / 1000 + "s";
		}
		return durationMillis / 60_000 + "m";
	}

	private CommandNode findOrCreateCommandNode(FunctionNode functionNode, VisibleFunctionHud.EventRecord record) {
		String key = commandNodeKey(record);

		for (CommandNode commandNode : functionNode.commands()) {
			if (commandNode.key().equals(key)) {
				return commandNode;
			}
		}

		CommandNode commandNode = new CommandNode(
			key,
			record.commandContext().command(),
			record.commandContext().displayCommandId(),
			null,
			new ArrayList<>()
		);
		functionNode.commands().add(commandNode);
		return commandNode;
	}

	private String commandNodeKey(VisibleFunctionHud.EventRecord record) {
		if (record.commandContext().hasCommandId()) {
			return "id:" + record.commandContext().commandId();
		}

		String command = record.commandContext().command();
		if (!command.isBlank() && !"none".equals(command)) {
			return "command:" + command;
		}

		return "record:" + record.id();
	}

	private boolean commandNodeMatches(CommandNode commandNode, String query) {
		if (commandNode.command().toLowerCase(Locale.ROOT).contains(query)
			|| commandNode.displayCommandId().toLowerCase(Locale.ROOT).contains(query)) {
			return true;
		}

		return commandNode.commandRecord() != null && matchesSearch(commandNode.commandRecord());
	}

	private String commandNodeLabel(CommandNode commandNode) {
		String command = commandNode.command().isBlank() ? "unknown command" : commandNode.command();
		return "command " + commandNode.displayCommandId() + " " + command;
	}

	private void clampSelection() {
		if (visibleRecords.isEmpty()) {
			selectedIndex = -1;
			scrollOffset = 0;
			olderScrollOffset = 0;
		} else if (selectedIndex < 0 || selectedIndex >= visibleRecords.size()) {
			selectedIndex = 0;
		}

		if (treeRows.isEmpty()) {
			selectedTreeIndex = -1;
			treeScrollOffset = 0;
			olderTreeScrollOffset = 0;
		} else if (selectedTreeIndex < 0 || selectedTreeIndex >= treeRows.size()) {
			selectedTreeIndex = firstSelectableTreeRow();
		}

		if (tickBuckets.isEmpty()) {
			selectedTickBucketIndex = -1;
			tickFilterScrollOffset = 0;
			inactiveTickFilterScrollOffset = 0;
		} else if (selectedTickBucketIndex < 0 || selectedTickBucketIndex >= tickBuckets.size()) {
			selectedTickBucketIndex = 0;
		}

		scrollOffset = Math.max(0, Math.min(scrollOffset, Math.max(0, recentRecords.size() - visibleRecentRowCount())));
		olderScrollOffset = Math.max(0, Math.min(olderScrollOffset, Math.max(0, olderRecords.size() - visibleOlderRowCount())));
		treeScrollOffset = Math.max(0, Math.min(treeScrollOffset, Math.max(0, recentTreeRows.size() - visibleRecentTreeRowCount())));
		olderTreeScrollOffset = Math.max(0, Math.min(olderTreeScrollOffset, Math.max(0, olderTreeRows.size() - visibleOlderTreeRowCount())));
		tickFilterScrollOffset = Math.max(0, Math.min(tickFilterScrollOffset, Math.max(0, activeTickBuckets.size() - visibleTickBucketRowCount())));
		inactiveTickFilterScrollOffset = Math.max(0, Math.min(inactiveTickFilterScrollOffset, Math.max(0, inactiveTickBuckets.size() - visibleInactiveTickBucketRowCount())));
	}

	private int visibleRecentRowCount() {
		return historySectionRowCount(historyRecentHeight());
	}

	private int visibleOlderRowCount() {
		return historySectionRowCount(historyOlderHeight());
	}

	private int historySectionRowCount(int height) {
		return Math.max(1, (height - 36) / ROW_HEIGHT);
	}

	private int visibleRecentTreeRowCount() {
		return treeSectionRowCount(functionTreeRecentHeight(functionTreeContentHeight()));
	}

	private int visibleOlderTreeRowCount() {
		return treeSectionRowCount(functionTreeOlderHeight(functionTreeContentHeight()));
	}

	private int treeSectionRowCount(int height) {
		return Math.max(1, (height - 36) / TREE_ROW_HEIGHT);
	}

	private int functionTreeListY() {
		return PADDING + FILTER_HEIGHT * 2 + PADDING;
	}

	private int functionTreeListHeight() {
		return this.height - functionTreeListY() - PADDING;
	}

	private int functionTreeContentHeight() {
		return functionTreeListHeight() - TREE_CONTROL_HEIGHT;
	}

	private int functionTreeRecentHeight(int contentHeight) {
		return Math.max(56, (contentHeight - PADDING) / 2);
	}

	private int functionTreeOlderHeight(int contentHeight) {
		return Math.max(36, contentHeight - functionTreeRecentHeight(contentHeight) - PADDING);
	}

	private int functionTreeOlderSectionY() {
		int contentY = functionTreeListY() + TREE_CONTROL_HEIGHT;
		return contentY + functionTreeRecentHeight(functionTreeContentHeight()) + PADDING;
	}

	private int visibleTickBucketRowCount() {
		return tickBucketSectionRowCount(tickFilterActiveHeight());
	}

	private int visibleInactiveTickBucketRowCount() {
		return tickBucketSectionRowCount(tickFilterInactiveHeight());
	}

	private int tickBucketSectionRowCount(int height) {
		return Math.max(1, (height - 36) / ROW_HEIGHT);
	}

	private int tickFilterPanelY() {
		return PADDING + FILTER_HEIGHT * 3 + PADDING;
	}

	private int tickFilterPanelHeight() {
		return this.height - tickFilterPanelY() - PADDING;
	}

	private int tickFilterListY() {
		return tickFilterPanelY() + FILTER_HEIGHT + 4;
	}

	private int tickFilterListHeight() {
		return Math.max(96, tickFilterPanelHeight() - FILTER_HEIGHT - 4);
	}

	private int tickFilterActiveHeight() {
		int listHeight = tickFilterListHeight();
		int inactiveHeight = Math.max(36, listHeight / 3);
		return Math.max(48, listHeight - inactiveHeight - PADDING);
	}

	private int tickFilterInactiveHeight() {
		return Math.max(36, tickFilterListHeight() - tickFilterActiveHeight() - PADDING);
	}

	private int tickFilterInactiveSectionY() {
		return tickFilterListY() + tickFilterActiveHeight() + PADDING;
	}

	private boolean matchesSearch(VisibleFunctionHud.EventRecord record) {
		String query = searchText.strip().toLowerCase(Locale.ROOT);

		if (query.isEmpty()) {
			return true;
		}

		if (record.type().toLowerCase(Locale.ROOT).contains(query)
			|| Long.toString(record.id()).contains(query)
			|| record.subject().toLowerCase(Locale.ROOT).contains(query)
			|| record.summary().toLowerCase(Locale.ROOT).contains(query)
			|| record.commandContext().command().toLowerCase(Locale.ROOT).contains(query)
			|| record.commandContext().commandId().toLowerCase(Locale.ROOT).contains(query)
			|| record.commandContext().source().toLowerCase(Locale.ROOT).contains(query)
			|| record.commandContext().function().toLowerCase(Locale.ROOT).contains(query)) {
			return true;
		}

		if (record.commandContext().functionCallId().toLowerCase(Locale.ROOT).contains(query)) {
			return true;
		}

		for (VisibleFunctionHud.Field field : record.basicFields()) {
			if (field.name().toLowerCase(Locale.ROOT).contains(query) || field.value().toLowerCase(Locale.ROOT).contains(query)) {
				return true;
			}
		}

		for (VisibleFunctionHud.Field field : record.detailedFields()) {
			if (field.name().toLowerCase(Locale.ROOT).contains(query) || field.value().toLowerCase(Locale.ROOT).contains(query)) {
				return true;
			}
		}

		return false;
	}

	private boolean matchesSearch(VisibleFunctionHud.TickFilterBucket bucket) {
		String query = searchText.strip().toLowerCase(Locale.ROOT);

		if (query.isEmpty()) {
			return true;
		}

		if (bucket.displayName().toLowerCase(Locale.ROOT).contains(query)
			|| bucket.sourceSummary().toLowerCase(Locale.ROOT).contains(query)
			|| bucket.reason().toLowerCase(Locale.ROOT).contains(query)) {
			return true;
		}

		for (VisibleFunctionHud.EventRecord record : bucket.sampleRecords()) {
			if (matchesSearch(record)) {
				return true;
			}
		}

		return false;
	}

	private boolean setFilter(FilterMode mode) {
		filterMode = mode;
		scrollOffset = 0;
		olderScrollOffset = 0;
		treeScrollOffset = 0;
		olderTreeScrollOffset = 0;
		tickFilterScrollOffset = 0;
		inactiveTickFilterScrollOffset = 0;
		selectedIndex = -1;
		selectedTreeIndex = -1;
		selectedTickBucketIndex = -1;
		return true;
	}

	private boolean setTickBucketType(VisibleFunctionHud.TickBucketType type) {
		tickBucketType = type;
		tickFilterScrollOffset = 0;
		inactiveTickFilterScrollOffset = 0;
		selectedTickBucketIndex = -1;
		return true;
	}

	private boolean numberShortcut(FilterMode historyFilter, VisibleFunctionHud.TickBucketType tickBucket) {
		if (viewMode == ViewMode.HISTORY) {
			return setFilter(historyFilter);
		}

		if (viewMode == ViewMode.TICK_FILTER) {
			return setTickBucketType(tickBucket);
		}

		return true;
	}

	private String helpText() {
		return switch (viewMode) {
			case HISTORY -> "\\ focus | T views | type search | wheel list | 1-5 filters | Enter jump/detail | Esc close";
			case FUNCTION_TREE -> "\\ focus | T views | type search | wheel tree | Enter jump/detail | Esc close";
			case TICK_FILTER -> "\\ focus | T views | type search | wheel buckets | 1-3 bucket tabs | Esc close";
		};
	}

	private void setViewMode(ViewMode mode) {
		viewMode = mode;
		scrollOffset = 0;
		olderScrollOffset = 0;
		treeScrollOffset = 0;
		olderTreeScrollOffset = 0;
		tickFilterScrollOffset = 0;
		inactiveTickFilterScrollOffset = 0;
		selectedIndex = -1;
		selectedTreeIndex = -1;
		selectedTickBucketIndex = -1;
	}

	private void moveSelection(int delta) {
		if (viewMode == ViewMode.FUNCTION_TREE) {
			moveTreeSelection(delta);
			return;
		}

		if (viewMode == ViewMode.TICK_FILTER) {
			moveTickBucketSelection(delta);
			return;
		}

		if (visibleRecords.isEmpty()) {
			return;
		}

		selectedIndex = Math.max(0, Math.min(visibleRecords.size() - 1, selectedIndex + delta));
		if (selectedIndex < recentRecords.size()) {
			if (selectedIndex < scrollOffset) {
				scrollOffset = selectedIndex;
			} else if (selectedIndex >= scrollOffset + visibleRecentRowCount()) {
				scrollOffset = selectedIndex - visibleRecentRowCount() + 1;
			}
		} else {
			int olderIndex = selectedIndex - recentRecords.size();
			if (olderIndex < olderScrollOffset) {
				olderScrollOffset = olderIndex;
			} else if (olderIndex >= olderScrollOffset + visibleOlderRowCount()) {
				olderScrollOffset = olderIndex - visibleOlderRowCount() + 1;
			}
		}
	}

	private boolean jumpToSourceCommand() {
		if (viewMode == ViewMode.TICK_FILTER) {
			return false;
		}

		VisibleFunctionHud.EventRecord record = selectedRecord();
		if (record == null || record.isCommand()) {
			return false;
		}

		VisibleFunctionHud.EventRecord sourceCommand = VisibleFunctionHud.traceStore().commandFor(record);
		if (sourceCommand == null) {
			return false;
		}

		int historyIndex = visibleRecords.indexOf(sourceCommand);
		if (historyIndex >= 0) {
			viewMode = ViewMode.HISTORY;
			selectedIndex = historyIndex;
			ensureHistorySelectionVisible();
			return true;
		}

		int treeIndex = treeRowIndexFor(sourceCommand);
		if (treeIndex >= 0) {
			viewMode = ViewMode.FUNCTION_TREE;
			selectedTreeIndex = treeIndex;
			selectedIndex = visibleRecords.indexOf(sourceCommand);
			ensureTreeSelectionVisible();
			return true;
		}

		return false;
	}

	private int treeRowIndexFor(VisibleFunctionHud.EventRecord target) {
		for (int index = 0; index < treeRows.size(); index++) {
			if (treeRows.get(index).record() == target) {
				return index;
			}
		}

		return -1;
	}

	private void ensureHistorySelectionVisible() {
		if (selectedIndex < recentRecords.size()) {
			if (selectedIndex < scrollOffset) {
				scrollOffset = selectedIndex;
			} else if (selectedIndex >= scrollOffset + visibleRecentRowCount()) {
				scrollOffset = selectedIndex - visibleRecentRowCount() + 1;
			}
			return;
		}

		int olderIndex = selectedIndex - recentRecords.size();
		if (olderIndex < olderScrollOffset) {
			olderScrollOffset = olderIndex;
		} else if (olderIndex >= olderScrollOffset + visibleOlderRowCount()) {
			olderScrollOffset = olderIndex - visibleOlderRowCount() + 1;
		}
	}

	private void ensureTreeSelectionVisible() {
		if (selectedTreeIndex < recentTreeRows.size()) {
			if (selectedTreeIndex < treeScrollOffset) {
				treeScrollOffset = selectedTreeIndex;
			} else if (selectedTreeIndex >= treeScrollOffset + visibleRecentTreeRowCount()) {
				treeScrollOffset = selectedTreeIndex - visibleRecentTreeRowCount() + 1;
			}
			return;
		}

		int olderIndex = selectedTreeIndex - recentTreeRows.size();
		if (olderIndex < olderTreeScrollOffset) {
			olderTreeScrollOffset = olderIndex;
		} else if (olderIndex >= olderTreeScrollOffset + visibleOlderTreeRowCount()) {
			olderTreeScrollOffset = olderIndex - visibleOlderTreeRowCount() + 1;
		}
	}

	private void moveTickBucketSelection(int delta) {
		if (tickBuckets.isEmpty()) {
			return;
		}

		selectedTickBucketIndex = Math.max(0, Math.min(tickBuckets.size() - 1, selectedTickBucketIndex + delta));
		ensureTickBucketSelectionVisible();
	}

	private void ensureTickBucketSelectionVisible() {
		if (selectedTickBucketIndex < 0) {
			return;
		}

		if (selectedTickBucketIndex < activeTickBuckets.size()) {
			if (selectedTickBucketIndex < tickFilterScrollOffset) {
				tickFilterScrollOffset = selectedTickBucketIndex;
			} else if (selectedTickBucketIndex >= tickFilterScrollOffset + visibleTickBucketRowCount()) {
				tickFilterScrollOffset = selectedTickBucketIndex - visibleTickBucketRowCount() + 1;
			}
			return;
		}

		int inactiveIndex = selectedTickBucketIndex - activeTickBuckets.size();
		if (inactiveIndex < inactiveTickFilterScrollOffset) {
			inactiveTickFilterScrollOffset = inactiveIndex;
		} else if (inactiveIndex >= inactiveTickFilterScrollOffset + visibleInactiveTickBucketRowCount()) {
			inactiveTickFilterScrollOffset = inactiveIndex - visibleInactiveTickBucketRowCount() + 1;
		}
	}

	private boolean jumpToTimelineTarget(TimelineTarget target) {
		List<VisibleFunctionHud.EventRecord> records = target.bucket().recordsToHighlight(target.lane());
		if (records.isEmpty()) {
			return false;
		}

		timelineHighlightedRecords.clear();
		timelineHighlightedRecords.addAll(records);

		if (target.lane() == TimelineLane.TICK) {
			return jumpToTickFilter(records.getLast());
		}

		if (target.lane() == TimelineLane.FUNCTIONS) {
			return jumpToFunctionRecords(records);
		}

		FilterMode mode = target.lane() == TimelineLane.COMMANDS ? FilterMode.COMMANDS : FilterMode.EVENTS;
		return jumpToHistoryRecords(records, mode);
	}

	private boolean jumpToHistoryRecords(List<VisibleFunctionHud.EventRecord> records, FilterMode mode) {
		filterMode = mode;
		searchText = "";
		setViewMode(ViewMode.HISTORY);
		setHistoryRecords(filteredRecords());

		int index = firstVisibleRecordIndex(records);
		if (index < 0) {
			timelineHighlightedRecords.clear();
			return false;
		}

		selectedIndex = index;
		detailed = true;
		ensureHistorySelectionVisible();
		return true;
	}

	private boolean jumpToFunctionRecords(List<VisibleFunctionHud.EventRecord> records) {
		filterMode = FilterMode.ALL;
		searchText = "";
		setHistoryRecords(filteredRecords());
		setViewMode(ViewMode.FUNCTION_TREE);
		this.treeRows = functionTreeRows();

		int treeIndex = firstTreeRowIndex(records);
		if (treeIndex < 0) {
			timelineHighlightedRecords.clear();
			return false;
		}

		selectedTreeIndex = treeIndex;
		TreeRow row = treeRows.get(selectedTreeIndex);
		selectedIndex = row.record() == null ? -1 : visibleRecords.indexOf(row.record());
		detailed = true;
		ensureTreeSelectionVisible();
		return true;
	}

	private int firstVisibleRecordIndex(List<VisibleFunctionHud.EventRecord> records) {
		for (int index = 0; index < visibleRecords.size(); index++) {
			if (timelineHighlightedRecords.contains(visibleRecords.get(index))) {
				return index;
			}
		}

		return -1;
	}

	private int firstTreeRowIndex(List<VisibleFunctionHud.EventRecord> records) {
		for (int index = 0; index < treeRows.size(); index++) {
			TreeRow row = treeRows.get(index);
			if (row.record() != null && timelineHighlightedRecords.contains(row.record())) {
				return index;
			}
		}

		return -1;
	}

	private boolean jumpToHistoryRecord(VisibleFunctionHud.EventRecord record) {
		filterMode = FilterMode.ALL;
		searchText = "";
		setViewMode(ViewMode.HISTORY);
		setHistoryRecords(filteredRecords());

		int index = visibleRecords.indexOf(record);
		if (index < 0) {
			return false;
		}

		selectedIndex = index;
		detailed = true;
		ensureHistorySelectionVisible();
		return true;
	}

	private boolean jumpToFunctionTreeRecord(VisibleFunctionHud.EventRecord record) {
		searchText = "";
		setHistoryRecords(filteredRecords());
		setViewMode(ViewMode.FUNCTION_TREE);
		this.treeRows = functionTreeRows();

		int treeIndex = treeRowIndexFor(record);
		if (treeIndex < 0) {
			return false;
		}

		selectedTreeIndex = treeIndex;
		selectedIndex = visibleRecords.indexOf(record);
		detailed = true;
		ensureTreeSelectionVisible();
		return true;
	}

	private boolean jumpToTickFilter(VisibleFunctionHud.EventRecord record) {
		VisibleFunctionHud.TickFilterBucket bucket = VisibleFunctionHud.tickFilterBucketFor(record);
		if (bucket == null) {
			return jumpToHistoryRecord(record);
		}

		searchText = "";
		setViewMode(ViewMode.TICK_FILTER);
		tickBucketType = bucket.type();
		this.tickBuckets = tickFilterBuckets();
		selectedTickBucketIndex = tickBuckets.indexOf(bucket);
		if (selectedTickBucketIndex < 0 && !tickBuckets.isEmpty()) {
			selectedTickBucketIndex = 0;
		}
		ensureTickBucketSelectionVisible();
		return true;
	}

	private VisibleFunctionHud.TickFilterBucket selectedTickBucket() {
		if (selectedTickBucketIndex < 0 || selectedTickBucketIndex >= tickBuckets.size()) {
			return tickBuckets.getFirst();
		}

		return tickBuckets.get(selectedTickBucketIndex);
	}

	private void moveTreeSelection(int delta) {
		if (treeRows.isEmpty()) {
			return;
		}

		int next = selectedTreeIndex;
		do {
			next = Math.max(0, Math.min(treeRows.size() - 1, next + delta));
			if (treeRows.get(next).record() != null || next == 0 || next == treeRows.size() - 1) {
				break;
			}
		} while (true);

		selectedTreeIndex = next;
			TreeRow row = treeRows.get(selectedTreeIndex);
			if (row.record() != null) {
				selectedIndex = visibleRecords.indexOf(row.record());
		}

		ensureTreeSelectionVisible();
	}

	private VisibleFunctionHud.EventRecord selectedRecord() {
		if (viewMode == ViewMode.FUNCTION_TREE && selectedTreeIndex >= 0 && selectedTreeIndex < treeRows.size()) {
			TreeRow row = treeRows.get(selectedTreeIndex);
			if (row.record() != null) {
				return row.record();
			}

			for (TreeRow treeRow : treeRows) {
				if (treeRow.record() != null) {
					return treeRow.record();
				}
			}
		}

		if (selectedIndex < 0 || selectedIndex >= visibleRecords.size()) {
			return null;
		}

		return visibleRecords.get(selectedIndex);
	}

	private void clearInteractiveRects() {
		viewRects.clear();
		filterRects.clear();
		tickBucketTabRects.clear();
		rowRects.clear();
		treeRowRects.clear();
		tickBucketRects.clear();
		historyActionButtonRects.clear();
		tickFilterActionButtonRects.clear();
		timelineHitRects.clear();
		timelineControlButtonRects.clear();
	}

	private void clearTimelineSelection() {
		timelineSelection = null;
		timelineHighlightedRecords.clear();
	}

	private void setHistoryRecords(List<VisibleFunctionHud.EventRecord> records) {
		List<VisibleFunctionHud.EventRecord> recent = new ArrayList<>();
		List<VisibleFunctionHud.EventRecord> older = new ArrayList<>();

		for (VisibleFunctionHud.EventRecord record : records) {
			if (VisibleFunctionHud.isHistoryOlder(record)) {
				older.add(record);
			} else {
				recent.add(record);
			}
		}

		this.recentRecords = List.copyOf(recent);
		this.olderRecords = List.copyOf(older);

		List<VisibleFunctionHud.EventRecord> all = new ArrayList<>(recent.size() + older.size());
		all.addAll(recent);
		all.addAll(older);
		this.visibleRecords = List.copyOf(all);
	}

	private int historyListY() {
		return PADDING + FILTER_HEIGHT * 3 + PADDING;
	}

	private int historyListHeight() {
		return this.height - historyListY() - PADDING;
	}

	private int historyRecentHeight() {
		return Math.max(56, (historyListHeight() - PADDING) / 2);
	}

	private int historyOlderHeight() {
		return Math.max(36, historyListHeight() - historyRecentHeight() - PADDING);
	}

	private int historyOlderSectionY() {
		return historyListY() + historyRecentHeight() + PADDING;
	}

	private int firstSelectableTreeRow() {
		for (int index = 0; index < treeRows.size(); index++) {
			if (treeRows.get(index).record() != null) {
				return index;
			}
		}
		return 0;
	}

	private enum ViewMode {
		HISTORY("History"),
		FUNCTION_TREE("Function Tree"),
		TICK_FILTER("Tick Filter");

		private final String label;

		ViewMode(String label) {
			this.label = label;
		}

		String label() {
			return label;
		}

		ViewMode next() {
			ViewMode[] values = values();
			return values[(ordinal() + 1) % values.length];
		}
	}

	private static int colorFor(String type) {
		return switch (type) {
			case "COMMAND" -> 0xFFB9F18D;
			case "EVENT" -> 0xFF9FC5FF;
			default -> 0xFFFFD28A;
		};
	}

	private enum FilterMode {
		ALL("1 All") {
			@Override
			boolean matches(VisibleFunctionHud.EventRecord record) {
				return true;
			}
		},
		COMMANDS("2 Commands") {
			@Override
			boolean matches(VisibleFunctionHud.EventRecord record) {
				return record.isCommand();
			}
		},
		EVENTS("3 Events") {
			@Override
			boolean matches(VisibleFunctionHud.EventRecord record) {
				return record.isEvent();
			}
		},
		FUNCTION("4 Function") {
			@Override
			boolean matches(VisibleFunctionHud.EventRecord record) {
				return "function".equals(record.commandContext().source()) || !"none".equals(record.commandContext().function());
			}
		},
		HIDE_PLAYER("5 Hide Player") {
			@Override
			boolean matches(VisibleFunctionHud.EventRecord record) {
				return !"player".equals(record.commandContext().source());
			}
		};

		private final String label;

		FilterMode(String label) {
			this.label = label;
		}

		String label() {
			return label;
		}

		abstract boolean matches(VisibleFunctionHud.EventRecord record);
	}

	private record ClickableRect(VisibleFunctionHud.Rect rect, FilterMode filterMode) {
	}

	private record ClickableViewRect(VisibleFunctionHud.Rect rect, ViewMode viewMode) {
	}

	private record TickBucketTabRect(VisibleFunctionHud.Rect rect, VisibleFunctionHud.TickBucketType type) {
	}

	private record RowRect(VisibleFunctionHud.Rect rect, int recordIndex) {
	}

	private enum HistoryAction {
		MOVE_TO_OLDER,
		CLEAR_OLDER
	}

	private record HistoryActionButtonRect(VisibleFunctionHud.Rect rect, HistoryAction action) {
	}

	private record FunctionNode(
		String function,
		long functionCallId,
		long firstSeenMillis,
		long lastSeenMillis,
		VisibleFunctionHud.EventRecord lastRecord,
		List<CommandNode> commands
	) {
		private FunctionNode withTimeRange(List<VisibleFunctionHud.EventRecord> records) {
			long firstSeen = Long.MAX_VALUE;
			long lastSeen = Long.MIN_VALUE;
			VisibleFunctionHud.EventRecord latest = null;

			for (VisibleFunctionHud.EventRecord record : records) {
				firstSeen = Math.min(firstSeen, record.timestampMillis());
				if (record.timestampMillis() >= lastSeen) {
					lastSeen = record.timestampMillis();
					latest = record;
				}
			}

			return new FunctionNode(function, functionCallId, firstSeen, lastSeen, latest, commands);
		}

		private boolean isOlder() {
			return lastRecord != null && VisibleFunctionHud.isHistoryOlder(lastRecord);
		}
	}

	private static final class CommandNode {
		private final String key;
		private final String command;
		private final String displayCommandId;
		private final List<VisibleFunctionHud.EventRecord> events;
		private VisibleFunctionHud.EventRecord commandRecord;

		private CommandNode(
			String key,
			String command,
			String displayCommandId,
			VisibleFunctionHud.EventRecord commandRecord,
			List<VisibleFunctionHud.EventRecord> events
		) {
			this.key = key;
			this.command = command;
			this.displayCommandId = displayCommandId;
			this.commandRecord = commandRecord;
			this.events = events;
		}

		private String key() {
			return key;
		}

		private String command() {
			return command;
		}

		private String displayCommandId() {
			return displayCommandId;
		}

		private VisibleFunctionHud.EventRecord commandRecord() {
			return commandRecord;
		}

		private List<VisibleFunctionHud.EventRecord> events() {
			return events;
		}

		private VisibleFunctionHud.EventRecord representativeRecord() {
			return commandRecord != null ? commandRecord : events.getFirst();
		}
	}

	private enum TreeRowKind {
		SECTION,
		HEADER,
		COMMAND,
		EVENT
	}

	private record TreeRow(String text, int color, VisibleFunctionHud.EventRecord record, TreeRowKind kind) {
		static TreeRow section(String text) {
			return new TreeRow(text, 0xFFE6E6E6, null, TreeRowKind.SECTION);
		}

		static TreeRow header(String function) {
			return new TreeRow(function, 0xFFFFD28A, null, TreeRowKind.HEADER);
		}

		static TreeRow command(String text, VisibleFunctionHud.EventRecord record) {
			return new TreeRow(text, 0xFFB9F18D, record, TreeRowKind.COMMAND);
		}

		static TreeRow event(String text, VisibleFunctionHud.EventRecord record) {
			return new TreeRow(text, 0xFF9FC5FF, record, TreeRowKind.EVENT);
		}
	}

	private record TreeRowRect(VisibleFunctionHud.Rect rect, int rowIndex) {
	}

	private record TickBucketRect(VisibleFunctionHud.Rect rect, int bucketIndex) {
	}

	private record TickFilterActionButtonRect(VisibleFunctionHud.Rect rect) {
	}

	private enum TimelineLane {
		COMMANDS("COMMANDS", 0xFFB9F18D),
		EVENTS("EVENTS", 0xFF9FC5FF),
		FUNCTIONS("FUNCTIONS", 0xFFFFD28A),
		TICK("TICK", 0xFFBFC7D5);

		private final String label;
		private final int color;

		TimelineLane(String label, int color) {
			this.label = label;
			this.color = color;
		}

		private String label() {
			return label;
		}

		private int color() {
			return color;
		}
	}

	private static final class TimelineBucket {
		private final long tick;
		private final List<VisibleFunctionHud.EventRecord> allRecords = new ArrayList<>();
		private final List<VisibleFunctionHud.EventRecord> commands = new ArrayList<>();
		private final List<VisibleFunctionHud.EventRecord> events = new ArrayList<>();
		private final List<VisibleFunctionHud.EventRecord> functions = new ArrayList<>();
		private final List<VisibleFunctionHud.EventRecord> tickRecords = new ArrayList<>();
		private long startRecordId = Long.MAX_VALUE;
		private long endRecordId = Long.MIN_VALUE;

		private TimelineBucket(long tick) {
			this.tick = tick;
		}

		private void add(VisibleFunctionHud.EventRecord record, boolean tickFiltered) {
			allRecords.add(record);
			startRecordId = Math.min(startRecordId, record.id());
			endRecordId = Math.max(endRecordId, record.id());

			if (tickFiltered) {
				tickRecords.add(record);
				return;
			}

			if (record.isCommand()) {
				commands.add(record);
			}

			if (record.isEvent()) {
				events.add(record);
			}

			if (!"none".equals(record.commandContext().function()) && !hasFunctionRef(record)) {
				functions.add(record);
			}
		}

		private boolean hasFunctionRef(VisibleFunctionHud.EventRecord record) {
			String functionCallId = record.commandContext().functionCallId();
			for (VisibleFunctionHud.EventRecord existing : functions) {
				if (existing.commandContext().functionCallId().equals(functionCallId)) {
					return true;
				}
			}
			return false;
		}

		private long tick() {
			return tick;
		}

		private long timestampMillis() {
			return tick * TIMELINE_TICK_MILLIS;
		}

		private int totalCount() {
			return allRecords.size();
		}

		private List<VisibleFunctionHud.EventRecord> commands() {
			return commands;
		}

		private List<VisibleFunctionHud.EventRecord> events() {
			return events;
		}

		private List<VisibleFunctionHud.EventRecord> functions() {
			return functions;
		}

		private List<VisibleFunctionHud.EventRecord> tickRecords() {
			return tickRecords;
		}

		private VisibleFunctionHud.EventRecord primaryRecord(TimelineLane lane) {
			List<VisibleFunctionHud.EventRecord> records = recordsForLane(lane);
			if (!records.isEmpty()) {
				return records.getLast();
			}

			return allRecords.isEmpty() ? null : allRecords.getLast();
		}

		private List<VisibleFunctionHud.EventRecord> recordsForLane(TimelineLane lane) {
			return switch (lane) {
				case COMMANDS -> commands;
				case EVENTS -> events;
				case FUNCTIONS -> functions;
				case TICK -> tickRecords;
			};
		}

		private List<VisibleFunctionHud.EventRecord> recordsToHighlight(TimelineLane lane) {
			if (lane != TimelineLane.FUNCTIONS) {
				return recordsForLane(lane);
			}

			List<VisibleFunctionHud.EventRecord> records = new ArrayList<>();
			for (VisibleFunctionHud.EventRecord record : allRecords) {
				if (!"none".equals(record.commandContext().function()) && !VisibleFunctionHud.isTickFiltered(record)) {
					records.add(record);
				}
			}
			return records;
		}
	}

	private record TimelineTarget(TimelineLane lane, TimelineBucket bucket, int tickTrack) {
		private String key() {
			return lane.name() + ":" + bucket.tick();
		}

		private boolean sameTarget(TimelineTarget other) {
			return other != null && lane == other.lane() && bucket.tick() == other.bucket().tick() && tickTrack == other.tickTrack();
		}

		private VisibleFunctionHud.EventRecord record() {
			return bucket.primaryRecord(lane);
		}

		private long timestampMillis() {
			return bucket.timestampMillis();
		}

		private int markerCount() {
			return bucket.recordsForLane(lane).size();
		}

		private boolean aggregate() {
			return markerCount() > 1;
		}

		private String summaryNoun(int count) {
			return switch (lane) {
				case COMMANDS -> count == 1 ? "command" : "commands";
				case EVENTS -> count == 1 ? "event" : "events";
				case FUNCTIONS -> count == 1 ? "function" : "functions";
				case TICK -> count == 1 ? "filtered record" : "filtered records";
			};
		}
	}

	private record TimelineHitRect(VisibleFunctionHud.Rect rect, TimelineTarget target) {
	}

	private record TimelineControlButtonRect(VisibleFunctionHud.Rect rect) {
	}
}
