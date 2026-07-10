package com.visiblefunction;

import com.google.gson.JsonParser;
import com.visiblefunction.VisibleFunctionExportJson.ExportRecord;
import net.minecraft.server.permissions.PermissionSet;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class VisibleFunctionSecurityAndJsonTest {
	@Test
	void managementPermissionRequiresGamemaster() {
		assertFalse(VisibleFunctionCommands.canManage(PermissionSet.NO_PERMISSIONS));
		assertTrue(VisibleFunctionCommands.canManage(PermissionSet.ALL_PERMISSIONS));
	}

	@Test
	void recordJsonEscapesControlCharactersAndParses() {
		VisibleFunctionEventPayload payload = new VisibleFunctionEventPayload(
			"EVENT",
			"quote\"line\n",
			"summoned",
			"- tick: 0\n- action: summon\n",
			"- nbt: {name:\"test\"}\n"
		);
		String json = VisibleFunctionExportJson.record(new ExportRecord(1, payload, 0, 1));
		assertTrue(JsonParser.parseString(json).isJsonObject());
	}

	@Test
	void healthJsonExposesRetentionAndTransportIntegrity() {
		var health = JsonParser.parseString(VisibleFunctionExportJson.health(
			true,
			17654,
			20,
			3,
			100,
			81,
			100,
			4,
			2
		)).getAsJsonObject();

		assertEquals(3, health.get("protocolVersion").getAsInt());
		assertEquals(81, health.get("oldestRecordId").getAsLong());
		assertEquals(100, health.get("latestRecordId").getAsLong());
		assertEquals(4, health.get("droppedStreamRecords").getAsLong());
		assertEquals(2, health.get("slowClientDisconnects").getAsLong());
	}

	@Test
	void protocolV3SerializesMembershipTickAndCanonicalBucketRelationships() {
		VisibleFunctionEventPayload payload = new VisibleFunctionEventPayload(
			"COMMAND",
			"say hi",
			"executed",
			"- tick: 10\n- command: say hi\n- command_id: command-1\n- source: tick function\n- function: demo:tick\n",
			"- tick: 10\n"
		);
		ExportRecord record = new ExportRecord(1, payload, 500, 7);
		TickFilterEngine<ExportRecord> engine = new TickFilterEngine<>();
		var result = engine.addDetailed(VisibleFunctionExportJson.tickFilterInput(record));
		record.setTickFilterMembership(result);

		var recordJson = JsonParser.parseString(VisibleFunctionExportJson.record(record)).getAsJsonObject();
		assertEquals(2, recordJson.getAsJsonArray("tickFilterGroupIds").size());
		assertEquals(2, recordJson.getAsJsonArray("capturedTickFilterGroupIds").size());

		var tickJson = JsonParser.parseString(VisibleFunctionExportJson.tick(7, 15)).getAsJsonObject();
		assertEquals(7, tickJson.get("sessionId").getAsLong());
		assertEquals(15, tickJson.get("currentTick").getAsLong());

		var buckets = JsonParser.parseString(
			VisibleFunctionExportJson.tickFilterSnapshots(engine.snapshots(10))
		).getAsJsonObject().getAsJsonArray("tickFilter");
		assertTrue(buckets.asList().stream().allMatch(element -> element.getAsJsonObject().has("groupId")));
		var command = buckets.asList().stream()
			.map(element -> element.getAsJsonObject())
			.filter(bucket -> "COMMAND".equals(bucket.get("type").getAsString()))
			.findFirst()
			.orElseThrow();
		assertEquals("demo:tick", command.get("functionId").getAsString());
		assertTrue(command.has("parentGroupId"));
	}
}
