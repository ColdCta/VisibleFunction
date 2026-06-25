package com.visiblefunction;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.functions.CommandFunction;
import net.minecraft.resources.Identifier;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.packs.resources.Resource;
import net.minecraft.server.packs.resources.ResourceManager;

import java.io.BufferedReader;
import java.io.IOException;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

final class DatapackTickFunctionIndex {
	private static final Identifier TICK_TAG = Identifier.fromNamespaceAndPath("minecraft", "tick");
	private static volatile TickIndex current = TickIndex.empty();

	private DatapackTickFunctionIndex() {
	}

	static void rebuild(MinecraftServer server) {
		rebuild(server, server.getResourceManager());
	}

	static void rebuild(MinecraftServer server, ResourceManager resourceManager) {
		try {
			TickIndex index = build(server, resourceManager);
			current = index;
			VisibleFunction.LOGGER.info(
				"VisibleFunction indexed {} tick roots and {} tick-chain functions from datapacks.",
				index.tickRoots().size(),
				index.tickFunctions().size()
			);
		} catch (RuntimeException exception) {
			VisibleFunction.LOGGER.warn("VisibleFunction failed to rebuild datapack tick function index", exception);
			current = TickIndex.empty();
		}
	}

	static void clear() {
		current = TickIndex.empty();
	}

	static boolean isTickFunction(Identifier functionId) {
		return functionId != null && current.tickFunctions().contains(functionId.toString());
	}

	static boolean isTickFunction(String functionId) {
		return functionId != null && current.tickFunctions().contains(functionId);
	}

	static boolean isTickRoot(Identifier functionId) {
		return functionId != null && current.tickRoots().contains(functionId.toString());
	}

	private static TickIndex build(MinecraftServer server, ResourceManager resourceManager) {
		Set<String> roots = new LinkedHashSet<>();
		resolveTag(resourceManager, TICK_TAG, roots, new HashSet<>());
		addRuntimeTickTagRoots(server, roots);

		Set<String> tickFunctions = new LinkedHashSet<>(roots);
		ArrayDeque<Identifier> queue = new ArrayDeque<>();
		for (String root : roots) {
			Identifier id = Identifier.tryParse(root);
			if (id != null) {
				queue.add(id);
			}
		}

		Set<String> visited = new HashSet<>();
		while (!queue.isEmpty()) {
			Identifier functionId = queue.removeFirst();
			if (!visited.add(functionId.toString())) {
				continue;
			}

			for (FunctionReference reference : functionReferences(resourceManager, functionId)) {
				if (reference.tag()) {
					Set<String> taggedFunctions = new LinkedHashSet<>();
					resolveTag(resourceManager, reference.id(), taggedFunctions, new HashSet<>());
					for (String taggedFunction : taggedFunctions) {
						if (tickFunctions.add(taggedFunction)) {
							Identifier taggedId = Identifier.tryParse(taggedFunction);
							if (taggedId != null) {
								queue.add(taggedId);
							}
						}
					}
					continue;
				}

				if (tickFunctions.add(reference.id().toString())) {
					queue.add(reference.id());
				}
			}
		}

		return new TickIndex(Set.copyOf(roots), Set.copyOf(tickFunctions));
	}

	private static void addRuntimeTickTagRoots(MinecraftServer server, Set<String> roots) {
		try {
			List<CommandFunction<CommandSourceStack>> functions = server.getFunctions().getTag(TICK_TAG);
			for (CommandFunction<CommandSourceStack> function : functions) {
				roots.add(function.id().toString());
			}
		} catch (RuntimeException exception) {
			VisibleFunction.LOGGER.debug("VisibleFunction could not read runtime minecraft:tick function tag", exception);
		}
	}

	private static void resolveTag(
		ResourceManager resourceManager,
		Identifier tagId,
		Set<String> out,
		Set<String> visitingTags
	) {
		if (!visitingTags.add(tagId.toString())) {
			return;
		}

		try {
			for (Resource resource : tagResources(resourceManager, tagId)) {
				try (BufferedReader reader = resource.openAsReader()) {
					JsonObject object = JsonParser.parseReader(reader).getAsJsonObject();
					if (object.has("replace") && object.get("replace").getAsBoolean()) {
						out.clear();
					}
					JsonArray values = object.has("values") && object.get("values").isJsonArray()
						? object.getAsJsonArray("values")
						: new JsonArray();

					for (JsonElement value : values) {
						TagEntry entry = tagEntry(value);
						if (entry == null) {
							continue;
						}

						if (entry.id().startsWith("#")) {
							Identifier nestedTag = Identifier.tryParse(entry.id().substring(1));
							if (nestedTag != null) {
								resolveTag(resourceManager, nestedTag, out, visitingTags);
							} else if (entry.required()) {
								VisibleFunction.LOGGER.warn("VisibleFunction ignored invalid function tag reference {}", entry.id());
							}
							continue;
						}

						Identifier functionId = Identifier.tryParse(entry.id());
						if (functionId != null) {
							out.add(functionId.toString());
						} else if (entry.required()) {
							VisibleFunction.LOGGER.warn("VisibleFunction ignored invalid function id {}", entry.id());
						}
					}
				} catch (IOException | IllegalStateException exception) {
					VisibleFunction.LOGGER.warn("VisibleFunction failed to parse function tag {} from {}", tagId, resource.sourcePackId(), exception);
				}
			}
		} finally {
			visitingTags.remove(tagId.toString());
		}
	}

	private static List<Resource> tagResources(ResourceManager resourceManager, Identifier tagId) {
		List<Resource> resources = new ArrayList<>();
		resources.addAll(resourceStack(resourceManager, tagResourceId(tagId, "tags/function/")));
		resources.addAll(resourceStack(resourceManager, tagResourceId(tagId, "tags/functions/")));
		return resources;
	}

	private static Identifier tagResourceId(Identifier tagId, String prefix) {
		return Identifier.fromNamespaceAndPath(tagId.getNamespace(), prefix + tagId.getPath() + ".json");
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

	private static List<FunctionReference> functionReferences(ResourceManager resourceManager, Identifier functionId) {
		List<Resource> resources = functionResources(resourceManager, functionId);
		if (resources.isEmpty()) {
			return List.of();
		}

		Resource resource = resources.getLast();
		List<FunctionReference> references = new ArrayList<>();
		try (BufferedReader reader = resource.openAsReader()) {
			String line;
			while ((line = reader.readLine()) != null) {
				FunctionReference reference = functionReference(line);
				if (reference != null) {
					references.add(reference);
				}
			}
		} catch (IOException exception) {
			VisibleFunction.LOGGER.warn("VisibleFunction failed to read function {} from {}", functionId, resource.sourcePackId(), exception);
		}
		return references;
	}

	private static List<Resource> functionResources(ResourceManager resourceManager, Identifier functionId) {
		List<Resource> resources = new ArrayList<>();
		resources.addAll(resourceStack(resourceManager, functionResourceId(functionId, "function/")));
		resources.addAll(resourceStack(resourceManager, functionResourceId(functionId, "functions/")));
		return resources;
	}

	private static Identifier functionResourceId(Identifier functionId, String prefix) {
		return Identifier.fromNamespaceAndPath(functionId.getNamespace(), prefix + functionId.getPath() + ".mcfunction");
	}

	private static List<Resource> resourceStack(ResourceManager resourceManager, Identifier resourceId) {
		try {
			return resourceManager.getResourceStack(resourceId);
		} catch (RuntimeException exception) {
			VisibleFunction.LOGGER.debug("VisibleFunction could not read resource stack {}", resourceId, exception);
			return Collections.emptyList();
		}
	}

	private static FunctionReference functionReference(String rawLine) {
		String line = rawLine.strip();
		if (line.isBlank() || line.startsWith("#") || line.startsWith("$")) {
			return null;
		}

		String effective = CommandText.effectiveCommand(line);
		List<String> tokens = CommandText.tokenize(effective);
		if (tokens.size() < 2 || !"function".equals(tokens.getFirst().toLowerCase(Locale.ROOT))) {
			return null;
		}

		String target = tokens.get(1);
		boolean tag = target.startsWith("#");
		Identifier id = Identifier.tryParse(tag ? target.substring(1) : target);
		return id == null ? null : new FunctionReference(id, tag);
	}

	private record TagEntry(String id, boolean required) {
	}

	private record FunctionReference(Identifier id, boolean tag) {
	}

	private record TickIndex(Set<String> tickRoots, Set<String> tickFunctions) {
		private static TickIndex empty() {
			return new TickIndex(Set.of(), Set.of());
		}
	}
}
