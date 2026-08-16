package com.ynufe.campusapp;

import android.webkit.CookieManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * NativeCookiePlugin: 直通 Android 原生 CookieManager 的桥接插件
 * 解决前端 JS 因浏览器 Header 安全规范及子路径 Path=/jsxsd 作用域隔离无法读取 Cookie 的问题。
 */
@CapacitorPlugin(name = "NativeCookie")
public class NativeCookiePlugin extends Plugin {

    @PluginMethod
    public void getCookie(PluginCall call) {
        try {
            CookieManager cookieManager = CookieManager.getInstance();
            String baseUrl = "https://xjwis.ynufe.edu.cn";
            
            // 依次检索根目录、/jsxsd 子目录及关键入口的 Cookie
            String[] testUrls = new String[] {
                baseUrl + "/jsxsd",
                baseUrl + "/jsxsd/",
                baseUrl + "/jsxsd/xk/LoginToXkLdap",
                baseUrl + "/jsxsd/verifycode.servlet",
                baseUrl + "/jsxsd/framework/xsMain.jsp",
                baseUrl + "/jsxsd/framework/xsMain_new.jsp",
                baseUrl + "/",
                baseUrl
            };

            String foundCookie = "";
            for (String url : testUrls) {
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
            CookieManager cookieManager = CookieManager.getInstance();
            String baseUrl = "https://xjwis.ynufe.edu.cn";

            // 同时将 Cookie 写入根路径与 /jsxsd 各子作用域，确保所有原生及 WebView 请求均能携带
            cookieManager.setCookie(baseUrl, cookieStr);
            cookieManager.setCookie(baseUrl + "/", cookieStr);
            cookieManager.setCookie(baseUrl + "/jsxsd", cookieStr);
            cookieManager.setCookie(baseUrl + "/jsxsd/", cookieStr);
            cookieManager.setCookie(baseUrl + "/jsxsd/xk/LoginToXkLdap", cookieStr);
            cookieManager.setCookie(baseUrl + "/jsxsd/verifycode.servlet", cookieStr);
            cookieManager.setCookie(baseUrl + "/jsxsd/framework/xsMain.jsp", cookieStr);
            cookieManager.flush();
            call.resolve();
        } catch (Exception e) {
            call.reject("Failed to set cookie", e);
        }
    }
}
