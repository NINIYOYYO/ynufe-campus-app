/**
 * 云南财经大学教务网专属账号密码 encodeInp 加密算法（登录协议用，变种 Base64）
 */
export function encodeInp(input: string): string {
    const keyStr = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
    let output = "";
    let i = 0;
    do {
        const chr1 = input.charCodeAt(i++);
        const chr2 = input.charCodeAt(i++);
        const chr3 = input.charCodeAt(i++);

        const enc1 = chr1 >> 2;
        const enc2 = ((chr1 & 3) << 4) | (chr2 >> 4);
        const enc3 = isNaN(chr2) ? 64 : (((chr2 & 15) << 2) | (chr3 >> 6));
        const enc4 = isNaN(chr3) ? 64 : (chr3 & 63);

        output = output + keyStr.charAt(enc1) + keyStr.charAt(enc2) + keyStr.charAt(enc3) + keyStr.charAt(enc4);
    } while (i < input.length);
    return output;
}

/* ============================================================
 * 本地凭据混淆存储
 * 说明：纯前端应用无法做到真正安全的密码存储（密钥必然也在本地），
 * 以下实现是「混淆」而非强加密——防止密码以明文形式直接躺在
 * localStorage 文件里被随手看到，但无法抵御针对性逆向。
 * ============================================================ */

const DEVICE_KEY_STORAGE = "ynufe_device_key";

/** 获取（或首次生成）本机随机混淆密钥 */
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

/** XOR + Base64 混淆（支持 UTF-8） */
export function obfuscate(plain: string): string {
    const key = getDeviceKey();
    const data = new TextEncoder().encode(plain);
    const out = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) {
        out[i] = data[i] ^ key.charCodeAt(i % key.length);
    }
    let bin = "";
    out.forEach(b => { bin += String.fromCharCode(b); });
    return "v1:" + btoa(bin);
}

/** 还原被混淆的文本；传入明文旧数据时原样返回（向后兼容迁移） */
export function deobfuscate(stored: string): string {
    if (!stored.startsWith("v1:")) return stored; // 旧版明文数据，直接返回
    try {
        const key = getDeviceKey();
        const bin = atob(stored.slice(3));
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) {
            bytes[i] = bin.charCodeAt(i) ^ key.charCodeAt(i % key.length);
        }
        return new TextDecoder().decode(bytes);
    } catch (e) {
        console.error("[crypto] Failed to deobfuscate stored credential:", e);
        return "";
    }
}
