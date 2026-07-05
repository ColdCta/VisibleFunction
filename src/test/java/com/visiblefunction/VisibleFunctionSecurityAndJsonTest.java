package com.visiblefunction;

import com.google.gson.JsonParser;
import com.visiblefunction.VisibleFunctionExportJson.ExportRecord;
import net.minecraft.server.permissions.PermissionSet;
import org.junit.jupiter.api.Test;

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
}
