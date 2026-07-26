/**
 * ThemeCustomizer: 多种主题配色、自定义文字颜色与全局背景颜色管理器
 * 职责：提供主题强调色 Preset 切换、自定义文字颜色 Picker、自定义背景颜色 Picker、实时 CSS 变量注入及 LocalStorage 持久化存储。
 */
export class ThemeCustomizer {
    public static accentColors = [
        { name: "皇家蓝", hex: "#3b82f6", rgb: "59, 130, 246" },
        { name: "梦幻紫", hex: "#8b5cf6", rgb: "139, 92, 246" },
        { name: "翡翠绿", hex: "#10b981", rgb: "16, 185, 129" },
        { name: "迷幻粉", hex: "#ec4899", rgb: "236, 72, 153" },
        { name: "琥珀橙", hex: "#f59e0b", rgb: "245, 158, 11" },
        { name: "烈焰红", hex: "#ef4444", rgb: "239, 68, 68" },
    ];

    public static textColorPresets = [
        { name: "默认自适应", hex: "" },
        { name: "纯白", hex: "#ffffff" },
        { name: "深邃黑", hex: "#111827" },
        { name: "暖金琥珀", hex: "#fbbf24" },
        { name: "冰清天蓝", hex: "#38bdf8" },
        { name: "薄荷翠绿", hex: "#34d399" },
        { name: "柔粉云霞", hex: "#f472b6" },
    ];

    public static bgColorPresets = [
        { name: "默认自适应", hex: "" },
        { name: "夜蓝黑曜", hex: "#0f172a" },
        { name: "勃艮第红", hex: "#1a0910" },
        { name: "深苔幽绿", hex: "#091a14" },
        { name: "薰衣草灰", hex: "#f3e8ff" },
        { name: "暖杏奶油", hex: "#fff7ed" },
    ];

    /**
     * 整套预设风格主题：一键切换强调色 + 背景底色 + 深浅模式的组合方案。
     * mode 决定深/浅底，accent 为强调色，bg 为背景底色（留空则跟随模式默认）。
     */
    public static stylePresets = [
        { name: "曜石蓝", mode: "dark", accentHex: "#3b82f6", accentRgb: "59, 130, 246", bg: "" },
        { name: "午夜紫", mode: "dark", accentHex: "#8b5cf6", accentRgb: "139, 92, 246", bg: "#120a20" },
        { name: "深海青", mode: "dark", accentHex: "#06b6d4", accentRgb: "6, 182, 212", bg: "#07191f" },
        { name: "森野绿", mode: "dark", accentHex: "#10b981", accentRgb: "16, 185, 129", bg: "#08160f" },
        { name: "熔岩橙", mode: "dark", accentHex: "#f97316", accentRgb: "249, 115, 22", bg: "#1a0d05" },
        { name: "樱绯粉", mode: "dark", accentHex: "#ec4899", accentRgb: "236, 72, 153", bg: "#1a0812" },
        { name: "云瓷白", mode: "light", accentHex: "#0071e3", accentRgb: "0, 113, 227", bg: "#ffffff" },
        { name: "暖阳米", mode: "light", accentHex: "#f59e0b", accentRgb: "245, 158, 11", bg: "#fff7ed" },
    ];

    /**
     * 初始化主题、文字颜色与背景颜色管理器，绑定 DOM 事件并读取本地持久化设置。
     */
    static init(): void {
        this.renderStylePresets();
        this.loadSavedCustomizations();
        this.bindEvents();
        this.updateActiveStyleUI(localStorage.getItem("ynufe_style_preset") || "");
    }

    /**
     * 动态渲染设置面板顶部的预设风格主题网格（单一数据源，避免 HTML 与 TS 不一致）。
     */
    static renderStylePresets(): void {
        const grid = document.getElementById("style-preset-grid");
        if (!grid) return;
        grid.innerHTML = "";
        this.stylePresets.forEach(p => {
            const bg = p.bg || (p.mode === "light" ? "#f4f5f8" : "#0d0d17");
            const btn = document.createElement("button");
            btn.className = "style-preset-btn";
            btn.setAttribute("data-preset", p.name);
            btn.innerHTML = `
                <span class="style-preset-swatch" style="background: linear-gradient(135deg, ${p.accentHex} 0%, ${p.accentHex} 42%, ${bg} 43%, ${bg} 100%);">
                    <span class="style-preset-dot" style="background:${p.accentHex};"></span>
                </span>
                <span class="style-preset-name">${p.name}</span>
            `;
            grid.appendChild(btn);
        });
    }

    /**
     * 应用一整套预设风格主题：切换深浅模式 + 强调色 + 背景底色，并联动壁纸自适应色。
     *
     * Args:
     *     name (string): 预设名称。
     *     save (boolean): 是否持久化。
     */
    static applyStylePreset(name: string, save: boolean = true): void {
        const preset = this.stylePresets.find(p => p.name === name);
        if (!preset) return;

        // 1. 深/浅模式
        const body = document.body;
        if (preset.mode === "light") {
            body.classList.remove("theme-dark");
            body.classList.add("theme-light");
        } else {
            body.classList.remove("theme-light");
            body.classList.add("theme-dark");
        }
        localStorage.setItem("ynufe_theme", preset.mode);
        document.querySelectorAll(".theme-btn").forEach(b => {
            b.classList.toggle("active", b.getAttribute("data-theme") === preset.mode);
        });

        // 2. 强调色 + 背景（文字恢复自适应，保证对比度安全）
        this.setAccentColor(preset.accentHex, preset.accentRgb, save);
        this.setBgColor(preset.bg || "", save);
        this.setTextColor("", save);
        this.updateActiveAccentUI(preset.accentHex);
        this.updateActiveBgUI(preset.bg || "");
        this.updateActiveTextUI("");

        if (save) localStorage.setItem("ynufe_style_preset", name);
        this.updateActiveStyleUI(name);

        // 3. 让壁纸自适应色重新按新模式计算
        window.dispatchEvent(new CustomEvent("ynufe-theme-preset-applied", { detail: { mode: preset.mode } }));
    }

    /**
     * 更新预设风格主题卡片的选中高亮。
     */
    private static updateActiveStyleUI(activeName: string): void {
        document.querySelectorAll(".style-preset-btn").forEach(btn => {
            btn.classList.toggle("active", btn.getAttribute("data-preset") === activeName);
        });
    }

    /**
     * 当用户手动微调单项颜色时，清除"整套预设"的选中标记（已进入自定义状态）。
     */
    private static clearStylePreset(): void {
        localStorage.removeItem("ynufe_style_preset");
        this.updateActiveStyleUI("");
    }

    /**
     * 读取并应用本地存储的个性化主题色、文字颜色与背景颜色设置。
     */
    static loadSavedCustomizations(): void {
        const savedAccent = localStorage.getItem("ynufe_accent_hex");
        const savedAccentRgb = localStorage.getItem("ynufe_accent_rgb");
        const savedTextColor = localStorage.getItem("ynufe_text_color");
        const savedBgColor = localStorage.getItem("ynufe_bg_color");

        if (savedAccent && savedAccentRgb) {
            this.setAccentColor(savedAccent, savedAccentRgb, false);
            this.updateActiveAccentUI(savedAccent);
        }

        if (savedTextColor) {
            this.setTextColor(savedTextColor, false);
            this.updateActiveTextUI(savedTextColor);
        }

        if (savedBgColor) {
            this.setBgColor(savedBgColor, false);
            this.updateActiveBgUI(savedBgColor);
        }
    }

    /**
     * 使用全局事件委托绑定控制面板内的颜色按钮与自由 Color Picker 事件。
     */
    static bindEvents(): void {
        if ((window as any)._themeCustomizerBound) return;
        (window as any)._themeCustomizerBound = true;

        // 全局事件委托
        document.body.addEventListener("click", (e: MouseEvent) => {
            const target = e.target as HTMLElement | null;
            if (!target) return;

            // 0. 预设风格主题卡片代理（整套一键切换）
            const styleBtn = target.closest(".style-preset-btn") as HTMLElement | null;
            if (styleBtn) {
                const presetName = styleBtn.getAttribute("data-preset");
                if (presetName) this.applyStylePreset(presetName, true);
                return;
            }

            // 1. 强调色按钮代理
            const accentBtn = target.closest(".accent-color-btn") as HTMLElement | null;
            if (accentBtn) {
                const hex = accentBtn.getAttribute("data-hex");
                const rgb = accentBtn.getAttribute("data-rgb");
                if (hex && rgb) {
                    this.setAccentColor(hex, rgb, true);
                    this.updateActiveAccentUI(hex);
                    this.clearStylePreset();
                }
                return;
            }

            // 2. 文字颜色 Preset 按钮代理
            const textBtn = target.closest(".text-color-btn") as HTMLElement | null;
            if (textBtn) {
                const hex = textBtn.getAttribute("data-hex") || "";
                this.setTextColor(hex, true);
                this.updateActiveTextUI(hex);
                this.clearStylePreset();
                return;
            }

            // 3. 背景颜色 Preset 按钮代理
            const bgBtn = target.closest(".bg-color-btn") as HTMLElement | null;
            if (bgBtn) {
                const hex = bgBtn.getAttribute("data-hex") || "";
                this.setBgColor(hex, true);
                this.updateActiveBgUI(hex);
                this.clearStylePreset();
                return;
            }

            // 4. 恢复默认字色按钮代理
            const resetTextBtn = target.closest("#btn-reset-text-color");
            if (resetTextBtn) {
                this.setTextColor("", true);
                this.updateActiveTextUI("");
                return;
            }

            // 5. 恢复默认背景色按钮代理
            const resetBgBtn = target.closest("#btn-reset-bg-color");
            if (resetBgBtn) {
                this.setBgColor("", true);
                this.updateActiveBgUI("");
                return;
            }
        });

        // 6. 自由文字 Color Picker 事件监听
        const textPicker = document.getElementById("custom-text-color-picker") as HTMLInputElement | null;
        if (textPicker) {
            textPicker.addEventListener("input", (e) => {
                const hex = (e.target as HTMLInputElement).value;
                this.setTextColor(hex, true);
                this.updateActiveTextUI(hex);
            });
        }

        // 7. 自由背景 Color Picker 事件监听
        const bgPicker = document.getElementById("custom-bg-color-picker") as HTMLInputElement | null;
        if (bgPicker) {
            bgPicker.addEventListener("input", (e) => {
                const hex = (e.target as HTMLInputElement).value;
                this.setBgColor(hex, true);
                this.updateActiveBgUI(hex);
            });
        }
    }

    /**
     * 设置全站主题强调色（--primary-color 与 --primary-color-rgb）。
     *
     * Args:
     *     hex (string): 十六进制颜色代码。
     *     rgb (string): RGB 颜色代码。
     *     save (boolean): 是否保存到 LocalStorage。
     */
    static setAccentColor(hex: string, rgb: string, save: boolean = true): void {
        document.body.style.setProperty("--primary-color", hex, "important");
        document.body.style.setProperty("--primary-color-rgb", rgb, "important");
        document.documentElement.style.setProperty("--primary-color", hex, "important");
        document.documentElement.style.setProperty("--primary-color-rgb", rgb, "important");

        if (save) {
            localStorage.setItem("ynufe_accent_hex", hex);
            localStorage.setItem("ynufe_accent_rgb", rgb);
        }
    }

    /**
     * 设置全站主文字颜色（--text-primary）。
     *
     * Args:
     *     hex (string): 十六进制颜色代码，为空则恢复自适应默认字色。
     *     save (boolean): 是否保存到 LocalStorage。
     */
    static setTextColor(hex: string, save: boolean = true): void {
        if (!hex) {
            document.body.style.removeProperty("--text-primary");
            document.documentElement.style.removeProperty("--text-primary");
            if (save) localStorage.removeItem("ynufe_text_color");
        } else {
            document.body.style.setProperty("--text-primary", hex, "important");
            document.documentElement.style.setProperty("--text-primary", hex, "important");
            if (save) localStorage.setItem("ynufe_text_color", hex);
        }
    }

    /**
     * 设置全站背景底色（--bg-color）并清除/覆盖渐变干涉。
     *
     * Args:
     *     hex (string): 十六进制颜色代码，为空则恢复系统默认自适应背景。
     *     save (boolean): 是否保存到 LocalStorage。
     */
    static setBgColor(hex: string, save: boolean = true): void {
        if (!hex) {
            document.body.style.removeProperty("--bg-color");
            document.body.style.removeProperty("--bg-gradient");
            document.documentElement.style.removeProperty("--bg-color");
            document.documentElement.style.removeProperty("--bg-gradient");
            if (save) localStorage.removeItem("ynufe_bg_color");
        } else {
            document.body.style.setProperty("--bg-color", hex, "important");
            document.body.style.setProperty("--bg-gradient", "none", "important");
            document.documentElement.style.setProperty("--bg-color", hex, "important");
            document.documentElement.style.setProperty("--bg-gradient", "none", "important");
            if (save) localStorage.setItem("ynufe_bg_color", hex);
        }
    }

    /**
     * 重置所有色彩个性化设置，恢复系统自适应默认值。
     */
    static resetColors(): void {
        document.body.style.removeProperty("--primary-color");
        document.body.style.removeProperty("--primary-color-rgb");
        document.body.style.removeProperty("--text-primary");
        document.body.style.removeProperty("--bg-color");
        document.body.style.removeProperty("--bg-gradient");
        document.documentElement.style.removeProperty("--primary-color");
        document.documentElement.style.removeProperty("--primary-color-rgb");
        document.documentElement.style.removeProperty("--text-primary");
        document.documentElement.style.removeProperty("--bg-color");
        document.documentElement.style.removeProperty("--bg-gradient");

        localStorage.removeItem("ynufe_accent_hex");
        localStorage.removeItem("ynufe_accent_rgb");
        localStorage.removeItem("ynufe_text_color");
        localStorage.removeItem("ynufe_bg_color");

        this.updateActiveAccentUI("#3b82f6");
        this.updateActiveTextUI("");
        this.updateActiveBgUI("");
    }

    /**
     * 更新强调色按钮 UI 的选中状态。
     */
    private static updateActiveAccentUI(activeHex: string): void {
        document.querySelectorAll(".accent-color-btn").forEach(btn => {
            const hex = btn.getAttribute("data-hex");
            if (hex?.toLowerCase() === activeHex.toLowerCase()) {
                btn.classList.add("active");
            } else {
                btn.classList.remove("active");
            }
        });
    }

    /**
     * 更新字色按钮 UI 的选中状态。
     */
    private static updateActiveTextUI(activeHex: string): void {
        document.querySelectorAll(".text-color-btn").forEach(btn => {
            const hex = btn.getAttribute("data-hex") || "";
            if (hex.toLowerCase() === activeHex.toLowerCase()) {
                btn.classList.add("active");
            } else {
                btn.classList.remove("active");
            }
        });

        const picker = document.getElementById("custom-text-color-picker") as HTMLInputElement | null;
        if (picker && activeHex) {
            picker.value = activeHex;
        }
    }

    /**
     * 更新背景色按钮 UI 的选中状态。
     */
    private static updateActiveBgUI(activeHex: string): void {
        document.querySelectorAll(".bg-color-btn").forEach(btn => {
            const hex = btn.getAttribute("data-hex") || "";
            if (hex.toLowerCase() === activeHex.toLowerCase()) {
                btn.classList.add("active");
            } else {
                btn.classList.remove("active");
            }
        });

        const picker = document.getElementById("custom-bg-color-picker") as HTMLInputElement | null;
        if (picker && activeHex) {
            picker.value = activeHex;
        }
    }
}
