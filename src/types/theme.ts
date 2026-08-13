/**
 * 主题强调色配置项
 */
export interface AccentColor {
    name: string;
    hex: string;
    rgb: string;
}

/**
 * 自定义文字颜色预设项
 */
export interface TextColorPreset {
    name: string;
    hex: string;
}

/**
 * 自定义背景底色预设项
 */
export interface BgColorPreset {
    name: string;
    hex: string;
}

/**
 * 预设风格组合方案配置项
 */
export interface StylePreset {
    name: string;
    mode: "dark" | "light";
    accentHex: string;
    accentRgb: string;
    bg: string;
}
