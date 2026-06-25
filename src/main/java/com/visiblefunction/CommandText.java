package com.visiblefunction;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

final class CommandText {
	private CommandText() {
	}

	static String normalize(String commandInput) {
		String command = commandInput == null ? "" : commandInput.strip();
		return command.startsWith("/") ? command : "/" + command;
	}

	static String effectiveCommand(String commandInput) {
		String command = normalize(commandInput);

		for (int depth = 0; depth < 8; depth++) {
			String nested = executeRunCommand(command);
			if (nested == null || nested.equals(command)) {
				return command;
			}
			command = nested;
		}

		return command;
	}

	static String executeRunCommand(String commandInput) {
		String normalized = normalize(commandInput);
		String input = normalized.startsWith("/") ? normalized.substring(1) : normalized;
		List<Token> tokens = tokensWithPositions(input);

		if (tokens.isEmpty() || !"execute".equals(tokens.getFirst().value().toLowerCase(Locale.ROOT))) {
			return null;
		}

		for (Token token : tokens) {
			if ("run".equals(token.value().toLowerCase(Locale.ROOT))) {
				String nested = input.substring(token.end()).strip();
				return nested.isEmpty() ? null : normalize(nested);
			}
		}

		return null;
	}

	static List<String> tokenize(String commandInput) {
		String normalized = normalize(commandInput);
		String input = normalized.startsWith("/") ? normalized.substring(1) : normalized;
		List<Token> tokens = tokensWithPositions(input);
		List<String> values = new ArrayList<>(tokens.size());
		for (Token token : tokens) {
			values.add(token.value());
		}
		return values;
	}

	private static List<Token> tokensWithPositions(String input) {
		List<Token> tokens = new ArrayList<>();
		StringBuilder token = new StringBuilder();
		int tokenStart = -1;
		int depth = 0;
		boolean quoted = false;
		char quote = 0;
		boolean escaped = false;

		for (int index = 0; index < input.length(); index++) {
			char character = input.charAt(index);

			if (escaped) {
				append(token, character);
				escaped = false;
				continue;
			}

			if (character == '\\') {
				if (tokenStart < 0) {
					tokenStart = index;
				}
				token.append(character);
				escaped = true;
				continue;
			}

			if (quoted) {
				append(token, character);
				if (character == quote) {
					quoted = false;
				}
				continue;
			}

			if (character == '"' || character == '\'') {
				if (tokenStart < 0) {
					tokenStart = index;
				}
				token.append(character);
				quoted = true;
				quote = character;
				continue;
			}

			if (character == '[' || character == '{' || character == '(') {
				depth++;
			} else if (character == ']' || character == '}' || character == ')') {
				depth = Math.max(0, depth - 1);
			}

			if (Character.isWhitespace(character) && depth == 0) {
				if (!token.isEmpty()) {
					tokens.add(new Token(token.toString(), tokenStart, index));
					token.setLength(0);
					tokenStart = -1;
				}
				continue;
			}

			if (tokenStart < 0) {
				tokenStart = index;
			}
			token.append(character);
		}

		if (!token.isEmpty()) {
			tokens.add(new Token(token.toString(), tokenStart, input.length()));
		}

		return tokens;
	}

	private static void append(StringBuilder token, char character) {
		token.append(character);
	}

	private record Token(String value, int start, int end) {
	}
}
