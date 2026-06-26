package com.visiblefunction;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import net.minecraft.resources.Identifier;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.packs.resources.Resource;
import net.minecraft.server.packs.resources.ResourceManager;

import java.io.BufferedReader;
import java.io.IOException;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class DatapackAnalysisIndex {
	private static final String MODERN_FUNCTION_PREFIX = "function/";
	private static final String LEGACY_FUNCTION_PREFIX = "functions/";
	private static final String MODERN_TAG_PREFIX = "tags/function/";
	private static final String LEGACY_TAG_PREFIX = "tags/functions/";
	private static final Pattern SELECTOR_SCORES = Pattern.compile("scores=\\{([^}]*)}");
	private static final Pattern SELECTOR_TAG = Pattern.compile("(?:^|[\\[,])tag=!?([^,\\]}]+)");
	private static volatile AnalysisSnapshot current = AnalysisSnapshot.empty();

	private DatapackAnalysisIndex() {
	}

	static void rebuild(MinecraftServer server) {
		rebuild(server.getResourceManager());
	}

	static void rebuild(ResourceManager resourceManager) {
		try {
			AnalysisSnapshot snapshot = build(resourceManager);
			current = snapshot;
			VisibleFunction.LOGGER.info(
				"VisibleFunction analyzed {} datapack functions, {} function edges, and {} variables.",
				snapshot.functions().size(),
				snapshot.edges().size(),
				snapshot.variables().size()
			);
		} catch (RuntimeException exception) {
			VisibleFunction.LOGGER.warn("VisibleFunction failed to rebuild datapack analysis index", exception);
			current = AnalysisSnapshot.empty();
		}
	}

	static void clear() {
		current = AnalysisSnapshot.empty();
	}

	static String json() {
		return current.json();
	}

	private static AnalysisSnapshot build(ResourceManager resourceManager) {
		List<String> warnings = new ArrayList<>();
		Map<String, List<String>> tags = resolvedTags(resourceManager, warnings);
		Map<String, FunctionBuilder> functions = loadFunctions(resourceManager, warnings);
		Map<String, VariableBuilder> variables = new LinkedHashMap<>();
		List<EdgeInfo> edges = new ArrayList<>();

		for (FunctionBuilder function : functions.values()) {
			parseFunction(function, tags, functions, variables, edges, warnings);
		}

		for (EdgeInfo edge : edges) {
			FunctionBuilder source = functions.get(edge.from());
			if (source != null && isConcreteFunction(edge.to())) {
				source.calls.add(edge.to());
			}

			FunctionBuilder target = functions.get(edge.to());
			if (target != null) {
				target.calledBy.add(edge.from());
			} else if (isConcreteFunction(edge.to())) {
				warnings.add("Missing function target " + edge.to() + " referenced by " + edge.from() + " at line " + edge.line());
			}
		}

		List<FunctionInfo> functionInfos = functions.values().stream()
			.map(FunctionBuilder::toInfo)
			.sorted(Comparator.comparing(FunctionInfo::id))
			.toList();
		List<EdgeInfo> edgeInfos = edges.stream()
			.sorted(Comparator
				.comparing(EdgeInfo::from)
				.thenComparingInt(EdgeInfo::line)
				.thenComparing(EdgeInfo::to))
			.toList();
		List<VariableInfo> variableInfos = variables.values().stream()
			.map(VariableBuilder::toInfo)
			.sorted(Comparator.comparing(VariableInfo::key))
			.toList();
		Map<String, List<String>> sortedTags = new LinkedHashMap<>();
		tags.entrySet().stream()
			.sorted(Map.Entry.comparingByKey())
			.forEach(entry -> sortedTags.put(entry.getKey(), entry.getValue().stream().sorted().toList()));

		return new AnalysisSnapshot(System.currentTimeMillis(), functionInfos, edgeInfos, variableInfos, sortedTags, List.copyOf(warnings));
	}

	private static Map<String, FunctionBuilder> loadFunctions(ResourceManager resourceManager, List<String> warnings) {
		Map<String, FunctionBuilder> functions = new LinkedHashMap<>();
		loadFunctions(resourceManager, "function", MODERN_FUNCTION_PREFIX, functions, warnings);
		loadFunctions(resourceManager, "functions", LEGACY_FUNCTION_PREFIX, functions, warnings);
		return functions;
	}

	private static void loadFunctions(
		ResourceManager resourceManager,
		String listPrefix,
		String resourcePrefix,
		Map<String, FunctionBuilder> functions,
		List<String> warnings
	) {
		Map<Identifier, Resource> resources;
		try {
			resources = resourceManager.listResources(listPrefix, id -> id.getPath().startsWith(resourcePrefix) && id.getPath().endsWith(".mcfunction"));
		} catch (RuntimeException exception) {
			warnings.add("Failed to list function resources under " + resourcePrefix + ": " + exception.getMessage());
			return;
		}

		resources.entrySet().stream()
			.sorted(Map.Entry.comparingByKey())
			.forEach(entry -> {
				Identifier functionId = functionId(entry.getKey(), resourcePrefix);
				if (functionId == null) {
					warnings.add("Ignored invalid function resource " + entry.getKey());
					return;
				}

				FunctionBuilder builder = readFunction(functionId.toString(), entry.getValue(), warnings);
				FunctionBuilder previous = functions.put(builder.id, builder);
				if (previous != null) {
					warnings.add("Function " + builder.id + " was defined more than once; using " + builder.pack);
				}
			});
	}

	private static FunctionBuilder readFunction(String functionId, Resource resource, List<String> warnings) {
		FunctionBuilder builder = new FunctionBuilder(functionId, resource.sourcePackId());
		try (BufferedReader reader = resource.openAsReader()) {
			String line;
			int lineNumber = 0;
			while ((line = reader.readLine()) != null) {
				lineNumber++;
				builder.lineCount = lineNumber;
				String stripped = line.strip();
				if (stripped.isBlank() || stripped.startsWith("#")) {
					continue;
				}

				builder.commandCount++;
				builder.commands.add(new FunctionCommand(lineNumber, stripped));
				if (stripped.startsWith("$")) {
					warnings.add("Skipped macro command in " + functionId + " at line " + lineNumber + ": " + stripped);
				}
			}
		} catch (IOException exception) {
			warnings.add("Failed to read function " + functionId + " from " + resource.sourcePackId() + ": " + exception.getMessage());
		}
		return builder;
	}

	private static Identifier functionId(Identifier resourceId, String resourcePrefix) {
		String path = resourceId.getPath();
		if (!path.startsWith(resourcePrefix) || !path.endsWith(".mcfunction")) {
			return null;
		}

		String functionPath = path.substring(resourcePrefix.length(), path.length() - ".mcfunction".length());
		return Identifier.tryBuild(resourceId.getNamespace(), functionPath);
	}

	private static Map<String, List<String>> resolvedTags(ResourceManager resourceManager, List<String> warnings) {
		Map<String, List<TagEntry>> rawTags = new LinkedHashMap<>();
		loadTagStacks(resourceManager, "tags/function", MODERN_TAG_PREFIX, rawTags, warnings);
		loadTagStacks(resourceManager, "tags/functions", LEGACY_TAG_PREFIX, rawTags, warnings);

		Map<String, List<String>> resolved = new LinkedHashMap<>();
		for (String tagId : rawTags.keySet()) {
			List<String> values = resolveTag(tagId, rawTags, resolved, new ArrayDeque<>(), warnings);
			resolved.put(tagId, values);
		}
		return resolved;
	}

	private static void loadTagStacks(
		ResourceManager resourceManager,
		String listPrefix,
		String resourcePrefix,
		Map<String, List<TagEntry>> tags,
		List<String> warnings
	) {
		Map<Identifier, List<Resource>> stacks;
		try {
			stacks = resourceManager.listResourceStacks(listPrefix, id -> id.getPath().startsWith(resourcePrefix) && id.getPath().endsWith(".json"));
		} catch (RuntimeException exception) {
			warnings.add("Failed to list function tag resources under " + resourcePrefix + ": " + exception.getMessage());
			return;
		}

		stacks.entrySet().stream()
			.sorted(Map.Entry.comparingByKey())
			.forEach(entry -> {
				String tagId = tagId(entry.getKey(), resourcePrefix);
				if (tagId == null) {
					warnings.add("Ignored invalid function tag resource " + entry.getKey());
					return;
				}

				List<TagEntry> values = tags.computeIfAbsent(tagId, ignored -> new ArrayList<>());
				for (Resource resource : entry.getValue()) {
					readTag(tagId, resource, values, warnings);
				}
			});
	}

	private static String tagId(Identifier resourceId, String resourcePrefix) {
		String path = resourceId.getPath();
		if (!path.startsWith(resourcePrefix) || !path.endsWith(".json")) {
			return null;
		}

		String tagPath = path.substring(resourcePrefix.length(), path.length() - ".json".length());
		Identifier id = Identifier.tryBuild(resourceId.getNamespace(), tagPath);
		return id == null ? null : id.toString();
	}

	private static void readTag(String tagId, Resource resource, List<TagEntry> values, List<String> warnings) {
		try (BufferedReader reader = resource.openAsReader()) {
			JsonObject object = JsonParser.parseReader(reader).getAsJsonObject();
			if (object.has("replace") && object.get("replace").getAsBoolean()) {
				values.clear();
			}

			JsonArray entries = object.has("values") && object.get("values").isJsonArray()
				? object.getAsJsonArray("values")
				: new JsonArray();
			for (JsonElement value : entries) {
				TagEntry entry = tagEntry(value);
				if (entry != null) {
					values.add(entry);
				}
			}
		} catch (IOException | RuntimeException exception) {
			warnings.add("Failed to parse function tag " + tagId + " from " + resource.sourcePackId() + ": " + exception.getMessage());
		}
	}

	private static TagEntry tagEntry(JsonElement value) {
		if (value.isJsonPrimitive()) {
			return new TagEntry(value.getAsString(), true);
		}

		if (!value.isJsonObject()) {
			return null;
		}

		JsonObject object = value.getAsJsonObject();
		if (!object.has("id")) {
			return null;
		}

		boolean required = !object.has("required") || object.get("required").getAsBoolean();
		return new TagEntry(object.get("id").getAsString(), required);
	}

	private static List<String> resolveTag(
		String tagId,
		Map<String, List<TagEntry>> rawTags,
		Map<String, List<String>> resolvedTags,
		ArrayDeque<String> stack,
		List<String> warnings
	) {
		List<String> cached = resolvedTags.get(tagId);
		if (cached != null) {
			return cached;
		}

		if (stack.contains(tagId)) {
			warnings.add("Detected recursive function tag reference: " + String.join(" -> ", stack) + " -> " + tagId);
			return List.of();
		}

		stack.addLast(tagId);
		LinkedHashSet<String> functions = new LinkedHashSet<>();
		for (TagEntry entry : rawTags.getOrDefault(tagId, List.of())) {
			String id = entry.id();
			if (id.startsWith("#")) {
				Identifier nested = Identifier.tryParse(id.substring(1));
				if (nested == null) {
					if (entry.required()) {
						warnings.add("Invalid nested function tag " + id + " in " + tagId);
					}
					continue;
				}
				functions.addAll(resolveTag(nested.toString(), rawTags, resolvedTags, stack, warnings));
				continue;
			}

			Identifier function = Identifier.tryParse(id);
			if (function != null) {
				functions.add(function.toString());
			} else if (entry.required()) {
				warnings.add("Invalid function id " + id + " in tag " + tagId);
			}
		}

		stack.removeLast();
		List<String> values = List.copyOf(functions);
		resolvedTags.put(tagId, values);
		return values;
	}

	private static void parseFunction(
		FunctionBuilder function,
		Map<String, List<String>> tags,
		Map<String, FunctionBuilder> functions,
		Map<String, VariableBuilder> variables,
		List<EdgeInfo> edges,
		List<String> warnings
	) {
		for (FunctionCommand command : function.commands) {
			if (command.command().startsWith("$")) {
				continue;
			}

			String normalized = CommandText.normalize(command.command());
			function.currentLine = command.line();
			for (FunctionCall call : functionCalls(normalized, warnings, function.id, command.line())) {
				if (call.tag()) {
					List<String> tagFunctions = tags.get(call.id());
					if (tagFunctions == null || tagFunctions.isEmpty()) {
						edges.add(new EdgeInfo(function.id, "#" + call.id(), "tag", call.id(), command.line(), normalized));
						warnings.add("Function " + function.id + " references empty or missing tag #" + call.id() + " at line " + command.line());
						continue;
					}

					for (String target : tagFunctions) {
						edges.add(new EdgeInfo(function.id, target, "tag", call.id(), command.line(), normalized));
					}
					continue;
				}

				edges.add(new EdgeInfo(function.id, call.id(), call.kind(), "none", command.line(), normalized));
			}

			parseVariables(normalized, function, variables);
		}

		for (String variable : function.variables) {
			if (!variables.containsKey(variable)) {
				warnings.add("Function " + function.id + " referenced variable " + variable + " but no variable entry was built.");
			}
		}
	}

	private static List<FunctionCall> functionCalls(String command, List<String> warnings, String functionId, int line) {
		List<FunctionCall> calls = new ArrayList<>();
		String effective = CommandText.effectiveCommand(command);
		List<String> tokens = CommandText.tokenize(effective);
		if (tokens.isEmpty()) {
			return calls;
		}

		String root = lower(tokens, 0);
		if ("function".equals(root) && tokens.size() >= 2) {
			addFunctionCall(calls, tokens.get(1), "direct", warnings, functionId, line);
		} else if ("return".equals(root) && tokens.size() >= 4 && "run".equals(lower(tokens, 1)) && "function".equals(lower(tokens, 2))) {
			addFunctionCall(calls, tokens.get(3), "direct", warnings, functionId, line);
		} else if ("schedule".equals(root) && tokens.size() >= 3 && "function".equals(lower(tokens, 1))) {
			addFunctionCall(calls, tokens.get(2), "scheduled", warnings, functionId, line);
		}

		return calls;
	}

	private static void addFunctionCall(
		List<FunctionCall> calls,
		String rawTarget,
		String kind,
		List<String> warnings,
		String functionId,
		int line
	) {
		boolean tag = rawTarget.startsWith("#");
		String rawId = tag ? rawTarget.substring(1) : rawTarget;
		Identifier id = Identifier.tryParse(rawId);
		if (id == null) {
			warnings.add("Invalid function reference " + rawTarget + " in " + functionId + " at line " + line);
			return;
		}
		calls.add(new FunctionCall(id.toString(), tag, tag ? "tag" : kind));
	}

	private static void parseVariables(String command, FunctionBuilder function, Map<String, VariableBuilder> variables) {
		parseSelectorVariables(command, function, variables);
		List<String> rootTokens = CommandText.tokenize(command);
		parseExecuteVariables(rootTokens, command, function, variables);

		String nestedExecute = CommandText.executeRunCommand(command);
		if (nestedExecute != null && !nestedExecute.equals(command)) {
			parseVariables(nestedExecute, function, variables);
			return;
		}

		if (rootTokens.size() >= 3 && "return".equals(lower(rootTokens, 0)) && "run".equals(lower(rootTokens, 1))) {
			parseVariables(CommandText.normalize(join(rootTokens, 2, rootTokens.size())), function, variables);
			return;
		}

		parseNonExecuteVariables(rootTokens, command, function, variables);
	}

	private static void parseExecuteVariables(
		List<String> tokens,
		String command,
		FunctionBuilder function,
		Map<String, VariableBuilder> variables
	) {
		if (tokens.isEmpty() || !"execute".equals(lower(tokens, 0))) {
			return;
		}

		for (int index = 0; index < tokens.size(); index++) {
			String token = lower(tokens, index);
			if ("store".equals(token) && isResultOrSuccess(tokens, index + 1)) {
				String targetKind = lower(tokens, index + 2);
				if ("score".equals(targetKind) && index + 4 < tokens.size()) {
					addScore(function, variables, tokens.get(index + 3), tokens.get(index + 4), "write", command);
				} else if ("storage".equals(targetKind) && index + 4 < tokens.size()) {
					addStorage(function, variables, tokens.get(index + 3), tokens.get(index + 4), "write", command);
				}
			}

			if ("score".equals(token) && index + 2 < tokens.size() && !isResultOrSuccess(tokens, index - 1)) {
				addScore(function, variables, tokens.get(index + 1), tokens.get(index + 2), "read", command);
				if (index + 5 < tokens.size() && isScoreComparison(tokens.get(index + 3))) {
					addScore(function, variables, tokens.get(index + 4), tokens.get(index + 5), "read", command);
				}
			}
		}
	}

	private static void parseNonExecuteVariables(
		List<String> tokens,
		String command,
		FunctionBuilder function,
		Map<String, VariableBuilder> variables
	) {
		if (tokens.isEmpty()) {
			return;
		}

		switch (lower(tokens, 0)) {
			case "scoreboard" -> parseScoreboard(tokens, command, function, variables);
			case "data" -> parseData(tokens, command, function, variables);
			case "tag" -> parseTag(tokens, command, function, variables);
			case "bossbar" -> parseBossbar(tokens, command, function, variables);
			default -> {
			}
		}
	}

	private static void parseScoreboard(
		List<String> tokens,
		String command,
		FunctionBuilder function,
		Map<String, VariableBuilder> variables
	) {
		if (tokens.size() < 3) {
			return;
		}

		String area = lower(tokens, 1);
		String action = lower(tokens, 2);
		if ("objectives".equals(area)) {
			if (("add".equals(action) || "remove".equals(action) || "modify".equals(action)) && tokens.size() >= 4) {
				String access = "add".equals(action) ? "declare" : "remove".equals(action) ? "remove" : "update";
				addObjective(function, variables, tokens.get(3), access, command);
			} else if ("setdisplay".equals(action) && tokens.size() >= 5) {
				addObjective(function, variables, tokens.get(4), "update", command);
			}
			return;
		}

		if (!"players".equals(area)) {
			return;
		}

		switch (action) {
			case "set" -> {
				if (tokens.size() >= 5) {
					addScore(function, variables, tokens.get(3), tokens.get(4), "write", command);
				}
			}
			case "add", "remove", "enable" -> {
				if (tokens.size() >= 5) {
					addScore(function, variables, tokens.get(3), tokens.get(4), "update", command);
				}
			}
			case "get" -> {
				if (tokens.size() >= 5) {
					addScore(function, variables, tokens.get(3), tokens.get(4), "read", command);
				}
			}
			case "reset" -> {
				if (tokens.size() >= 5) {
					addScore(function, variables, tokens.get(3), tokens.get(4), "remove", command);
				} else if (tokens.size() >= 4) {
					addVariable(function, variables, "score:" + tokens.get(3) + ":*", "score", tokens.get(3) + ":*", "remove", command);
				}
			}
			case "operation" -> {
				if (tokens.size() >= 8) {
					addScore(function, variables, tokens.get(3), tokens.get(4), "update", command);
					addScore(function, variables, tokens.get(6), tokens.get(7), "read", command);
				}
			}
			case "list" -> {
				if (tokens.size() >= 4) {
					addVariable(function, variables, "score:" + tokens.get(3) + ":*", "score", tokens.get(3) + ":*", "query", command);
				}
			}
			default -> {
			}
		}
	}

	private static void parseData(
		List<String> tokens,
		String command,
		FunctionBuilder function,
		Map<String, VariableBuilder> variables
	) {
		if (tokens.size() < 4) {
			return;
		}

		String action = lower(tokens, 1);
		String targetKind = lower(tokens, 2);
		if (!"storage".equals(targetKind)) {
			return;
		}

		String storage = tokens.get(3);
		switch (action) {
			case "get" -> addStorage(function, variables, storage, tokenOr(tokens, 4, "root"), "query", command);
			case "merge" -> addStorage(function, variables, storage, "root", "update", command);
			case "modify" -> {
				addStorage(function, variables, storage, tokenOr(tokens, 4, "root"), "update", command);
				for (int index = 5; index + 2 < tokens.size(); index++) {
					if ("from".equals(lower(tokens, index)) && "storage".equals(lower(tokens, index + 1))) {
						addStorage(function, variables, tokens.get(index + 2), tokenOr(tokens, index + 3, "root"), "read", command);
					}
				}
			}
			case "remove" -> addStorage(function, variables, storage, tokenOr(tokens, 4, "root"), "remove", command);
			default -> {
			}
		}
	}

	private static void parseTag(
		List<String> tokens,
		String command,
		FunctionBuilder function,
		Map<String, VariableBuilder> variables
	) {
		if (tokens.size() < 3) {
			return;
		}

		String action = lower(tokens, 2);
		if ("add".equals(action) && tokens.size() >= 4) {
			addTag(function, variables, tokens.get(3), "write", command);
		} else if ("remove".equals(action) && tokens.size() >= 4) {
			addTag(function, variables, tokens.get(3), "remove", command);
		} else if ("list".equals(action)) {
			addVariable(function, variables, "tag:*", "tag", "*", "query", command);
		}
	}

	private static void parseBossbar(
		List<String> tokens,
		String command,
		FunctionBuilder function,
		Map<String, VariableBuilder> variables
	) {
		if (tokens.size() < 2) {
			return;
		}

		String action = lower(tokens, 1);
		switch (action) {
			case "add" -> {
				if (tokens.size() >= 3) {
					addBossbar(function, variables, tokens.get(2), "declare", command);
				}
			}
			case "remove" -> {
				if (tokens.size() >= 3) {
					addBossbar(function, variables, tokens.get(2), "remove", command);
				}
			}
			case "set" -> {
				if (tokens.size() >= 3) {
					addBossbar(function, variables, tokens.get(2), "update", command);
				}
			}
			case "get" -> {
				if (tokens.size() >= 3) {
					addBossbar(function, variables, tokens.get(2), "query", command);
				}
			}
			case "list" -> addVariable(function, variables, "bossbar:*", "bossbar", "*", "query", command);
			default -> {
			}
		}
	}

	private static void parseSelectorVariables(
		String command,
		FunctionBuilder function,
		Map<String, VariableBuilder> variables
	) {
		Matcher scoreMatcher = SELECTOR_SCORES.matcher(command);
		while (scoreMatcher.find()) {
			for (String part : scoreMatcher.group(1).split(",")) {
				int separator = part.indexOf('=');
				if (separator > 0) {
					addObjective(function, variables, part.substring(0, separator).strip(), "read", command);
				}
			}
		}

		Matcher tagMatcher = SELECTOR_TAG.matcher(command);
		while (tagMatcher.find()) {
			String tag = tagMatcher.group(1).strip();
			if (!tag.isBlank()) {
				addTag(function, variables, tag, "read", command);
			}
		}
	}

	private static void addScore(
		FunctionBuilder function,
		Map<String, VariableBuilder> variables,
		String holder,
		String objective,
		String access,
		String command
	) {
		addObjective(function, variables, objective, "read".equals(access) ? "read" : "update", command);
		addVariable(function, variables, "score:" + holder + ":" + objective, "score", holder + ":" + objective, access, command);
	}

	private static void addObjective(
		FunctionBuilder function,
		Map<String, VariableBuilder> variables,
		String objective,
		String access,
		String command
	) {
		if (objective == null || objective.isBlank()) {
			return;
		}
		addVariable(function, variables, "scoreboard:" + objective, "scoreboard", objective, access, command);
	}

	private static void addStorage(
		FunctionBuilder function,
		Map<String, VariableBuilder> variables,
		String storage,
		String path,
		String access,
		String command
	) {
		if (storage == null || storage.isBlank()) {
			return;
		}

		String storagePath = path == null || path.isBlank() ? "root" : path;
		String suffix = "root".equals(storagePath) ? "" : " " + storagePath;
		addVariable(function, variables, "storage:" + storage + suffix, "storage", storage + suffix, access, command);
	}

	private static void addTag(
		FunctionBuilder function,
		Map<String, VariableBuilder> variables,
		String tag,
		String access,
		String command
	) {
		if (tag == null || tag.isBlank()) {
			return;
		}
		addVariable(function, variables, "tag:" + tag, "tag", tag, access, command);
	}

	private static void addBossbar(
		FunctionBuilder function,
		Map<String, VariableBuilder> variables,
		String bossbar,
		String access,
		String command
	) {
		if (bossbar == null || bossbar.isBlank()) {
			return;
		}
		addVariable(function, variables, "bossbar:" + bossbar, "bossbar", bossbar, access, command);
	}

	private static void addVariable(
		FunctionBuilder function,
		Map<String, VariableBuilder> variables,
		String key,
		String kind,
		String name,
		String access,
		String command
	) {
		function.variables.add(key);
		VariableBuilder variable = variables.computeIfAbsent(key, ignored -> new VariableBuilder(key, kind, name));
		variable.add(new VariableOccurrence(function.id, currentLine(function, command), access, command));
	}

	private static int currentLine(FunctionBuilder function, String command) {
		if (function.currentLine > 0) {
			return function.currentLine;
		}

		for (FunctionCommand functionCommand : function.commands) {
			if (CommandText.normalize(functionCommand.command()).equals(command)) {
				return functionCommand.line();
			}
		}
		return 0;
	}

	private static boolean isConcreteFunction(String id) {
		return !id.startsWith("#");
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

	private static String json(AnalysisSnapshot snapshot) {
		StringBuilder json = new StringBuilder(4096);
		json.append('{');
		json.append("\"analysis\":{");
		property(json, "generatedAtMillis", snapshot.generatedAtMillis()).append(',');
		property(json, "functionCount", snapshot.functions().size()).append(',');
		property(json, "edgeCount", snapshot.edges().size()).append(',');
		property(json, "variableCount", snapshot.variables().size()).append(',');
		json.append("\"warnings\":");
		stringArray(json, snapshot.warnings());
		json.append("},");
		json.append("\"functions\":");
		functionArray(json, snapshot.functions()).append(',');
		json.append("\"edges\":");
		edgeArray(json, snapshot.edges()).append(',');
		json.append("\"variables\":");
		variableArray(json, snapshot.variables()).append(',');
		json.append("\"tags\":");
		tagsObject(json, snapshot.tags());
		json.append('}');
		return json.toString();
	}

	private static StringBuilder functionArray(StringBuilder json, List<FunctionInfo> functions) {
		json.append('[');
		for (int index = 0; index < functions.size(); index++) {
			if (index > 0) {
				json.append(',');
			}
			FunctionInfo function = functions.get(index);
			json.append('{');
			property(json, "id", function.id()).append(',');
			property(json, "pack", function.pack()).append(',');
			property(json, "lineCount", function.lineCount()).append(',');
			property(json, "commandCount", function.commandCount()).append(',');
			property(json, "tickRoot", function.tickRoot()).append(',');
			property(json, "tickFunction", function.tickFunction()).append(',');
			json.append("\"calls\":");
			stringArray(json, function.calls()).append(',');
			json.append("\"calledBy\":");
			stringArray(json, function.calledBy()).append(',');
			json.append("\"variables\":");
			stringArray(json, function.variables());
			json.append('}');
		}
		json.append(']');
		return json;
	}

	private static StringBuilder edgeArray(StringBuilder json, List<EdgeInfo> edges) {
		json.append('[');
		for (int index = 0; index < edges.size(); index++) {
			if (index > 0) {
				json.append(',');
			}
			EdgeInfo edge = edges.get(index);
			json.append('{');
			property(json, "from", edge.from()).append(',');
			property(json, "to", edge.to()).append(',');
			property(json, "kind", edge.kind()).append(',');
			property(json, "viaTag", edge.viaTag()).append(',');
			property(json, "line", edge.line()).append(',');
			property(json, "command", edge.command());
			json.append('}');
		}
		json.append(']');
		return json;
	}

	private static StringBuilder variableArray(StringBuilder json, List<VariableInfo> variables) {
		json.append('[');
		for (int index = 0; index < variables.size(); index++) {
			if (index > 0) {
				json.append(',');
			}
			VariableInfo variable = variables.get(index);
			json.append('{');
			property(json, "key", variable.key()).append(',');
			property(json, "kind", variable.kind()).append(',');
			property(json, "name", variable.name()).append(',');
			property(json, "reads", variable.reads()).append(',');
			property(json, "writes", variable.writes()).append(',');
			json.append("\"occurrences\":[");
			for (int occurrenceIndex = 0; occurrenceIndex < variable.occurrences().size(); occurrenceIndex++) {
				if (occurrenceIndex > 0) {
					json.append(',');
				}
				VariableOccurrence occurrence = variable.occurrences().get(occurrenceIndex);
				json.append('{');
				property(json, "function", occurrence.function()).append(',');
				property(json, "line", occurrence.line()).append(',');
				property(json, "access", occurrence.access()).append(',');
				property(json, "command", occurrence.command());
				json.append('}');
			}
			json.append("]}");
		}
		json.append(']');
		return json;
	}

	private static StringBuilder tagsObject(StringBuilder json, Map<String, List<String>> tags) {
		json.append('{');
		int index = 0;
		for (Map.Entry<String, List<String>> entry : tags.entrySet()) {
			if (index++ > 0) {
				json.append(',');
			}
			quoted(json, entry.getKey()).append(':');
			stringArray(json, entry.getValue());
		}
		json.append('}');
		return json;
	}

	private static StringBuilder stringArray(StringBuilder json, Collection<String> values) {
		json.append('[');
		int index = 0;
		for (String value : values) {
			if (index++ > 0) {
				json.append(',');
			}
			quoted(json, value);
		}
		json.append(']');
		return json;
	}

	private static StringBuilder property(StringBuilder json, String name, String value) {
		quoted(json, name).append(':');
		quoted(json, value);
		return json;
	}

	private static StringBuilder property(StringBuilder json, String name, long value) {
		quoted(json, name).append(':').append(value);
		return json;
	}

	private static StringBuilder property(StringBuilder json, String name, int value) {
		quoted(json, name).append(':').append(value);
		return json;
	}

	private static StringBuilder property(StringBuilder json, String name, boolean value) {
		quoted(json, name).append(':').append(value);
		return json;
	}

	private static StringBuilder quoted(StringBuilder json, String value) {
		json.append('"');
		for (int index = 0; index < value.length(); index++) {
			char character = value.charAt(index);
			switch (character) {
				case '"' -> json.append("\\\"");
				case '\\' -> json.append("\\\\");
				case '\b' -> json.append("\\b");
				case '\f' -> json.append("\\f");
				case '\n' -> json.append("\\n");
				case '\r' -> json.append("\\r");
				case '\t' -> json.append("\\t");
				default -> {
					if (character < 0x20) {
						json.append(String.format("\\u%04x", (int) character));
					} else {
						json.append(character);
					}
				}
			}
		}
		json.append('"');
		return json;
	}

	private record FunctionCommand(int line, String command) {
	}

	private record TagEntry(String id, boolean required) {
	}

	private record FunctionCall(String id, boolean tag, String kind) {
	}

	private record EdgeInfo(String from, String to, String kind, String viaTag, int line, String command) {
	}

	private record VariableOccurrence(String function, int line, String access, String command) {
	}

	private record FunctionInfo(
		String id,
		String pack,
		int lineCount,
		int commandCount,
		boolean tickRoot,
		boolean tickFunction,
		List<String> calls,
		List<String> calledBy,
		List<String> variables
	) {
	}

	private record VariableInfo(
		String key,
		String kind,
		String name,
		int reads,
		int writes,
		List<VariableOccurrence> occurrences
	) {
	}

	private static final class FunctionBuilder {
		private final String id;
		private final String pack;
		private final List<FunctionCommand> commands = new ArrayList<>();
		private final Set<String> calls = new LinkedHashSet<>();
		private final Set<String> calledBy = new LinkedHashSet<>();
		private final Set<String> variables = new LinkedHashSet<>();
		private int lineCount;
		private int commandCount;
		private int currentLine;

		private FunctionBuilder(String id, String pack) {
			this.id = id;
			this.pack = pack;
		}

		private FunctionInfo toInfo() {
			Identifier identifier = Identifier.tryParse(id);
			boolean tickRoot = identifier != null && DatapackTickFunctionIndex.isTickRoot(identifier);
			return new FunctionInfo(
				id,
				pack,
				lineCount,
				commandCount,
				tickRoot,
				DatapackTickFunctionIndex.isTickFunction(id),
				calls.stream().sorted().toList(),
				calledBy.stream().sorted().toList(),
				variables.stream().sorted().toList()
			);
		}
	}

	private static final class VariableBuilder {
		private final String key;
		private final String kind;
		private final String name;
		private final List<VariableOccurrence> occurrences = new ArrayList<>();
		private int reads;
		private int writes;

		private VariableBuilder(String key, String kind, String name) {
			this.key = key;
			this.kind = kind;
			this.name = name;
		}

		private void add(VariableOccurrence occurrence) {
			occurrences.add(occurrence);
			if (isRead(occurrence.access())) {
				reads++;
			}
			if (isWrite(occurrence.access())) {
				writes++;
			}
		}

		private VariableInfo toInfo() {
			return new VariableInfo(key, kind, name, reads, writes, List.copyOf(occurrences));
		}

		private static boolean isRead(String access) {
			return "read".equals(access) || "query".equals(access);
		}

		private static boolean isWrite(String access) {
			return "write".equals(access) || "update".equals(access) || "declare".equals(access) || "remove".equals(access);
		}
	}

	private static final class AnalysisSnapshot {
		private final long generatedAtMillis;
		private final List<FunctionInfo> functions;
		private final List<EdgeInfo> edges;
		private final List<VariableInfo> variables;
		private final Map<String, List<String>> tags;
		private final List<String> warnings;
		private volatile String json;

		private AnalysisSnapshot(
			long generatedAtMillis,
			List<FunctionInfo> functions,
			List<EdgeInfo> edges,
			List<VariableInfo> variables,
			Map<String, List<String>> tags,
			List<String> warnings
		) {
			this.generatedAtMillis = generatedAtMillis;
			this.functions = functions;
			this.edges = edges;
			this.variables = variables;
			this.tags = tags;
			this.warnings = warnings;
		}

		private static AnalysisSnapshot empty() {
			return new AnalysisSnapshot(0, List.of(), List.of(), List.of(), Map.of(), List.of());
		}

		private long generatedAtMillis() {
			return generatedAtMillis;
		}

		private List<FunctionInfo> functions() {
			return functions;
		}

		private List<EdgeInfo> edges() {
			return edges;
		}

		private List<VariableInfo> variables() {
			return variables;
		}

		private Map<String, List<String>> tags() {
			return tags;
		}

		private List<String> warnings() {
			return warnings;
		}

		private String json() {
			String cached = json;
			if (cached != null) {
				return cached;
			}

			cached = DatapackAnalysisIndex.json(this);
			json = cached;
			return cached;
		}
	}
}
