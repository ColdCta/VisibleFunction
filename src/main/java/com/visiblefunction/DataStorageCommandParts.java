package com.visiblefunction;

import java.util.List;
import java.util.Locale;

public record DataStorageCommandParts(String operation, String storage, String path, String modifier, String value) {
	public static DataStorageCommandParts parse(String command) {
		List<String> tokens = CommandText.tokenize(command);
		String operation = tokenOr(tokens, 1, "unknown").toLowerCase(Locale.ROOT);
		String storage = tokenOr(tokens, 3, "unknown");

		if (!"data".equals(tokenOr(tokens, 0, "unknown")) || !"storage".equals(tokenOr(tokens, 2, "unknown"))) {
			return new DataStorageCommandParts(operation, storage, "unknown", "unknown", "none");
		}

		return switch (operation) {
			case "get" -> new DataStorageCommandParts(operation, storage, tokenOr(tokens, 4, "root"), "get", joinIfPresent(tokens, 5, tokens.size(), "none"));
			case "merge" -> new DataStorageCommandParts(operation, storage, "root", "merge", joinIfPresent(tokens, 4, tokens.size(), "none"));
			case "remove" -> new DataStorageCommandParts(operation, storage, tokenOr(tokens, 4, "unknown"), "remove", "none");
			case "modify" -> new DataStorageCommandParts(operation, storage, tokenOr(tokens, 4, "unknown"), joinIfPresent(tokens, 5, tokens.size(), "unknown"), modifierValue(tokens));
			default -> new DataStorageCommandParts(operation, storage, tokenOr(tokens, 4, "unknown"), "unknown", joinIfPresent(tokens, 5, tokens.size(), "none"));
		};
	}

	private static String modifierValue(List<String> tokens) {
		int valueIndex = -1;
		for (int index = 5; index < tokens.size(); index++) {
			String token = tokens.get(index);
			if ("value".equals(token) || "from".equals(token) || "string".equals(token)) {
				valueIndex = index + 1;
				break;
			}
		}

		if (valueIndex < 0 || valueIndex >= tokens.size()) {
			return "none";
		}

		return join(tokens, valueIndex, tokens.size());
	}

	private static String tokenOr(List<String> tokens, int index, String fallback) {
		return index < tokens.size() ? tokens.get(index) : fallback;
	}

	private static String joinIfPresent(List<String> tokens, int start, int end, String fallback) {
		return start < tokens.size() ? join(tokens, start, Math.min(end, tokens.size())) : fallback;
	}

	private static String join(List<String> tokens, int start, int end) {
		return String.join(" ", tokens.subList(start, end));
	}

}
