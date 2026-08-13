import { AccentColor, TextColorPreset, BgColorPreset, StylePreset } from '../types/theme';

/**
 * 强调色配置表
 */
export const ACCENT_COLORS: AccentColor[] = [
    { name: "皇家蓝", hex: "#3b82f6", rgb: "59, 130, 246" },
    { name: "梦幻紫", hex: "#8b5cf6", rgb: "139, 92, 246" },
    { name: "翡翠绿", hex: "#10b981", rgb: "16, 185, 129" },
    { name: "迷幻粉", hex: "#ec4899", rgb: "236, 72, 153" },
    { name: "琥珀橙", hex: "#f59e0b", rgb: "245, 158, 11" },
    { name: "烈焰红", hex: "#ef4444", rgb: "239, 68, 68" },
];

/**
 * 自定义文字颜色预设表
 */
export const TEXT_COLOR_PRESETS: TextColorPreset[] = [
    { name: "默认自适应", hex: "" },
    { name: "纯白", hex: "#ffffff" },
    { name: "深邃黑", hex: "#111827" },
    { name: "暖金琥珀", hex: "#fbbf24" },
    { name: "冰清天蓝", hex: "#38bdf8" },
    { name: "薄荷翠绿", hex: "#34d399" },
    { name: "柔粉云霞", hex: "#f472b6" },
];

/**
 * 自定义背景底色预设表
 */
export const BG_COLOR_PRESETS: BgColorPreset[] = [
    { name: "默认自适应", hex: "" },
    { name: "夜蓝黑曜", hex: "#0f172a" },
    { name: "勃艮第红", hex: "#1a0910" },
    { name: "深苔幽绿", hex: "#091a14" },
    { name: "薰衣草灰", hex: "#f3e8ff" },
    { name: "暖杏奶油", hex: "#fff7ed" },
];

/**
 * 整套预设风格主题方案表
 */
export const STYLE_PRESETS: StylePreset[] = [
    { name: "曜石蓝", mode: "dark", accentHex: "#3b82f6", accentRgb: "59, 130, 246", bg: "" },
    { name: "午夜紫", mode: "dark", accentHex: "#8b5cf6", accentRgb: "139, 92, 246", bg: "#120a20" },
    { name: "深海青", mode: "dark", accentHex: "#06b6d4", accentRgb: "6, 182, 212", bg: "#07191f" },
    { name: "森野绿", mode: "dark", accentHex: "#10b981", accentRgb: "16, 185, 129", bg: "#08160f" },
    { name: "熔岩橙", mode: "dark", accentHex: "#f97316", accentRgb: "249, 115, 22", bg: "#1a0d05" },
    { name: "樱绯粉", mode: "dark", accentHex: "#ec4899", accentRgb: "236, 72, 153", bg: "#1a0812" },
    { name: "云瓷白", mode: "light", accentHex: "#0071e3", accentRgb: "0, 113, 227", bg: "#ffffff" },
    { name: "暖阳米", mode: "light", accentHex: "#f59e0b", accentRgb: "245, 158, 11", bg: "#fff7ed" },
];
