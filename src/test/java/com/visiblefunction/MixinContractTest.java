package com.visiblefunction;

import com.google.gson.JsonParser;
import org.junit.jupiter.api.Test;

import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class MixinContractTest {
	@Test
	void everyRequiredMixinClassExistsAndInjectionFailureIsFatal() throws Exception {
		try (
			var input = MixinContractTest.class.getResourceAsStream("/visiblefunction.mixins.json");
			var reader = new InputStreamReader(input, StandardCharsets.UTF_8)
		) {
			var config = JsonParser.parseReader(reader).getAsJsonObject();
			assertTrue(config.get("required").getAsBoolean());
			assertEquals(1, config.getAsJsonObject("injectors").get("defaultRequire").getAsInt());
			String packageName = config.get("package").getAsString();
			for (var name : config.getAsJsonArray("mixins")) {
				assertMixinClassExists(packageName, name.getAsString());
			}
			for (var name : config.getAsJsonArray("client")) {
				assertMixinClassExists(packageName, name.getAsString());
			}
		}
	}

	private static void assertMixinClassExists(String packageName, String className) {
		String resource = "/" + packageName.replace('.', '/') + "/" + className + ".class";
		assertTrue(MixinContractTest.class.getResource(resource) != null, "Missing mixin class " + packageName + "." + className);
	}
}
