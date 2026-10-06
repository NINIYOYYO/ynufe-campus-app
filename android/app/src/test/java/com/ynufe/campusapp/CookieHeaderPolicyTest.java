package com.ynufe.campusapp;

import static org.junit.Assert.assertEquals;
import org.junit.Test;

public class CookieHeaderPolicyTest {
    @Test
    public void keepsScopedSessionInsteadOfStaleRootSession() {
        assertEquals("JSESSIONID=VALID_SCOPED; jsxsd=TEST_USER", CookieHeaderPolicy.sanitize(
            "JSESSIONID=VALID_SCOPED; jsxsd=TEST_USER; JSESSIONID=STALE_ROOT"));
    }

    @Test
    public void ignoresEmptySessionAndPreservesOtherCookies() {
        assertEquals("JSESSIONID=VALID; preference=dark", CookieHeaderPolicy.sanitize(
            "JSESSIONID=; preference=dark; JSESSIONID=VALID"));
    }

    @Test
    public void handlesMissingSession() {
        assertEquals("", CookieHeaderPolicy.sanitize(null));
        assertEquals("preference=dark", CookieHeaderPolicy.sanitize("preference=dark"));
    }
}
