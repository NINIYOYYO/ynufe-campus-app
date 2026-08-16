package com.ynufe.campusapp;

import android.net.Uri;
import android.webkit.CookieManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.LinkedHashSet;
import java.util.Set;

/**
 * NativeCookiePlugin: 直通 Android 原生 CookieManager 的桥接插件。
 * 解决前端 JS 因浏览器 Header 安全规范及子路径 Path=/jsxsd 作用域隔离无法读取 Cookie 的问题。
 */
@CapacitorPlugin(name = "NativeCookie")
public class NativeCookiePlugin extends Plugin {

    private static final String DEFAULT_BASE_URL = "https://xjwis.ynufe.edu.cn";

    /**
     * 规范化并清洗输入的 URL 字符串，若为空或非法则返回默认教务域名。
     *
     * @param inputUrl 输入的原始 URL
     * @return 规范化后的基础 URL 域名
     */
    private String resolveBaseUrl(String inputUrl) {
        if (inputUrl == null || inputUrl.trim().isEmpty()) {
            return DEFAULT_BASE_URL;
        }
        String trimmed = inputUrl.trim();
        try {
            Uri uri = Uri.parse(trimmed);
            if (uri.getScheme() != null && uri.getHost() != null) {
                int port = uri.getPort();
                String portPart = (port != -1 && port != 80 && port != 443) ? (":" + port) : "";
                return uri.getScheme() + "://" + uri.getHost() + portPart;
            }
        } catch (Exception ignored) {
        }
        return trimmed.replaceAll("/+$", "");
    }

    @PluginMethod
    public void getCookie(PluginCall call) {
        try {
            CookieManager cookieManager = CookieManager.getInstance();
            String rawUrl = call.getString("url", "");
            String baseUrl = resolveBaseUrl(rawUrl);

            Set<String> probeUrls = new LinkedHashSet<>();
            if (rawUrl != null && !rawUrl.trim().isEmpty()) {
                probeUrls.add(rawUrl.trim());
            }
            probeUrls.add(baseUrl + "/jsxsd");
            probeUrls.add(baseUrl + "/jsxsd/");
            probeUrls.add(baseUrl + "/jsxsd/xk/LoginToXkLdap");
            probeUrls.add(baseUrl + "/jsxsd/verifycode.servlet");
            probeUrls.add(baseUrl + "/jsxsd/framework/xsMain.jsp");
            probeUrls.add(baseUrl + "/jsxsd/framework/xsMain_new.jsp");
            probeUrls.add(baseUrl + "/");
            probeUrls.add(baseUrl);

            if (!DEFAULT_BASE_URL.equals(baseUrl)) {
                probeUrls.add(DEFAULT_BASE_URL + "/jsxsd");
                probeUrls.add(DEFAULT_BASE_URL + "/");
                probeUrls.add(DEFAULT_BASE_URL);
            }

            String foundCookie = "";
            for (String url : probeUrls) {
                String c = cookieManager.getCookie(url);
                if (c != null && c.contains("JSESSIONID")) {
                    foundCookie = c;
                    break;
                }
                if (c != null && !c.isEmpty() && foundCookie.isEmpty()) {
                    foundCookie = c;
                }
            }

            JSObject ret = new JSObject();
            ret.put("cookie", foundCookie);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to get cookie", e);
        }
    }

    @PluginMethod
    public void setCookie(PluginCall call) {
        try {
            String cookieStr = call.getString("cookie", "");
            if (cookieStr == null) {
                cookieStr = "";
            }

            String rawUrl = call.getString("url", "");
            String baseUrl = resolveBaseUrl(rawUrl);
            CookieManager cookieManager = CookieManager.getInstance();

            Set<String> writeUrls = new LinkedHashSet<>();
            if (rawUrl != null && !rawUrl.trim().isEmpty()) {
                writeUrls.add(rawUrl.trim());
            }
            writeUrls.add(baseUrl);
            writeUrls.add(baseUrl + "/");
            writeUrls.add(baseUrl + "/jsxsd");
            writeUrls.add(baseUrl + "/jsxsd/");
            writeUrls.add(baseUrl + "/jsxsd/xk/LoginToXkLdap");
            writeUrls.add(baseUrl + "/jsxsd/verifycode.servlet");
            writeUrls.add(baseUrl + "/jsxsd/framework/xsMain.jsp");

            for (String url : writeUrls) {
                cookieManager.setCookie(url, cookieStr);
            }
            cookieManager.flush();
            call.resolve();
        } catch (Exception e) {
            call.reject("Failed to set cookie", e);
        }
    }
}
