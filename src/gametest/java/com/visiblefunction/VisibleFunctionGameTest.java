package com.visiblefunction;

import net.fabricmc.fabric.api.gametest.v1.GameTest;
import net.minecraft.core.BlockPos;
import net.minecraft.gametest.framework.GameTestHelper;
import net.minecraft.world.phys.Vec3;

public final class VisibleFunctionGameTest {
	@GameTest
	public void commandMixinsProduceRecordedCommandAndEventData(GameTestHelper helper) {
		VisibleFunctionRecordingManager manager = VisibleFunctionRecordingManager.instance();
		manager.stopIfActive();
		if (!manager.start().success()) {
			throw new AssertionError("Could not start VisibleFunction recording");
		}

		var server = helper.getLevel().getServer();
		BlockPos position = helper.absolutePos(new BlockPos(1, 2, 1));
		Vec3 commandPosition = Vec3.atCenterOf(position);
		var source = server.createCommandSourceStack()
			.withLevel(helper.getLevel())
			.withPosition(commandPosition);

		server.getCommands().performPrefixedCommand(
			source,
			"summon minecraft:zombie " + position.getX() + " " + position.getY() + " " + position.getZ()
		);
		server.getCommands().performPrefixedCommand(source, "scoreboard objectives add vf_gametest dummy");
		server.getCommands().performPrefixedCommand(source, "scoreboard players add #test vf_gametest 1");
		server.getCommands().performPrefixedCommand(source, "data merge storage visiblefunction:gametest {value:1}");

		helper.runAfterDelay(5, () -> {
			try {
				if (!manager.stop().success()) {
					throw new AssertionError("Could not stop VisibleFunction recording");
				}
				String recording = manager.latestRecordingJson();
				if (!recording.contains("\"type\":\"COMMAND\"")) {
					throw new AssertionError("Command mixin did not emit a command record");
				}
				if (!recording.contains("\"type\":\"EVENT\"")) {
					throw new AssertionError("Command result mixins did not emit an event record");
				}
			} finally {
				server.getCommands().performPrefixedCommand(source, "scoreboard objectives remove vf_gametest");
				server.getCommands().performPrefixedCommand(source, "data remove storage visiblefunction:gametest value");
			}
			helper.succeed();
		});
	}
}
