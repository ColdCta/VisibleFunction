package com.visiblefunction;

public record VisibleFunctionEventText(String category, String subject, String summary, String basic, String detailed) {
	public String header() {
		return "[ " + category + " ] " + subject + (summary.isBlank() ? "" : " " + summary);
	}
}
