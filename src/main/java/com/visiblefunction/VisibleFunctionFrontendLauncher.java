package com.visiblefunction;

import net.fabricmc.api.EnvType;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.util.Util;

import java.net.URI;

final class VisibleFunctionFrontendLauncher {
	private VisibleFunctionFrontendLauncher() {
	}

	static void openIfClient(int port) {
		if (FabricLoader.getInstance().getEnvironmentType() != EnvType.CLIENT) {
			return;
		}

		String url = frontendUrl(port);
		Thread launcher = new Thread(() -> openBrowser(url), "VisibleFunction Frontend Launcher");
		launcher.setDaemon(true);
		launcher.start();
	}

	static String frontendUrl(int port) {
		return "http://127.0.0.1:" + port + "/";
	}

	private static void openBrowser(String url) {
		try {
			Util.getPlatform().openUri(URI.create(url));
		} catch (Exception exception) {
			VisibleFunction.LOGGER.warn("Failed to open VisibleFunction frontend automatically at {}", url, exception);
		}
	}
}
