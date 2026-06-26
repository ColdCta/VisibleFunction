package com.visiblefunction;

import net.minecraft.resources.Identifier;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class DatapackCommandAnalyzer {
	private static final Pattern SELECTOR = Pattern.compile("@([pares])(?:\\[([^\\]]*)])?");
	private static final Set<String> EXECUTE_CLAUSE_KEYWORDS = Set.of(
		"align",
		"anchored",
		"as",
		"at",
		"facing",
		"if",
		"in",
		"on",
		"positioned",
		"rotated",
		"store",
		"summon",
		"unless"
	);

	private DatapackCommandAnalyzer() {
	}

	static CommandAnalysis analyze(String functionId, int line, String rawCommand, List<String> warnings) {
		String normalized = CommandText.normalize(rawCommand);
		Builder builder = new Builder(functionId, line, rawCommand.strip(), normalized);
		analyzeInto(builder, normalized, warnings, 0);
		return builder.build();
	}

	private static void analyzeInto(Builder builder, String command, List<String> warnings, int depth) {
		if (depth > 8) {
			warnings.add("Stopped deep nested command analysis in " + builder.functionId + " at line " + builder.line + ": " + command);
			return;
		}

		builder.effectiveCommand = command;
		List<String> tokens = CommandText.tokenize(command);
		if (tokens.isEmpty()) {
			builder.rootCommand = "none";
			return;
		}

		String root = lower(tokens, 0);
		if ("none".equals(builder.rootCommand)) {
			builder.rootCommand = root;
		}

		parseSelectors(command, builder);

		if ("execute".equals(root)) {
			ExecuteParseResult execute = parseExecute(tokens, command, builder, warnings);
			builder.execute = execute.context();
			if (!execute.context().runCommand().isBlank()) {
				analyzeInto(builder, execute.context().runCommand(), warnings, depth + 1);
			}
			return;
		}

		if ("return".equals(root) && tokens.size() >= 3 && "run".equals(lower(tokens, 1))) {
			String nested = CommandText.normalize(join(tokens, 2, tokens.size()));
			builder.effectiveCommand = nested;
			analyzeInto(builder, nested, warnings, depth + 1);
			return;
		}

		parseFunctionCall(tokens, "direct", builder, warnings);
		parseScheduledFunction(tokens, builder, warnings);
		parseVariables(tokens, command, builder);
	}

	private static ExecuteParseResult parseExecute(
		List<String> tokens,
		String command,
		Builder builder,
		List<String> warnings
	) {
		int runIndex = findRunIndex(tokens);
		int end = runIndex < 0 ? tokens.size() : runIndex;
		List<ExecuteClause> clauses = new ArrayList<>();
		List<ExecuteClause> conditions = new ArrayList<>();
		List<ExecuteClause> stores = new ArrayList<>();
		List<ExecuteClause> contexts = new ArrayList<>();
		List<String> conditionPieces = new ArrayList<>();

		int index = 1;
		while (index < end) {
			String keyword = lower(tokens, index);
			ClauseParseResult parsed = switch (keyword) {
				case "if", "unless" -> parseCondition(tokens, index, end, keyword, builder, warnings);
				case "store" -> parseStore(tokens, index, end, builder);
				case "as", "at", "on", "in", "align", "anchored", "summon" -> parseFixedContext(tokens, index, end, keyword, 1);
				case "positioned", "rotated" -> parsePositionedOrRotated(tokens, index, end, keyword);
				case "facing" -> parseFacing(tokens, index, end);
				default -> new ClauseParseResult(
					new ExecuteClause("context", keyword, tokens.get(index), tokenOr(tokens, index, "unknown"), keyword, List.of(), List.of()),
					index + 1
				);
			};

			clauses.add(parsed.clause());
			switch (parsed.clause().mode()) {
				case "if", "unless" -> {
					conditions.add(parsed.clause());
					conditionPieces.add(parsed.clause().summary());
				}
				case "store" -> stores.add(parsed.clause());
				default -> {
					contexts.add(parsed.clause());
					if (!parsed.clause().summary().isBlank()) {
						conditionPieces.add(parsed.clause().summary());
					}
				}
			}
			index = Math.max(index + 1, parsed.nextIndex());
		}

		String runCommand = runIndex >= 0 && runIndex + 1 < tokens.size()
			? CommandText.normalize(join(tokens, runIndex + 1, tokens.size()))
			: "";
		ExecuteContext context = new ExecuteContext(
			true,
			List.copyOf(clauses),
			List.copyOf(conditions),
			List.copyOf(stores),
			List.copyOf(contexts),
			runCommand
		);
		builder.conditionSummary = conditionPieces.isEmpty() ? "none" : String.join(" ", conditionPieces);
		return new ExecuteParseResult(context);
	}

	private static ClauseParseResult parseCondition(
		List<String> tokens,
		int index,
		int end,
		String mode,
		Builder builder,
		List<String> warnings
	) {
		String kind = lower(tokens, index + 1);
		int next = consumeUntilNextClause(tokens, index + 2, end);
		String raw = join(tokens, index, next);
		List<VariableRef> variables = new ArrayList<>();
		List<SelectorRef> selectors = new ArrayList<>();
		String subject = tokenOr(tokens, index + 2, "unknown");

		switch (kind) {
			case "entity" -> selectors.addAll(parseSelectorsFromToken(subject, builder));
			case "score" -> parseExecuteScoreCondition(tokens, index + 2, next, variables);
			case "data" -> parseExecuteDataCondition(tokens, index + 2, next, variables);
			case "function" -> {
				if (index + 2 < next) {
					addCall(tokens.get(index + 2), "condition", builder, warnings);
				}
			}
			default -> {
			}
		}

		for (VariableRef variable : variables) {
			builder.addVariable(variable);
		}

		String summary = mode + " " + kind + " " + join(tokens, index + 2, Math.min(next, index + 5)).strip();
		return new ClauseParseResult(new ExecuteClause(mode, kind, raw, subject, summary, keys(variables), selectors), next);
	}

	private static ClauseParseResult parseStore(List<String> tokens, int index, int end, Builder builder) {
		int next = consumeUntilNextClause(tokens, index + 1, end);
		String raw = join(tokens, index, next);
		List<VariableRef> variables = new ArrayList<>();
		String subject = tokenOr(tokens, index + 3, "unknown");
		if (isResultOrSuccess(tokens, index + 1)) {
			String targetKind = lower(tokens, index + 2);
			if ("score".equals(targetKind) && index + 4 < next) {
				variables.add(score(tokens.get(index + 3), tokens.get(index + 4), "write"));
				variables.add(scoreboard(tokens.get(index + 4), "update"));
				subject = tokens.get(index + 3) + ":" + tokens.get(index + 4);
			} else if ("storage".equals(targetKind) && index + 4 < next) {
				variables.add(storage(tokens.get(index + 3), tokens.get(index + 4), "write"));
				subject = tokens.get(index + 3) + " " + tokens.get(index + 4);
			} else if ("bossbar".equals(targetKind) && index + 3 < next) {
				variables.add(bossbar(tokens.get(index + 3), "write"));
				subject = tokens.get(index + 3);
			}
		}
		for (VariableRef variable : variables) {
			builder.addVariable(variable);
		}
		return new ClauseParseResult(new ExecuteClause("store", "store", raw, subject, raw, keys(variables), List.of()), next);
	}

	private static ClauseParseResult parseFixedContext(List<String> tokens, int index, int end, String keyword, int valueCount) {
		int next = Math.min(end, index + 1 + valueCount);
		String subject = tokenOr(tokens, index + 1, "unknown");
		List<SelectorRef> selectors = parseSelectorsFromToken(subject, null);
		return new ClauseParseResult(
			new ExecuteClause("context", keyword, join(tokens, index, next), subject, keyword + " " + subject, List.of(), selectors),
			next
		);
	}

	private static ClauseParseResult parsePositionedOrRotated(List<String> tokens, int index, int end, String keyword) {
		int next;
		if ("as".equals(lower(tokens, index + 1))) {
			next = Math.min(end, index + 3);
		} else {
			next = Math.min(end, index + 4);
		}
		String subject = join(tokens, index + 1, next);
		return new ClauseParseResult(
			new ExecuteClause("context", keyword, join(tokens, index, next), subject, keyword + " " + subject, List.of(), parseSelectorsFromToken(subject, null)),
			next
		);
	}

	private static ClauseParseResult parseFacing(List<String> tokens, int index, int end) {
		int next = "entity".equals(lower(tokens, index + 1)) ? Math.min(end, index + 4) : Math.min(end, index + 4);
		String subject = join(tokens, index + 1, next);
		return new ClauseParseResult(
			new ExecuteClause("context", "facing", join(tokens, index, next), subject, "facing " + subject, List.of(), parseSelectorsFromToken(subject, null)),
			next
		);
	}

	private static void parseExecuteScoreCondition(List<String> tokens, int start, int end, List<VariableRef> variables) {
		if (start + 1 >= end) {
			return;
		}
		variables.add(score(tokens.get(start), tokens.get(start + 1), "read"));
		variables.add(scoreboard(tokens.get(start + 1), "read"));
		if (start + 5 < end && isScoreComparison(tokens.get(start + 3))) {
			variables.add(score(tokens.get(start + 4), tokens.get(start + 5), "read"));
			variables.add(scoreboard(tokens.get(start + 5), "read"));
		}
	}

	private static void parseExecuteDataCondition(List<String> tokens, int start, int end, List<VariableRef> variables) {
		if (start + 2 >= end) {
			return;
		}
		if ("storage".equals(lower(tokens, start)) && start + 2 < end) {
			variables.add(storage(tokens.get(start + 1), tokens.get(start + 2), "read"));
		}
	}

	private static int findRunIndex(List<String> tokens) {
		for (int index = 1; index < tokens.size(); index++) {
			if ("run".equals(lower(tokens, index))) {
				return index;
			}
		}
		return -1;
	}

	private static int consumeUntilNextClause(List<String> tokens, int start, int end) {
		int index = start;
		while (index < end) {
			if (EXECUTE_CLAUSE_KEYWORDS.contains(lower(tokens, index))) {
				break;
			}
			index++;
		}
		return index;
	}

	private static void parseFunctionCall(List<String> tokens, String kind, Builder builder, List<String> warnings) {
		if (tokens.size() >= 2 && "function".equals(lower(tokens, 0))) {
			addCall(tokens.get(1), kind, builder, warnings);
		}
	}

	private static void parseScheduledFunction(List<String> tokens, Builder builder, List<String> warnings) {
		if (tokens.size() >= 3 && "schedule".equals(lower(tokens, 0)) && "function".equals(lower(tokens, 1))) {
			addCall(tokens.get(2), "scheduled", builder, warnings);
		}
	}

	private static void addCall(String rawTarget, String kind, Builder builder, List<String> warnings) {
		boolean tag = rawTarget.startsWith("#");
		String rawId = tag ? rawTarget.substring(1) : rawTarget;
		Identifier id = Identifier.tryParse(rawId);
		if (id == null) {
			warnings.add("Invalid function reference " + rawTarget + " in " + builder.functionId + " at line " + builder.line);
			return;
		}
		builder.calls.add(new FunctionCall(id.toString(), tag, tag ? "tag" : kind));
	}

	private static void parseVariables(List<String> tokens, String command, Builder builder) {
		if (tokens.isEmpty()) {
			return;
		}
		switch (lower(tokens, 0)) {
			case "scoreboard" -> parseScoreboard(tokens, builder);
			case "data" -> parseData(tokens, builder);
			case "tag" -> parseTag(tokens, builder);
			case "bossbar" -> parseBossbar(tokens, builder);
			default -> {
			}
		}
	}

	private static void parseScoreboard(List<String> tokens, Builder builder) {
		if (tokens.size() < 3) {
			return;
		}

		String area = lower(tokens, 1);
		String action = lower(tokens, 2);
		if ("objectives".equals(area)) {
			if (("add".equals(action) || "remove".equals(action) || "modify".equals(action)) && tokens.size() >= 4) {
				String access = "add".equals(action) ? "declare" : "remove".equals(action) ? "remove" : "update";
				builder.addVariable(scoreboard(tokens.get(3), access));
			} else if ("setdisplay".equals(action) && tokens.size() >= 5) {
				builder.addVariable(scoreboard(tokens.get(4), "update"));
			}
			return;
		}

		if (!"players".equals(area)) {
			return;
		}

		switch (action) {
			case "set" -> addScoreVariables(tokens, builder, 3, "write");
			case "add", "remove", "enable" -> addScoreVariables(tokens, builder, 3, "update");
			case "get" -> addScoreVariables(tokens, builder, 3, "read");
			case "reset" -> {
				if (tokens.size() >= 5) {
					addScoreVariables(tokens, builder, 3, "remove");
				} else if (tokens.size() >= 4) {
					builder.addVariable(new VariableRef("score:" + tokens.get(3) + ":*", "score", tokens.get(3) + ":*", "remove"));
				}
			}
			case "operation" -> {
				addScoreVariables(tokens, builder, 3, "update");
				addScoreVariables(tokens, builder, 6, "read");
			}
			case "list" -> {
				if (tokens.size() >= 4) {
					builder.addVariable(new VariableRef("score:" + tokens.get(3) + ":*", "score", tokens.get(3) + ":*", "query"));
				}
			}
			default -> {
			}
		}
	}

	private static void addScoreVariables(List<String> tokens, Builder builder, int start, String access) {
		if (tokens.size() <= start + 1) {
			return;
		}
		builder.addVariable(score(tokens.get(start), tokens.get(start + 1), access));
		builder.addVariable(scoreboard(tokens.get(start + 1), "read".equals(access) ? "read" : "update"));
	}

	private static void parseData(List<String> tokens, Builder builder) {
		if (tokens.size() < 4 || !"storage".equals(lower(tokens, 2))) {
			return;
		}
		String action = lower(tokens, 1);
		String storage = tokens.get(3);
		switch (action) {
			case "get" -> builder.addVariable(storage(storage, tokenOr(tokens, 4, "root"), "query"));
			case "merge" -> builder.addVariable(storage(storage, "root", "update"));
			case "modify" -> {
				builder.addVariable(storage(storage, tokenOr(tokens, 4, "root"), "update"));
				for (int index = 5; index + 2 < tokens.size(); index++) {
					if ("from".equals(lower(tokens, index)) && "storage".equals(lower(tokens, index + 1))) {
						builder.addVariable(storage(tokens.get(index + 2), tokenOr(tokens, index + 3, "root"), "read"));
					}
				}
			}
			case "remove" -> builder.addVariable(storage(storage, tokenOr(tokens, 4, "root"), "remove"));
			default -> {
			}
		}
	}

	private static void parseTag(List<String> tokens, Builder builder) {
		if (tokens.size() < 3) {
			return;
		}
		String action = lower(tokens, 2);
		if ("add".equals(action) && tokens.size() >= 4) {
			builder.addVariable(tag(tokens.get(3), "write"));
		} else if ("remove".equals(action) && tokens.size() >= 4) {
			builder.addVariable(tag(tokens.get(3), "remove"));
		} else if ("list".equals(action)) {
			builder.addVariable(new VariableRef("tag:*", "tag", "*", "query"));
		}
	}

	private static void parseBossbar(List<String> tokens, Builder builder) {
		if (tokens.size() < 2) {
			return;
		}
		String action = lower(tokens, 1);
		if ("list".equals(action)) {
			builder.addVariable(new VariableRef("bossbar:*", "bossbar", "*", "query"));
		} else if (tokens.size() >= 3) {
			String access = switch (action) {
				case "add" -> "declare";
				case "remove" -> "remove";
				case "get" -> "query";
				default -> "update";
			};
			builder.addVariable(bossbar(tokens.get(2), access));
		}
	}

	private static void parseSelectors(String command, Builder builder) {
		for (SelectorRef selector : selectors(command)) {
			builder.selectors.add(selector);
			String scores = selector.filters().get("scores");
			if (scores != null) {
				for (String part : splitTopLevel(stripBraces(scores), ',')) {
					int separator = part.indexOf('=');
					if (separator > 0) {
						builder.addVariable(scoreboard(part.substring(0, separator).strip(), "read"));
					}
				}
			}
			String tag = selector.filters().get("tag");
			if (tag != null && !tag.isBlank()) {
				builder.addVariable(tag(tag.replace("!", "").strip(), "read"));
			}
		}
	}

	private static List<SelectorRef> parseSelectorsFromToken(String token, Builder builder) {
		List<SelectorRef> selectors = selectors(token);
		if (builder != null) {
			for (SelectorRef selector : selectors) {
				builder.selectors.add(selector);
			}
		}
		return selectors;
	}

	private static List<SelectorRef> selectors(String text) {
		List<SelectorRef> selectors = new ArrayList<>();
		Matcher matcher = SELECTOR.matcher(text);
		while (matcher.find()) {
			String raw = matcher.group();
			String target = "@" + matcher.group(1);
			Map<String, String> filters = selectorFilters(matcher.group(2));
			selectors.add(new SelectorRef(raw, target, filters));
		}
		return selectors;
	}

	private static Map<String, String> selectorFilters(String text) {
		Map<String, String> filters = new LinkedHashMap<>();
		if (text == null || text.isBlank()) {
			return filters;
		}
		for (String part : splitTopLevel(text, ',')) {
			int separator = part.indexOf('=');
			if (separator <= 0) {
				continue;
			}
			String key = part.substring(0, separator).strip();
			String value = part.substring(separator + 1).strip();
			if (!key.isBlank()) {
				filters.put(key, value);
			}
		}
		return filters;
	}

	private static List<String> splitTopLevel(String text, char separator) {
		List<String> parts = new ArrayList<>();
		StringBuilder part = new StringBuilder();
		int depth = 0;
		boolean quoted = false;
		char quote = 0;
		boolean escaped = false;
		for (int index = 0; index < text.length(); index++) {
			char c = text.charAt(index);
			if (escaped) {
				part.append(c);
				escaped = false;
				continue;
			}
			if (c == '\\') {
				part.append(c);
				escaped = true;
				continue;
			}
			if (quoted) {
				part.append(c);
				if (c == quote) {
					quoted = false;
				}
				continue;
			}
			if (c == '"' || c == '\'') {
				part.append(c);
				quoted = true;
				quote = c;
				continue;
			}
			if (c == '[' || c == '{' || c == '(') {
				depth++;
			} else if (c == ']' || c == '}' || c == ')') {
				depth = Math.max(0, depth - 1);
			}
			if (c == separator && depth == 0) {
				parts.add(part.toString().strip());
				part.setLength(0);
				continue;
			}
			part.append(c);
		}
		if (!part.isEmpty()) {
			parts.add(part.toString().strip());
		}
		return parts;
	}

	private static String stripBraces(String text) {
		String stripped = text.strip();
		if (stripped.startsWith("{") && stripped.endsWith("}") && stripped.length() >= 2) {
			return stripped.substring(1, stripped.length() - 1);
		}
		return stripped;
	}

	private static VariableRef score(String holder, String objective, String access) {
		return new VariableRef("score:" + holder + ":" + objective, "score", holder + ":" + objective, access);
	}

	private static VariableRef scoreboard(String objective, String access) {
		return new VariableRef("scoreboard:" + objective, "scoreboard", objective, access);
	}

	private static VariableRef storage(String storage, String path, String access) {
		String storagePath = path == null || path.isBlank() ? "root" : path;
		String suffix = "root".equals(storagePath) ? "" : " " + storagePath;
		return new VariableRef("storage:" + storage + suffix, "storage", storage + suffix, access);
	}

	private static VariableRef tag(String tag, String access) {
		return new VariableRef("tag:" + tag, "tag", tag, access);
	}

	private static VariableRef bossbar(String bossbar, String access) {
		return new VariableRef("bossbar:" + bossbar, "bossbar", bossbar, access);
	}

	private static List<String> keys(List<VariableRef> variables) {
		return variables.stream().map(VariableRef::key).distinct().toList();
	}

	private static boolean isResultOrSuccess(List<String> tokens, int index) {
		if (index < 0 || index >= tokens.size()) {
			return false;
		}
		String token = lower(tokens, index);
		return "result".equals(token) || "success".equals(token);
	}

	private static boolean isScoreComparison(String token) {
		return "=".equals(token) || "<".equals(token) || "<=".equals(token) || ">".equals(token) || ">=".equals(token);
	}

	private static String tokenOr(List<String> tokens, int index, String fallback) {
		return index >= 0 && index < tokens.size() ? tokens.get(index) : fallback;
	}

	private static String lower(List<String> tokens, int index) {
		return index >= 0 && index < tokens.size() ? tokens.get(index).toLowerCase(Locale.ROOT) : "";
	}

	private static String join(List<String> tokens, int start, int end) {
		StringBuilder out = new StringBuilder();
		for (int index = start; index < end && index < tokens.size(); index++) {
			if (index > start) {
				out.append(' ');
			}
			out.append(tokens.get(index));
		}
		return out.toString();
	}

	private record ExecuteParseResult(ExecuteContext context) {
	}

	private record ClauseParseResult(ExecuteClause clause, int nextIndex) {
	}

	record FunctionCall(String id, boolean tag, String kind) {
	}

	record SelectorRef(String raw, String target, Map<String, String> filters) {
	}

	record VariableRef(String key, String kind, String name, String access) {
	}

	record ExecuteClause(
		String mode,
		String keyword,
		String raw,
		String subject,
		String summary,
		List<String> variables,
		List<SelectorRef> selectors
	) {
	}

	record ExecuteContext(
		boolean present,
		List<ExecuteClause> clauses,
		List<ExecuteClause> conditions,
		List<ExecuteClause> stores,
		List<ExecuteClause> contextModifiers,
		String runCommand
	) {
		static ExecuteContext empty() {
			return new ExecuteContext(false, List.of(), List.of(), List.of(), List.of(), "");
		}
	}

	record CommandAnalysis(
		String id,
		String function,
		int line,
		String rawCommand,
		String effectiveCommand,
		String rootCommand,
		ExecuteContext execute,
		List<FunctionCall> calls,
		List<VariableRef> variables,
		List<String> variablesRead,
		List<String> variablesWritten,
		List<SelectorRef> selectors,
		String conditionSummary
	) {
	}

	private static final class Builder {
		private final String functionId;
		private final int line;
		private final String rawCommand;
		private final String normalizedCommand;
		private final List<FunctionCall> calls = new ArrayList<>();
		private final List<VariableRef> variables = new ArrayList<>();
		private final List<SelectorRef> selectors = new ArrayList<>();
		private String effectiveCommand;
		private String rootCommand = "none";
		private ExecuteContext execute = ExecuteContext.empty();
		private String conditionSummary = "none";

		private Builder(String functionId, int line, String rawCommand, String normalizedCommand) {
			this.functionId = functionId;
			this.line = line;
			this.rawCommand = rawCommand;
			this.normalizedCommand = normalizedCommand;
			this.effectiveCommand = normalizedCommand;
		}

		private void addVariable(VariableRef variable) {
			if (variable.key() == null || variable.key().isBlank()) {
				return;
			}
			variables.add(variable);
		}

		private CommandAnalysis build() {
			LinkedHashSet<String> reads = new LinkedHashSet<>();
			LinkedHashSet<String> writes = new LinkedHashSet<>();
			for (VariableRef variable : variables) {
				if (isRead(variable.access())) {
					reads.add(variable.key());
				}
				if (isWrite(variable.access())) {
					writes.add(variable.key());
				}
			}
			return new CommandAnalysis(
				functionId + ":" + line,
				functionId,
				line,
				normalizedCommand,
				effectiveCommand,
				rootCommand,
				execute,
				List.copyOf(calls),
				List.copyOf(variables),
				List.copyOf(reads),
				List.copyOf(writes),
				dedupeSelectors(selectors),
				conditionSummary
			);
		}

		private static List<SelectorRef> dedupeSelectors(List<SelectorRef> selectors) {
			Map<String, SelectorRef> deduped = new LinkedHashMap<>();
			for (SelectorRef selector : selectors) {
				deduped.putIfAbsent(selector.raw(), selector);
			}
			return List.copyOf(deduped.values());
		}

		private static boolean isRead(String access) {
			return "read".equals(access) || "query".equals(access);
		}

		private static boolean isWrite(String access) {
			return "write".equals(access) || "update".equals(access) || "declare".equals(access) || "remove".equals(access);
		}
	}
}
