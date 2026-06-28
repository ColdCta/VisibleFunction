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
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

final class DatapackTriggerIndex {
	private static final String MODERN_ADVANCEMENT_PREFIX = "advancement/";
	private static final String LEGACY_ADVANCEMENT_PREFIX = "advancements/";
	private static final String MODERN_ENCHANTMENT_PREFIX = "enchantment/";
	private static final String LEGACY_ENCHANTMENT_PREFIX = "enchantments/";
	private static final int MAX_CONDITION_SUMMARY_LENGTH = 600;
	private static volatile TriggerSnapshot current = TriggerSnapshot.empty();

	private DatapackTriggerIndex() {
	}

	static void rebuild(MinecraftServer server) {
		rebuild(server.getResourceManager());
	}

	static void rebuild(ResourceManager resourceManager) {
		try {
			TriggerSnapshot snapshot = build(resourceManager, DatapackAnalysisIndex.functionIds());
			current = snapshot;
			VisibleFunction.LOGGER.info(
				"VisibleFunction indexed {} advancement and {} enchantment function triggers.",
				snapshot.advancementTriggerCount(),
				snapshot.enchantmentTriggerCount()
			);
		} catch (RuntimeException exception) {
			VisibleFunction.LOGGER.warn("VisibleFunction failed to rebuild datapack trigger index", exception);
			current = TriggerSnapshot.empty();
		}
	}

	static void clear() {
		current = TriggerSnapshot.empty();
	}

	static String json() {
		return current.json();
	}

	private static TriggerSnapshot build(ResourceManager resourceManager, Set<String> knownFunctions) {
		List<String> warnings = new ArrayList<>();
		Map<String, AdvancementInfo> advancements = new LinkedHashMap<>();
		Map<String, EnchantmentBuilder> enchantments = new LinkedHashMap<>();
		List<TriggerEdge> triggers = new ArrayList<>();

		int advancementResources = loadAdvancements(
			resourceManager,
			LEGACY_ADVANCEMENT_PREFIX,
			"advancements",
			knownFunctions,
			advancements,
			triggers,
			warnings
		);
		advancementResources += loadAdvancements(
			resourceManager,
			MODERN_ADVANCEMENT_PREFIX,
			"advancement",
			knownFunctions,
			advancements,
			triggers,
			warnings
		);

		int enchantmentResources = loadEnchantments(
			resourceManager,
			LEGACY_ENCHANTMENT_PREFIX,
			"enchantments",
			knownFunctions,
			enchantments,
			triggers,
			warnings
		);
		enchantmentResources += loadEnchantments(
			resourceManager,
			MODERN_ENCHANTMENT_PREFIX,
			"enchantment",
			knownFunctions,
			enchantments,
			triggers,
			warnings
		);

		triggers.sort(Comparator
			.comparing(TriggerEdge::sourceType)
			.thenComparing(TriggerEdge::sourceId)
			.thenComparing(TriggerEdge::jsonPath)
			.thenComparing(TriggerEdge::function));

		for (TriggerEdge trigger : triggers) {
			if (!trigger.functionExists()) {
				warnings.add(
					"Missing function target " + trigger.function()
						+ " referenced by " + trigger.sourceType() + " " + trigger.sourceId()
						+ " at " + trigger.jsonPath()
				);
			}
		}

		List<AdvancementInfo> advancementInfos = advancements.values().stream()
			.sorted(Comparator.comparing(AdvancementInfo::id))
			.toList();
		List<EnchantmentInfo> enchantmentInfos = enchantments.values().stream()
			.map(EnchantmentBuilder::toInfo)
			.sorted(Comparator.comparing(EnchantmentInfo::id))
			.toList();
		List<TriggeredFunction> functions = triggeredFunctions(triggers);
		int advancementTriggerCount = (int) triggers.stream().filter(trigger -> "advancement".equals(trigger.sourceType())).count();
		int enchantmentTriggerCount = triggers.size() - advancementTriggerCount;

		return new TriggerSnapshot(
			System.currentTimeMillis(),
			advancementResources,
			enchantmentResources,
			advancementTriggerCount,
			enchantmentTriggerCount,
			advancementInfos,
			enchantmentInfos,
			List.copyOf(triggers),
			functions,
			List.copyOf(new LinkedHashSet<>(warnings))
		);
	}

	private static int loadAdvancements(
		ResourceManager resourceManager,
		String resourcePrefix,
		String listPrefix,
		Set<String> knownFunctions,
		Map<String, AdvancementInfo> advancements,
		List<TriggerEdge> triggers,
		List<String> warnings
	) {
		Map<Identifier, Resource> resources = listJsonResources(resourceManager, listPrefix, resourcePrefix, "advancement", warnings);
		for (Map.Entry<Identifier, Resource> entry : sortedResources(resources)) {
			String advancementId = resourceId(entry.getKey(), resourcePrefix);
			if (advancementId == null) {
				warnings.add("Ignored invalid advancement resource " + entry.getKey());
				continue;
			}

			Resource resource = entry.getValue();
			try (BufferedReader reader = resource.openAsReader()) {
				JsonObject root = JsonParser.parseReader(reader).getAsJsonObject();
				String function = stringAt(root, "rewards", "function");
				if (function.isBlank()) {
					continue;
				}

				if (Identifier.tryParse(function) == null) {
					warnings.add("Invalid advancement reward function " + function + " in " + advancementId);
					continue;
				}

				List<CriterionInfo> criteria = advancementCriteria(root);
				String parent = primitiveString(root.get("parent"));
				String conditionSummary = criteria.stream()
					.map(CriterionInfo::trigger)
					.filter(value -> !value.isBlank())
					.distinct()
					.sorted()
					.reduce((left, right) -> left + ", " + right)
					.orElse("");
				String triggerId = triggerId("advancement", advancementId, "$.rewards.function", function);
				TriggerEdge trigger = new TriggerEdge(
					triggerId,
					"advancement",
					advancementId,
					"reward",
					function,
					resource.sourcePackId(),
					"none",
					"$.rewards.function",
					conditionSummary,
					"none",
					"none",
					knownFunctions.contains(function),
					DatapackTickFunctionIndex.isTickFunction(function)
				);
				triggers.add(trigger);

				AdvancementInfo previous = advancements.put(
					advancementId,
					new AdvancementInfo(
						advancementId,
						resource.sourcePackId(),
						parent,
						criteria,
						function,
						triggerId
					)
				);
				if (previous != null) {
					warnings.add("Advancement " + advancementId + " was defined in both legacy and modern paths; using " + resource.sourcePackId());
				}
			} catch (IOException | RuntimeException exception) {
				warnings.add("Failed to parse advancement " + advancementId + " from " + resource.sourcePackId() + ": " + exception.getMessage());
			}
		}
		return resources.size();
	}

	private static int loadEnchantments(
		ResourceManager resourceManager,
		String resourcePrefix,
		String listPrefix,
		Set<String> knownFunctions,
		Map<String, EnchantmentBuilder> enchantments,
		List<TriggerEdge> triggers,
		List<String> warnings
	) {
		Map<Identifier, Resource> resources = listJsonResources(resourceManager, listPrefix, resourcePrefix, "enchantment", warnings);
		for (Map.Entry<Identifier, Resource> entry : sortedResources(resources)) {
			String enchantmentId = resourceId(entry.getKey(), resourcePrefix);
			if (enchantmentId == null) {
				warnings.add("Ignored invalid enchantment resource " + entry.getKey());
				continue;
			}

			Resource resource = entry.getValue();
			try (BufferedReader reader = resource.openAsReader()) {
				JsonObject root = JsonParser.parseReader(reader).getAsJsonObject();
				JsonObject effects = object(root.get("effects"));
				if (effects == null) {
					continue;
				}

				EnchantmentBuilder builder = new EnchantmentBuilder(
					enchantmentId,
					resource.sourcePackId(),
					jsonSummary(root.get("supported_items")),
					jsonSummary(root.get("primary_items")),
					stringList(root.get("slots"))
				);
				for (Map.Entry<String, JsonElement> effect : effects.entrySet()) {
					String component = effect.getKey();
					String path = "$.effects[" + quotePath(component) + "]";
					findRunFunctions(
						effect.getValue(),
						path,
						component,
						TriggerContext.empty(),
						builder,
						knownFunctions,
						triggers,
						warnings
					);
				}

				if (builder.triggerIds.isEmpty()) {
					continue;
				}

				EnchantmentBuilder previous = enchantments.put(enchantmentId, builder);
				if (previous != null) {
					warnings.add("Enchantment " + enchantmentId + " was defined in both legacy and modern paths; using " + resource.sourcePackId());
				}
			} catch (IOException | RuntimeException exception) {
				warnings.add("Failed to parse enchantment " + enchantmentId + " from " + resource.sourcePackId() + ": " + exception.getMessage());
			}
		}
		return resources.size();
	}

	private static void findRunFunctions(
		JsonElement element,
		String path,
		String component,
		TriggerContext inheritedContext,
		EnchantmentBuilder enchantment,
		Set<String> knownFunctions,
		List<TriggerEdge> triggers,
		List<String> warnings
	) {
		if (element == null || element.isJsonNull()) {
			return;
		}

		if (element.isJsonArray()) {
			JsonArray array = element.getAsJsonArray();
			for (int index = 0; index < array.size(); index++) {
				findRunFunctions(
					array.get(index),
					path + "[" + index + "]",
					component,
					inheritedContext,
					enchantment,
					knownFunctions,
					triggers,
					warnings
				);
			}
			return;
		}

		if (!element.isJsonObject()) {
			return;
		}

		JsonObject object = element.getAsJsonObject();
		TriggerContext context = inheritedContext.with(object);
		String type = primitiveString(object.get("type"));
		if ("minecraft:run_function".equals(type) || "run_function".equals(type)) {
			String function = primitiveString(object.get("function"));
			if (Identifier.tryParse(function) == null) {
				warnings.add("Invalid enchantment run_function target " + function + " in " + enchantment.id + " at " + path);
			} else {
				String triggerId = triggerId("enchantment", enchantment.id, path, function);
				TriggerEdge trigger = new TriggerEdge(
					triggerId,
					"enchantment",
					enchantment.id,
					"run_function",
					function,
					enchantment.pack,
					component,
					path,
					context.requirements(),
					context.affected(),
					context.enchanted(),
					knownFunctions.contains(function),
					DatapackTickFunctionIndex.isTickFunction(function)
				);
				triggers.add(trigger);
				enchantment.functions.add(function);
				enchantment.triggerIds.add(triggerId);
			}
		}

		for (Map.Entry<String, JsonElement> child : object.entrySet()) {
			findRunFunctions(
				child.getValue(),
				path + "[" + quotePath(child.getKey()) + "]",
				component,
				context,
				enchantment,
				knownFunctions,
				triggers,
				warnings
			);
		}
	}

	private static Map<Identifier, Resource> listJsonResources(
		ResourceManager resourceManager,
		String listPrefix,
		String resourcePrefix,
		String type,
		List<String> warnings
	) {
		try {
			return resourceManager.listResources(
				listPrefix,
				id -> id.getPath().startsWith(resourcePrefix) && id.getPath().endsWith(".json")
			);
		} catch (RuntimeException exception) {
			warnings.add("Failed to list " + type + " resources under " + resourcePrefix + ": " + exception.getMessage());
			return Map.of();
		}
	}

	private static List<Map.Entry<Identifier, Resource>> sortedResources(Map<Identifier, Resource> resources) {
		return resources.entrySet().stream().sorted(Map.Entry.comparingByKey()).toList();
	}

	private static String resourceId(Identifier resourceId, String resourcePrefix) {
		String path = resourceId.getPath();
		if (!path.startsWith(resourcePrefix) || !path.endsWith(".json")) {
			return null;
		}

		String valuePath = path.substring(resourcePrefix.length(), path.length() - ".json".length());
		Identifier id = Identifier.tryBuild(resourceId.getNamespace(), valuePath);
		return id == null ? null : id.toString();
	}

	private static List<CriterionInfo> advancementCriteria(JsonObject root) {
		JsonObject criteria = object(root.get("criteria"));
		if (criteria == null) {
			return List.of();
		}

		List<CriterionInfo> result = new ArrayList<>();
		criteria.entrySet().stream()
			.sorted(Map.Entry.comparingByKey())
			.forEach(entry -> {
				JsonObject criterion = object(entry.getValue());
				result.add(new CriterionInfo(
					entry.getKey(),
					criterion == null ? "" : primitiveString(criterion.get("trigger"))
				));
			});
		return List.copyOf(result);
	}

	private static List<TriggeredFunction> triggeredFunctions(List<TriggerEdge> triggers) {
		Map<String, TriggeredFunctionBuilder> functions = new LinkedHashMap<>();
		for (TriggerEdge trigger : triggers) {
			TriggeredFunctionBuilder builder = functions.computeIfAbsent(
				trigger.function(),
				ignored -> new TriggeredFunctionBuilder(trigger.function(), trigger.functionExists(), trigger.tickFunction())
			);
			builder.triggerIds.add(trigger.id());
			if ("advancement".equals(trigger.sourceType())) {
				builder.advancements.add(trigger.sourceId());
			} else if ("enchantment".equals(trigger.sourceType())) {
				builder.enchantments.add(trigger.sourceId());
			}
		}

		return functions.values().stream()
			.map(TriggeredFunctionBuilder::toInfo)
			.sorted(Comparator.comparing(TriggeredFunction::id))
			.toList();
	}

	private static JsonObject object(JsonElement element) {
		return element != null && element.isJsonObject() ? element.getAsJsonObject() : null;
	}

	private static String stringAt(JsonObject object, String parent, String child) {
		JsonObject nested = object(object.get(parent));
		return nested == null ? "" : primitiveString(nested.get(child));
	}

	private static String primitiveString(JsonElement element) {
		if (element == null || element.isJsonNull() || !element.isJsonPrimitive()) {
			return "";
		}
		try {
			return element.getAsString();
		} catch (RuntimeException ignored) {
			return "";
		}
	}

	private static String jsonSummary(JsonElement element) {
		if (element == null || element.isJsonNull()) {
			return "";
		}
		String value = element.isJsonPrimitive() ? primitiveString(element) : element.toString();
		if (value.length() <= MAX_CONDITION_SUMMARY_LENGTH) {
			return value;
		}
		return value.substring(0, MAX_CONDITION_SUMMARY_LENGTH - 3) + "...";
	}

	private static List<String> stringList(JsonElement element) {
		if (element == null || element.isJsonNull()) {
			return List.of();
		}
		if (element.isJsonPrimitive()) {
			String value = primitiveString(element);
			return value.isBlank() ? List.of() : List.of(value);
		}
		if (!element.isJsonArray()) {
			return List.of();
		}

		List<String> result = new ArrayList<>();
		for (JsonElement value : element.getAsJsonArray()) {
			String text = primitiveString(value);
			if (!text.isBlank()) {
				result.add(text);
			}
		}
		return List.copyOf(result);
	}

	private static String triggerId(String sourceType, String sourceId, String path, String function) {
		return sourceType + ":" + sourceId + ":" + Integer.toUnsignedString((path + "\0" + function).hashCode(), 16);
	}

	private static String quotePath(String value) {
		return "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
	}

	private static String json(TriggerSnapshot snapshot) {
		JsonObject root = new JsonObject();
		JsonObject analysis = new JsonObject();
		analysis.addProperty("generatedAtMillis", snapshot.generatedAtMillis());
		analysis.addProperty("advancementResourceCount", snapshot.advancementResourceCount());
		analysis.addProperty("enchantmentResourceCount", snapshot.enchantmentResourceCount());
		analysis.addProperty("advancementSourceCount", snapshot.advancements().size());
		analysis.addProperty("enchantmentSourceCount", snapshot.enchantments().size());
		analysis.addProperty("advancementTriggerCount", snapshot.advancementTriggerCount());
		analysis.addProperty("enchantmentTriggerCount", snapshot.enchantmentTriggerCount());
		analysis.addProperty("triggerCount", snapshot.triggers().size());
		analysis.addProperty("functionCount", snapshot.functions().size());
		analysis.add("warnings", strings(snapshot.warnings()));
		root.add("analysis", analysis);

		JsonArray advancements = new JsonArray();
		for (AdvancementInfo advancement : snapshot.advancements()) {
			JsonObject object = new JsonObject();
			object.addProperty("id", advancement.id());
			object.addProperty("pack", advancement.pack());
			object.addProperty("parent", advancement.parent().isBlank() ? "none" : advancement.parent());
			object.addProperty("function", advancement.function());
			object.addProperty("triggerId", advancement.triggerId());
			JsonArray criteria = new JsonArray();
			for (CriterionInfo criterion : advancement.criteria()) {
				JsonObject criterionObject = new JsonObject();
				criterionObject.addProperty("name", criterion.name());
				criterionObject.addProperty("trigger", criterion.trigger());
				criteria.add(criterionObject);
			}
			object.add("criteria", criteria);
			advancements.add(object);
		}
		root.add("advancements", advancements);

		JsonArray enchantments = new JsonArray();
		for (EnchantmentInfo enchantment : snapshot.enchantments()) {
			JsonObject object = new JsonObject();
			object.addProperty("id", enchantment.id());
			object.addProperty("pack", enchantment.pack());
			object.addProperty("supportedItems", enchantment.supportedItems());
			object.addProperty("primaryItems", enchantment.primaryItems());
			object.add("slots", strings(enchantment.slots()));
			object.add("functions", strings(enchantment.functions()));
			object.add("triggerIds", strings(enchantment.triggerIds()));
			object.addProperty("triggerCount", enchantment.triggerIds().size());
			enchantments.add(object);
		}
		root.add("enchantments", enchantments);

		JsonArray triggers = new JsonArray();
		for (TriggerEdge trigger : snapshot.triggers()) {
			JsonObject object = new JsonObject();
			object.addProperty("id", trigger.id());
			object.addProperty("sourceType", trigger.sourceType());
			object.addProperty("sourceId", trigger.sourceId());
			object.addProperty("kind", trigger.kind());
			object.addProperty("function", trigger.function());
			object.addProperty("pack", trigger.pack());
			object.addProperty("effectComponent", trigger.effectComponent());
			object.addProperty("jsonPath", trigger.jsonPath());
			object.addProperty("conditionSummary", trigger.conditionSummary());
			object.addProperty("affected", trigger.affected());
			object.addProperty("enchanted", trigger.enchanted());
			object.addProperty("functionExists", trigger.functionExists());
			object.addProperty("tickFunction", trigger.tickFunction());
			triggers.add(object);
		}
		root.add("triggers", triggers);

		JsonArray functions = new JsonArray();
		for (TriggeredFunction function : snapshot.functions()) {
			JsonObject object = new JsonObject();
			object.addProperty("id", function.id());
			object.addProperty("functionExists", function.functionExists());
			object.addProperty("tickFunction", function.tickFunction());
			object.addProperty("triggerCount", function.triggerIds().size());
			object.add("triggerIds", strings(function.triggerIds()));
			object.add("advancements", strings(function.advancements()));
			object.add("enchantments", strings(function.enchantments()));
			functions.add(object);
		}
		root.add("functions", functions);
		return root.toString();
	}

	private static JsonArray strings(List<String> values) {
		JsonArray array = new JsonArray();
		for (String value : values) {
			array.add(value);
		}
		return array;
	}

	private record CriterionInfo(String name, String trigger) {
	}

	private record AdvancementInfo(
		String id,
		String pack,
		String parent,
		List<CriterionInfo> criteria,
		String function,
		String triggerId
	) {
	}

	private record EnchantmentInfo(
		String id,
		String pack,
		String supportedItems,
		String primaryItems,
		List<String> slots,
		List<String> functions,
		List<String> triggerIds
	) {
	}

	private record TriggerEdge(
		String id,
		String sourceType,
		String sourceId,
		String kind,
		String function,
		String pack,
		String effectComponent,
		String jsonPath,
		String conditionSummary,
		String affected,
		String enchanted,
		boolean functionExists,
		boolean tickFunction
	) {
	}

	private record TriggeredFunction(
		String id,
		boolean functionExists,
		boolean tickFunction,
		List<String> triggerIds,
		List<String> advancements,
		List<String> enchantments
	) {
	}

	private record TriggerContext(String requirements, String affected, String enchanted) {
		private static TriggerContext empty() {
			return new TriggerContext("", "none", "none");
		}

		private TriggerContext with(JsonObject object) {
			String nextRequirements = requirements;
			String nextAffected = affected;
			String nextEnchanted = enchanted;
			if (object.has("requirements")) {
				nextRequirements = jsonSummary(object.get("requirements"));
			}
			String affectedValue = primitiveString(object.get("affected"));
			if (!affectedValue.isBlank()) {
				nextAffected = affectedValue;
			}
			String enchantedValue = primitiveString(object.get("enchanted"));
			if (!enchantedValue.isBlank()) {
				nextEnchanted = enchantedValue;
			}
			return new TriggerContext(nextRequirements, nextAffected, nextEnchanted);
		}
	}

	private static final class EnchantmentBuilder {
		private final String id;
		private final String pack;
		private final String supportedItems;
		private final String primaryItems;
		private final List<String> slots;
		private final Set<String> functions = new LinkedHashSet<>();
		private final List<String> triggerIds = new ArrayList<>();

		private EnchantmentBuilder(String id, String pack, String supportedItems, String primaryItems, List<String> slots) {
			this.id = id;
			this.pack = pack;
			this.supportedItems = supportedItems;
			this.primaryItems = primaryItems;
			this.slots = slots;
		}

		private EnchantmentInfo toInfo() {
			return new EnchantmentInfo(
				id,
				pack,
				supportedItems,
				primaryItems,
				slots,
				functions.stream().sorted().toList(),
				List.copyOf(triggerIds)
			);
		}
	}

	private static final class TriggeredFunctionBuilder {
		private final String id;
		private final boolean functionExists;
		private final boolean tickFunction;
		private final List<String> triggerIds = new ArrayList<>();
		private final Set<String> advancements = new LinkedHashSet<>();
		private final Set<String> enchantments = new LinkedHashSet<>();

		private TriggeredFunctionBuilder(String id, boolean functionExists, boolean tickFunction) {
			this.id = id;
			this.functionExists = functionExists;
			this.tickFunction = tickFunction;
		}

		private TriggeredFunction toInfo() {
			return new TriggeredFunction(
				id,
				functionExists,
				tickFunction,
				List.copyOf(triggerIds),
				advancements.stream().sorted().toList(),
				enchantments.stream().sorted().toList()
			);
		}
	}

	private static final class TriggerSnapshot {
		private static final TriggerSnapshot EMPTY = new TriggerSnapshot(
			0,
			0,
			0,
			0,
			0,
			List.of(),
			List.of(),
			List.of(),
			List.of(),
			List.of()
		);

		private final long generatedAtMillis;
		private final int advancementResourceCount;
		private final int enchantmentResourceCount;
		private final int advancementTriggerCount;
		private final int enchantmentTriggerCount;
		private final List<AdvancementInfo> advancements;
		private final List<EnchantmentInfo> enchantments;
		private final List<TriggerEdge> triggers;
		private final List<TriggeredFunction> functions;
		private final List<String> warnings;
		private volatile String cachedJson;

		private TriggerSnapshot(
			long generatedAtMillis,
			int advancementResourceCount,
			int enchantmentResourceCount,
			int advancementTriggerCount,
			int enchantmentTriggerCount,
			List<AdvancementInfo> advancements,
			List<EnchantmentInfo> enchantments,
			List<TriggerEdge> triggers,
			List<TriggeredFunction> functions,
			List<String> warnings
		) {
			this.generatedAtMillis = generatedAtMillis;
			this.advancementResourceCount = advancementResourceCount;
			this.enchantmentResourceCount = enchantmentResourceCount;
			this.advancementTriggerCount = advancementTriggerCount;
			this.enchantmentTriggerCount = enchantmentTriggerCount;
			this.advancements = advancements;
			this.enchantments = enchantments;
			this.triggers = triggers;
			this.functions = functions;
			this.warnings = warnings;
		}

		private static TriggerSnapshot empty() {
			return EMPTY;
		}

		private long generatedAtMillis() {
			return generatedAtMillis;
		}

		private int advancementResourceCount() {
			return advancementResourceCount;
		}

		private int enchantmentResourceCount() {
			return enchantmentResourceCount;
		}

		private int advancementTriggerCount() {
			return advancementTriggerCount;
		}

		private int enchantmentTriggerCount() {
			return enchantmentTriggerCount;
		}

		private List<AdvancementInfo> advancements() {
			return advancements;
		}

		private List<EnchantmentInfo> enchantments() {
			return enchantments;
		}

		private List<TriggerEdge> triggers() {
			return triggers;
		}

		private List<TriggeredFunction> functions() {
			return functions;
		}

		private List<String> warnings() {
			return warnings;
		}

		private String json() {
			String cached = cachedJson;
			if (cached != null) {
				return cached;
			}
			cached = DatapackTriggerIndex.json(this);
			cachedJson = cached;
			return cached;
		}
	}
}
