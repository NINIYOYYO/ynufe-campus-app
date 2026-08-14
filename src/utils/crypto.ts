/**
 * 云南财经大学教务网专属账号密码 encodeInp 加密算法（登录协议用，变种 Base64）
 *
 * Args:
 *     input (string): 原始待编码字符串（如明文账号或密码）。
 *
 * Returns:
 *     string: 教务协议编码后的字符串。
 */
export function encodeInp(input: string): string {
    if (!input) return "";
    const keyStr = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
    let output = "";
    let i = 0;
    while (i < input.length) {
        const chr1 = input.charCodeAt(i++);
        const chr2 = input.charCodeAt(i++);
        const chr3 = input.charCodeAt(i++);

        const enc1 = chr1 >> 2;
        const enc2 = ((chr1 & 3) << 4) | (chr2 >> 4);
        const enc3 = isNaN(chr2) ? 64 : (((chr2 & 15) << 2) | (chr3 >> 6));
        const enc4 = isNaN(chr3) ? 64 : (chr3 & 63);

        output = output + keyStr.charAt(enc1) + keyStr.charAt(enc2) + keyStr.charAt(enc3) + keyStr.charAt(enc4);
    }
    return output;
}

/* ============================================================
 * 本地凭据混淆存储
 * 说明：纯前端应用无法做到真正安全的密码存储（密钥必然也在本地），
 * 以下实现是「混淆」而非强加密——防止密码以明文形式直接躺在
 * localStorage 文件里被随手看到，但无法抵御针对性逆向。
 * ============================================================ */

const DEVICE_KEY_STORAGE = "ynufe_device_key";
const MAGIC_PREFIX = "YNUFE_OK:";

/**
 * 获取（或首次生成）本机随机混淆密钥。
 *
 * Returns:
 *     string: 32 位十六进制随机设备密钥。
 */
function getDeviceKey(): string {
    let key = localStorage.getItem(DEVICE_KEY_STORAGE);
    if (!key) {
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        key = Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
        localStorage.setItem(DEVICE_KEY_STORAGE, key);
    }
    return key;
}

/**
 * XOR + Base64 混淆（支持 UTF-8 并附带完整性头部校验）。
 *
 * Args:
 *     plain (string): 待混淆明文。
 *
 * Returns:
 *     string: 混淆后的密文字符串 (v2:前缀)。
 */
export function obfuscate(plain: string): string {
    if (!plain) return "";
    const key = getDeviceKey();
    const data = new TextEncoder().encode(MAGIC_PREFIX + plain);
    const out = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) {
        out[i] = data[i] ^ key.charCodeAt(i % key.length);
    }
    let bin = "";
    out.forEach(b => { bin += String.fromCharCode(b); });
    return "v2:" + btoa(bin);
}

/**
 * 还原被混淆的文本；校验完整性签名以防止密钥不匹配时生成乱码引发账号锁定。
 *
 * Args:
 *     stored (string): 待解密字符串。
 *
 * Returns:
 *     string: 解密后的明文字符串，密钥损坏或解码失败时安全返回空字符串。
 */
export function deobfuscate(stored: string): string {
    if (!stored) return "";
    if (stored.startsWith("v2:")) {
        try {
            const key = getDeviceKey();
            const bin = atob(stored.slice(3));
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) {
                bytes[i] = bin.charCodeAt(i) ^ key.charCodeAt(i % key.length);
            }
            const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
            if (!decoded.startsWith(MAGIC_PREFIX)) {
                console.warn("[crypto] Device key mismatch or corrupted credential detected, safely returning empty string.");
                return "";
            }
            return decoded.slice(MAGIC_PREFIX.length);
        } catch (e) {
            console.error("[crypto] Failed to deobfuscate v2 credential (key mismatch or corrupt):", e);
            return "";
        }
    }
    if (stored.startsWith("v1:")) {
        try {
            const key = getDeviceKey();
            const bin = atob(stored.slice(3));
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) {
                bytes[i] = bin.charCodeAt(i) ^ key.charCodeAt(i % key.length);
            }
            return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        } catch (e) {
            console.error("[crypto] Failed to deobfuscate v1 credential:", e);
            return "";
        }
    }
    return stored; // 旧版明文数据，向后兼容返回
}
