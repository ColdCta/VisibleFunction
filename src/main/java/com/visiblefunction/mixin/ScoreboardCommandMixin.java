package com.visiblefunction.mixin;

import com.visiblefunction.VisibleFunction;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.arguments.OperationArgument;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.numbers.NumberFormat;
import net.minecraft.server.commands.ScoreboardCommand;
import net.minecraft.world.scores.DisplaySlot;
import net.minecraft.world.scores.Objective;
import net.minecraft.world.scores.ScoreHolder;
import net.minecraft.world.scores.criteria.ObjectiveCriteria;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.Map;

@Mixin(ScoreboardCommand.class)
abstract class ScoreboardCommandMixin {
	@Inject(
		method = "addObjective(Lnet/minecraft/commands/CommandSourceStack;Ljava/lang/String;Lnet/minecraft/world/scores/criteria/ObjectiveCriteria;Lnet/minecraft/network/chat/Component;)I",
		at = @At("RETURN")
	)
	private static void visiblefunction$recordObjectiveCreated(
		CommandSourceStack source,
		String name,
		ObjectiveCriteria criteria,
		Component displayName,
		CallbackInfoReturnable<Integer> callbackInfo
	) {
		Map<String, String> fields = fields();
		fields.put("category", "objectives");
		fields.put("operation", "add");
		fields.put("objective", name);
		fields.put("criteria", criteria.getName());
		fields.put("display_name", displayName.getString());
		VisibleFunction.recordScoreboardResult(source, "scoreboard_objective_created", name, "objective " + name + " created", fields);
	}

	@Inject(
		method = "removeObjective(Lnet/minecraft/commands/CommandSourceStack;Lnet/minecraft/world/scores/Objective;)I",
		at = @At("RETURN")
	)
	private static void visiblefunction$recordObjectiveRemoved(CommandSourceStack source, Objective objective, CallbackInfoReturnable<Integer> callbackInfo) {
		Map<String, String> fields = objectiveFields("remove", objective);
		VisibleFunction.recordScoreboardResult(source, "scoreboard_objective_removed", objective.getName(), "objective " + objective.getName() + " removed", fields);
	}

	@Inject(
		method = "setDisplayName(Lnet/minecraft/commands/CommandSourceStack;Lnet/minecraft/world/scores/Objective;Lnet/minecraft/network/chat/Component;)I",
		at = @At("RETURN")
	)
	private static void visiblefunction$recordObjectiveDisplayName(
		CommandSourceStack source,
		Objective objective,
		Component displayName,
		CallbackInfoReturnable<Integer> callbackInfo
	) {
		Map<String, String> fields = objectiveFields("modify displayname", objective);
		fields.put("display_name", displayName.getString());
		VisibleFunction.recordScoreboardResult(source, "scoreboard_objective_modified", objective.getName(), "objective " + objective.getName() + " modified", fields);
	}

	@Inject(
		method = "setDisplayAutoUpdate(Lnet/minecraft/commands/CommandSourceStack;Lnet/minecraft/world/scores/Objective;Z)I",
		at = @At("RETURN")
	)
	private static void visiblefunction$recordObjectiveDisplayAutoUpdate(
		CommandSourceStack source,
		Objective objective,
		boolean value,
		CallbackInfoReturnable<Integer> callbackInfo
	) {
		Map<String, String> fields = objectiveFields("modify displayautoupdate", objective);
		fields.put("display_auto_update", Boolean.toString(value));
		VisibleFunction.recordScoreboardResult(source, "scoreboard_objective_modified", objective.getName(), "objective " + objective.getName() + " modified", fields);
	}

	@Inject(
		method = "setObjectiveFormat(Lnet/minecraft/commands/CommandSourceStack;Lnet/minecraft/world/scores/Objective;Lnet/minecraft/network/chat/numbers/NumberFormat;)I",
		at = @At("RETURN")
	)
	private static void visiblefunction$recordObjectiveFormat(
		CommandSourceStack source,
		Objective objective,
		NumberFormat numberFormat,
		CallbackInfoReturnable<Integer> callbackInfo
	) {
		Map<String, String> fields = objectiveFields("modify numberformat", objective);
		fields.put("number_format", numberFormat == null ? "none" : numberFormat.toString());
		VisibleFunction.recordScoreboardResult(source, "scoreboard_objective_modified", objective.getName(), "objective " + objective.getName() + " modified", fields);
	}

	@Inject(
		method = "setRenderType(Lnet/minecraft/commands/CommandSourceStack;Lnet/minecraft/world/scores/Objective;Lnet/minecraft/world/scores/criteria/ObjectiveCriteria$RenderType;)I",
		at = @At("RETURN")
	)
	private static void visiblefunction$recordObjectiveRenderType(
		CommandSourceStack source,
		Objective objective,
		ObjectiveCriteria.RenderType renderType,
		CallbackInfoReturnable<Integer> callbackInfo
	) {
		Map<String, String> fields = objectiveFields("modify rendertype", objective);
		fields.put("render_type", renderType.getSerializedName());
		VisibleFunction.recordScoreboardResult(source, "scoreboard_objective_modified", objective.getName(), "objective " + objective.getName() + " modified", fields);
	}

	@Inject(
		method = "setScore(Lnet/minecraft/commands/CommandSourceStack;Ljava/util/Collection;Lnet/minecraft/world/scores/Objective;I)I",
		at = @At("RETURN")
	)
	private static void visiblefunction$recordScoreSet(
		CommandSourceStack source,
		Collection<ScoreHolder> targets,
		Objective objective,
		int value,
		CallbackInfoReturnable<Integer> callbackInfo
	) {
		recordScoreChange(source, "scoreboard_score_set", "set", targets, objective, "=", value, callbackInfo.getReturnValue());
	}

	@Inject(
		method = "addScore(Lnet/minecraft/commands/CommandSourceStack;Ljava/util/Collection;Lnet/minecraft/world/scores/Objective;I)I",
		at = @At("RETURN")
	)
	private static void visiblefunction$recordScoreAdded(
		CommandSourceStack source,
		Collection<ScoreHolder> targets,
		Objective objective,
		int value,
		CallbackInfoReturnable<Integer> callbackInfo
	) {
		recordScoreChange(source, "scoreboard_score_added", "add", targets, objective, "+=", value, callbackInfo.getReturnValue());
	}

	@Inject(
		method = "removeScore(Lnet/minecraft/commands/CommandSourceStack;Ljava/util/Collection;Lnet/minecraft/world/scores/Objective;I)I",
		at = @At("RETURN")
	)
	private static void visiblefunction$recordScoreRemoved(
		CommandSourceStack source,
		Collection<ScoreHolder> targets,
		Objective objective,
		int value,
		CallbackInfoReturnable<Integer> callbackInfo
	) {
		recordScoreChange(source, "scoreboard_score_removed", "remove", targets, objective, "-=", value, callbackInfo.getReturnValue());
	}

	@Inject(
		method = "resetScore(Lnet/minecraft/commands/CommandSourceStack;Ljava/util/Collection;Lnet/minecraft/world/scores/Objective;)I",
		at = @At("RETURN")
	)
	private static void visiblefunction$recordScoreReset(
		CommandSourceStack source,
		Collection<ScoreHolder> targets,
		Objective objective,
		CallbackInfoReturnable<Integer> callbackInfo
	) {
		Map<String, String> fields = scoreFields("reset", targets, objective, callbackInfo.getReturnValue());
		VisibleFunction.recordScoreboardResult(source, "scoreboard_score_reset", scoreSubject(targets, objective), scoreSubject(targets, objective) + " reset", fields);
	}

	@Inject(
		method = "resetScores(Lnet/minecraft/commands/CommandSourceStack;Ljava/util/Collection;)I",
		at = @At("RETURN")
	)
	private static void visiblefunction$recordScoresReset(
		CommandSourceStack source,
		Collection<ScoreHolder> targets,
		CallbackInfoReturnable<Integer> callbackInfo
	) {
		Map<String, String> fields = fields();
		fields.put("category", "players");
		fields.put("operation", "reset");
		fields.put("target", targetSummary(targets));
		fields.put("objective", "all");
		fields.put("matched_targets", Integer.toString(targets.size()));
		fields.put("affected_targets", Integer.toString(callbackInfo.getReturnValue()));
		fields.put("target_preview", targetPreview(targets));
		VisibleFunction.recordScoreboardResult(source, "scoreboard_score_reset", targetSummary(targets) + ":all", targetSummary(targets) + " scores reset", fields);
	}

	@Inject(
		method = "performOperation(Lnet/minecraft/commands/CommandSourceStack;Ljava/util/Collection;Lnet/minecraft/world/scores/Objective;Lnet/minecraft/commands/arguments/OperationArgument$Operation;Ljava/util/Collection;Lnet/minecraft/world/scores/Objective;)I",
		at = @At("RETURN")
	)
	private static void visiblefunction$recordScoreOperation(
		CommandSourceStack source,
		Collection<ScoreHolder> targets,
		Objective objective,
		OperationArgument.Operation operation,
		Collection<ScoreHolder> sourceTargets,
		Objective sourceObjective,
		CallbackInfoReturnable<Integer> callbackInfo
	) {
		Map<String, String> fields = scoreFields("operation", targets, objective, callbackInfo.getReturnValue());
		fields.put("operator", operation.toString());
		fields.put("source_target", targetSummary(sourceTargets));
		fields.put("source_objective", sourceObjective.getName());
		fields.put("source_target_preview", targetPreview(sourceTargets));
		VisibleFunction.recordScoreboardResult(source, "scoreboard_operation", scoreSubject(targets, objective), scoreSubject(targets, objective) + " operation", fields);
	}

	@Inject(
		method = "setDisplaySlot(Lnet/minecraft/commands/CommandSourceStack;Lnet/minecraft/world/scores/DisplaySlot;Lnet/minecraft/world/scores/Objective;)I",
		at = @At("RETURN")
	)
	private static void visiblefunction$recordDisplaySlotSet(
		CommandSourceStack source,
		DisplaySlot slot,
		Objective objective,
		CallbackInfoReturnable<Integer> callbackInfo
	) {
		Map<String, String> fields = fields();
		fields.put("category", "objectives");
		fields.put("operation", "setdisplay");
		fields.put("slot", slot.getSerializedName());
		fields.put("objective", objective.getName());
		VisibleFunction.recordScoreboardResult(source, "scoreboard_display_changed", "scoreboard", "display slot changed", fields);
	}

	@Inject(
		method = "clearDisplaySlot(Lnet/minecraft/commands/CommandSourceStack;Lnet/minecraft/world/scores/DisplaySlot;)I",
		at = @At("RETURN")
	)
	private static void visiblefunction$recordDisplaySlotCleared(
		CommandSourceStack source,
		DisplaySlot slot,
		CallbackInfoReturnable<Integer> callbackInfo
	) {
		Map<String, String> fields = fields();
		fields.put("category", "objectives");
		fields.put("operation", "setdisplay");
		fields.put("slot", slot.getSerializedName());
		fields.put("objective", "none");
		VisibleFunction.recordScoreboardResult(source, "scoreboard_display_changed", "scoreboard", "display slot cleared", fields);
	}

	private static void recordScoreChange(
		CommandSourceStack source,
		String action,
		String operation,
		Collection<ScoreHolder> targets,
		Objective objective,
		String operator,
		int value,
		int affectedTargets
	) {
		Map<String, String> fields = scoreFields(operation, targets, objective, affectedTargets);
		fields.put("operator", operator);
		fields.put("value", Integer.toString(value));
		String subject = scoreSubject(targets, objective);
		VisibleFunction.recordScoreboardResult(source, action, subject, subject + " " + operator + " " + value, fields);
	}

	private static Map<String, String> objectiveFields(String operation, Objective objective) {
		Map<String, String> fields = fields();
		fields.put("category", "objectives");
		fields.put("operation", operation);
		fields.put("objective", objective.getName());
		fields.put("criteria", objective.getCriteria().getName());
		return fields;
	}

	private static Map<String, String> scoreFields(String operation, Collection<ScoreHolder> targets, Objective objective, int affectedTargets) {
		Map<String, String> fields = fields();
		fields.put("category", "players");
		fields.put("operation", operation);
		fields.put("target", targetSummary(targets));
		fields.put("objective", objective.getName());
		fields.put("matched_targets", Integer.toString(targets.size()));
		fields.put("affected_targets", Integer.toString(affectedTargets));
		fields.put("target_preview", targetPreview(targets));
		return fields;
	}

	private static String scoreSubject(Collection<ScoreHolder> targets, Objective objective) {
		return targetSummary(targets) + ":" + objective.getName();
	}

	private static String targetSummary(Collection<ScoreHolder> targets) {
		if (targets.isEmpty()) {
			return "0 targets";
		}
		if (targets.size() == 1) {
			return targets.iterator().next().getScoreboardName();
		}
		return targets.size() + " targets";
	}

	private static String targetPreview(Collection<ScoreHolder> targets) {
		if (targets.isEmpty()) {
			return "[]";
		}

		StringBuilder preview = new StringBuilder("[");
		int index = 0;
		for (ScoreHolder target : targets) {
			if (index > 0) {
				preview.append(", ");
			}
			if (index >= 6) {
				preview.append("...");
				break;
			}
			preview.append(target.getScoreboardName());
			index++;
		}
		preview.append("]");
		return preview.toString();
	}

	private static Map<String, String> fields() {
		return new LinkedHashMap<>();
	}
}
