package com.ynufe.campusapp;

import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import java.io.IOException;
import java.net.CookieHandler;
import java.net.URI;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeCookiePlugin.class);
        super.onCreate(savedInstanceState);
        
        try {
            CookieManager cookieManager = CookieManager.getInstance();
            cookieManager.setAcceptCookie(true);
            WebView webView = getBridge() != null ? getBridge().getWebView() : null;
            if (webView != null) {
                cookieManager.setAcceptThirdPartyCookies(webView, true);
            }

            // 全局硬核连接 Java 原生 CookieHandler 与 WebView 的 android.webkit.CookieManager
            // 解决 CapacitorHttp (Java HttpURLConnection) 与 WebView 原生 Cookie 数据库隔离丢包的问题
            CookieHandler.setDefault(new CookieHandler() {
                @Override
                public Map<String, List<String>> get(URI uri, Map<String, List<String>> requestHeaders) throws IOException {
                    Map<String, List<String>> map = new HashMap<>(requestHeaders);
                    if (uri != null) {
                        String url = uri.toString();
                        String cookie = CookieManager.getInstance().getCookie(url);
                        if (cookie != null && !cookie.isEmpty()) {
                            map.put("Cookie", Collections.singletonList(cookie));
                        }
                    }
                    return map;
                }

                @Override
                public void put(URI uri, Map<String, List<String>> responseHeaders) throws IOException {
                    if (uri != null && responseHeaders != null) {
                        String url = uri.toString();
                        List<String> setCookieList = responseHeaders.get("Set-Cookie");
                        if (setCookieList == null) {
                            setCookieList = responseHeaders.get("set-cookie");
                        }
                        if (setCookieList != null) {
                            for (String cookieStr : setCookieList) {
                                CookieManager.getInstance().setCookie(url, cookieStr);
                                if (cookieStr.contains("JSESSIONID")) {
                                    // 给 JSESSIONID 强制注入 2038 远期过期时间以保存在磁盘 SQLite
                                    String persistentCookie = cookieStr + "; Expires=Fri, 31 Dec 2038 23:59:59 GMT; Path=/jsxsd";
                                    CookieManager.getInstance().setCookie(url, persistentCookie);
                                }
                            }
                            CookieManager.getInstance().flush();
                        }
                    }
                }
            });

        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    @Override
    public void onPause() {
        super.onPause();
        flushCookies();
    }

    @Override
    public void onStop() {
        super.onStop();
        flushCookies();
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        flushCookies();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (!hasFocus) {
            flushCookies();
        }
    }

    /**
     * 强行将 WebView 内存中的 Cookie 刷入磁盘 SQLite 数据库（app_webview/Cookies）。
     * 解决手机从后台杀死/清理内存后，Session Cookie 丢失导致掉线的问题。
     */
    private void flushCookies() {
        try {
            CookieManager.getInstance().flush();
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
