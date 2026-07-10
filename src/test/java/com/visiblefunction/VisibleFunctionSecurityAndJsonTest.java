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

		assertEquals(2, health.get("protocolVersion").getAsInt());
		assertEquals(81, health.get("oldestRecordId").getAsLong());
		assertEquals(100, health.get("latestRecordId").getAsLong());
		assertEquals(4, health.get("droppedStreamRecords").getAsLong());
		assertEquals(2, health.get("slowClientDisconnects").getAsLong());
	}
}
