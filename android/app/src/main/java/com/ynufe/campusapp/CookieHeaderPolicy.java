package com.ynufe.campusapp;

/** Keeps the first scoped session when native HTTP has no explicit Cookie header. */
final class CookieHeaderPolicy {
    private CookieHeaderPolicy() {}

    static String sanitize(String cookie) {
        if (cookie == null) return "";
        String selectedSession = null;
        StringBuilder otherCookies = new StringBuilder();
        for (String part : cookie.split(";")) {
            String trimmed = part.trim();
            if (trimmed.regionMatches(true, 0, "JSESSIONID=", 0, 11)) {
                // CookieManager orders scoped cookies before their root-path siblings.
                if (selectedSession == null && trimmed.length() > 11) {
                    selectedSession = trimmed;
                }
            } else if (!trimmed.isEmpty()) {
                if (otherCookies.length() > 0) otherCookies.append("; ");
                otherCookies.append(trimmed);
            }
        }
        if (selectedSession == null) return otherCookies.toString();
        return selectedSession + (otherCookies.length() > 0 ? "; " + otherCookies : "");
    }
}
