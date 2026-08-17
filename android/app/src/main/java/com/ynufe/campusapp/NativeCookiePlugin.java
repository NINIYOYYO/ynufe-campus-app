package com.ynufe.campusapp;

import android.content.Context;
import android.content.Intent;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Environment;
import android.util.Base64;
import android.webkit.CookieManager;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.util.LinkedHashSet;
import java.util.Set;

/**
 * NativeCookiePlugin: 直通 Android 原生 CookieManager 与原生文件保存/打开的桥接插件。
 * 解决前端 JS 因浏览器 Header 安全规范无法读取 Cookie 以及 WebView 内无法直接保存/打开附件的问题。
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

    /**
     * 将二进制文件保存至手机下载目录，并直接调用系统应用选择器打开。
     *
     * @param call 包含 fileName, base64Data, mimeType 的调用对象
     */
    @PluginMethod
    public void saveAndOpenFile(PluginCall call) {
        try {
            String fileName = call.getString("fileName", "attachment");
            String base64Data = call.getString("base64Data", "");
            String mimeType = call.getString("mimeType", "*/*");

            if (base64Data == null || base64Data.trim().isEmpty()) {
                call.reject("Base64 data is empty");
                return;
            }

            byte[] fileBytes = Base64.decode(base64Data, Base64.DEFAULT);
            Context context = getContext();

            // 优先存储至系统公共 Download 目录，若不可写则使用应用专属外部 Download 目录
            File targetDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
            if (targetDir == null || (!targetDir.exists() && !targetDir.mkdirs()) || !targetDir.canWrite()) {
                targetDir = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
            }
            if (targetDir == null) {
                targetDir = context.getFilesDir();
            }

            File targetFile = new File(targetDir, fileName);
            int count = 1;
            String nameWithoutExt = fileName;
            String ext = "";
            int dotIdx = fileName.lastIndexOf('.');
            if (dotIdx != -1) {
                nameWithoutExt = fileName.substring(0, dotIdx);
                ext = fileName.substring(dotIdx);
            }
            while (targetFile.exists()) {
                targetFile = new File(targetDir, nameWithoutExt + " (" + count + ")" + ext);
                count++;
            }

            try (FileOutputStream fos = new FileOutputStream(targetFile)) {
                fos.write(fileBytes);
                fos.flush();
            }

            // 通知系统媒体库与下载管理器刷新
            try {
                MediaScannerConnection.scanFile(
                    context,
                    new String[]{ targetFile.getAbsolutePath() },
                    new String[]{ mimeType },
                    null
                );
            } catch (Exception ignored) {
            }

            // 唤起系统应用选择器
            try {
                Uri contentUri = FileProvider.getUriForFile(
                    context,
                    context.getPackageName() + ".fileprovider",
                    targetFile
                );
                Intent viewIntent = new Intent(Intent.ACTION_VIEW);
                viewIntent.setDataAndType(contentUri, mimeType != null && !mimeType.isEmpty() ? mimeType : "*/*");
                viewIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                viewIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

                Intent chooser = Intent.createChooser(viewIntent, "打开文件: " + fileName);
                chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(chooser);
            } catch (Exception launchErr) {
                launchErr.printStackTrace();
            }

            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("filePath", targetFile.getAbsolutePath());
            ret.put("fileName", targetFile.getName());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to save or open file: " + e.getMessage(), e);
        }
    }
}

