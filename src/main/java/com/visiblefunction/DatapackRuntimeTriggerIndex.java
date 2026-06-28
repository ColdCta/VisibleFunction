package com.visiblefunction;

import net.minecraft.advancements.AdvancementHolder;
import net.minecraft.advancements.AdvancementRewards;
import net.minecraft.core.Registry;
import net.minecraft.core.component.DataComponentMap;
import net.minecraft.core.component.TypedDataComponent;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.Identifier;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.item.enchantment.ConditionalEffect;
import net.minecraft.world.item.enchantment.Enchantment;
import net.minecraft.world.item.enchantment.TargetedConditionalEffect;
import net.minecraft.world.item.enchantment.effects.AllOf;
import net.minecraft.world.item.enchantment.effects.RunFunction;

import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.Map;
import java.util.Set;

final class DatapackRuntimeTriggerIndex {
	private static volatile RuntimeSnapshot current = RuntimeSnapshot.empty();

	private DatapackRuntimeTriggerIndex() {
	}

	static void rebuild(MinecraftServer server) {
		try {
			IdentityHashMap<AdvancementRewards, TriggerSource> advancements = new IdentityHashMap<>();
			for (AdvancementHolder holder : server.getAdvancements().getAllAdvancements()) {
				AdvancementRewards rewards = holder.value().rewards();
				rewards.function().ifPresent(function -> advancements.put(
					rewards,
					new TriggerSource("advancement", holder.id(), function.getId())
				));
			}

			IdentityHashMap<RunFunction, TriggerSource> enchantments = new IdentityHashMap<>();
			Registry<Enchantment> registry = server.registryAccess().lookupOrThrow(Registries.ENCHANTMENT);
			for (Map.Entry<net.minecraft.resources.ResourceKey<Enchantment>, Enchantment> entry : registry.entrySet()) {
				Identifier enchantmentId = entry.getKey().identifier();
				Set<Object> visited = Collections.newSetFromMap(new IdentityHashMap<>());
				indexEffects(entry.getValue().effects(), enchantmentId, enchantments, visited);
			}

			current = new RuntimeSnapshot(advancements, enchantments);
			VisibleFunction.LOGGER.info(
				"VisibleFunction mapped {} advancement rewards and {} enchantment run_function instances.",
				advancements.size(),
				enchantments.size()
			);
		} catch (RuntimeException exception) {
			VisibleFunction.LOGGER.warn("VisibleFunction failed to rebuild runtime datapack trigger index", exception);
			current = RuntimeSnapshot.empty();
		}
	}

	static void clear() {
		current = RuntimeSnapshot.empty();
	}

	static TriggerSource advancement(AdvancementRewards rewards) {
		return current.advancements().get(rewards);
	}

	static TriggerSource enchantment(RunFunction effect) {
		return current.enchantments().get(effect);
	}

	private static void indexEffects(
		Object value,
		Identifier enchantmentId,
		IdentityHashMap<RunFunction, TriggerSource> out,
		Set<Object> visited
	) {
		if (value == null || !visited.add(value)) {
			return;
		}

		if (value instanceof RunFunction runFunction) {
			TriggerSource previous = out.put(
				runFunction,
				new TriggerSource("enchantment", enchantmentId, runFunction.function())
			);
			if (previous != null && !previous.sourceId().equals(enchantmentId)) {
				VisibleFunction.LOGGER.warn(
					"Enchantment run_function instance {} is shared by {} and {}; using {}",
					runFunction.function(),
					previous.sourceId(),
					enchantmentId,
					enchantmentId
				);
			}
			return;
		}

		if (value instanceof ConditionalEffect<?> conditionalEffect) {
			indexEffects(conditionalEffect.effect(), enchantmentId, out, visited);
			return;
		}

		if (value instanceof TargetedConditionalEffect<?> targetedEffect) {
			indexEffects(targetedEffect.effect(), enchantmentId, out, visited);
			return;
		}

		if (value instanceof AllOf.EntityEffects allOf) {
			indexEffects(allOf.effects(), enchantmentId, out, visited);
			return;
		}

		if (value instanceof TypedDataComponent<?> component) {
			indexEffects(component.value(), enchantmentId, out, visited);
			return;
		}

		if (value instanceof DataComponentMap components) {
			for (TypedDataComponent<?> component : components) {
				indexEffects(component, enchantmentId, out, visited);
			}
			return;
		}

		if (value instanceof Iterable<?> values) {
			for (Object nested : values) {
				indexEffects(nested, enchantmentId, out, visited);
			}
		}
	}

	record TriggerSource(String type, Identifier sourceId, Identifier functionId) {
	}

	private record RuntimeSnapshot(
		IdentityHashMap<AdvancementRewards, TriggerSource> advancements,
		IdentityHashMap<RunFunction, TriggerSource> enchantments
	) {
		private static RuntimeSnapshot empty() {
			return new RuntimeSnapshot(new IdentityHashMap<>(), new IdentityHashMap<>());
		}
	}
}
