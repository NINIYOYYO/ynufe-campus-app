import { ColorExtractor, RGBColor } from '../utils/colorExtractor';

export interface WallpaperTransformState {
    scale: number;
    x: number;
    y: number;
}

/**
 * 自定义壁纸、高斯模糊、蒙版透明度与全手机级手势平移缩放管理器
 */
export class WallpaperManager {
    private static transformState: WallpaperTransformState = { scale: 1.0, x: 0, y: 0 };
    private static backupState: WallpaperTransformState = { scale: 1.0, x: 0, y: 0 };

    /**
     * 初始化壁纸系统，绑定相册上传/微调事件并加载本地缓存及手势引擎。
     */
    static init(): void {
        this.bindEvents();
        this.loadSavedWallpaper();
        this.initWallpaperGestureAdjust();
    }

    /**
     * 计算壁纸图片在手机屏幕比例下的最合适无损全屏尺寸（防拉伸与预剪切）。
     */
    static setupWallpaperImageDimensions(): void {
        const imgEl = document.getElementById("wallpaper-img") as HTMLImageElement | null;
        if (!imgEl || imgEl.style.display === "none") return;

        const sw = window.innerWidth;
        const sh = window.innerHeight;
        const nw = imgEl.naturalWidth || 1080;
        const nh = imgEl.naturalHeight || 1920;

        const screenRatio = sw / sh;
        const imgRatio = nw / nh;
        let w: number, h: number;

        if (imgRatio > screenRatio) {
            h = sh;
            w = sh * imgRatio;
        } else {
            w = sw;
            h = sw / imgRatio;
        }

        imgEl.style.width = `${w}px`;
        imgEl.style.height = `${h}px`;
        imgEl.style.marginLeft = `${-(w / 2)}px`;
        imgEl.style.marginTop = `${-(h / 2)}px`;
    }

    /**
     * 将 Transform 变换应用到壁纸 HTMLImageElement。
     */
    private static applyTransform(): void {
        const imgEl = document.getElementById("wallpaper-img");
        if (imgEl) {
            imgEl.style.transform = `translate(${this.transformState.x}px, ${this.transformState.y}px) scale(${this.transformState.scale})`;
        }
    }

    /**
     * 从 LocalStorage 读取并恢复之前保存的壁纸手势参数。
     */
    static loadSavedTransform(): void {
        const savedStateStr = localStorage.getItem("ynufe_wallpaper_transform");
        if (savedStateStr) {
            try {
                this.transformState = JSON.parse(savedStateStr);
                this.applyTransform();
            } catch (e) {
                console.error("[WallpaperManager] Failed to parse saved transform:", e);
            }
        } else {
            this.transformState = { scale: 1.0, x: 0, y: 0 };
            this.applyTransform();
        }
    }

    /**
     * 重置壁纸缩放比例与拖拽偏移量。
     */
    static resetTransform(): void {
        this.transformState = { scale: 1.0, x: 0, y: 0 };
        this.applyTransform();
        localStorage.removeItem("ynufe_wallpaper_transform");
    }

    /**
     * 根据提取的壁纸主色调动态应用全界面自适应 Accent 色彩与主题深浅适配。
     *
     * Args:
     *     themeName (string, optional): 当前主题模式 "dark" | "light"。
     */
    static applyAdaptiveWallpaperColor(themeName?: string): void {
        const savedPreset = localStorage.getItem("ynufe_wallpaper_preset") || "obsidian";
        if (savedPreset !== "custom") return;

        const savedColorStr = localStorage.getItem("ynufe_wallpaper_color");
        if (!savedColorStr) return;

        try {
            const rgb: RGBColor = JSON.parse(savedColorStr);
            const r = rgb.r;
            const g = rgb.g;
            const b = rgb.b;

            const body = document.body;
            const currentTheme = themeName || (body.classList.contains("theme-light") ? "light" : "dark");

            if (currentTheme === "light") {
                const maxVal = Math.max(r, g, b);
                const targetMax = 135;
                const k = maxVal > targetMax ? targetMax / maxVal : 1.0;
                const darkR = Math.round(r * k);
                const darkG = Math.round(g * k);
                const darkB = Math.round(b * k);
                body.style.setProperty("--primary-color-rgb", `${darkR}, ${darkG}, ${darkB}`);
                body.style.setProperty("--wallpaper-dark-rgb", `240, 243, 250`);
            } else {
                body.style.setProperty("--primary-color-rgb", `${r}, ${g}, ${b}`);
                const cardDarkR = Math.round(r * 0.22 + 8);
                const cardDarkG = Math.round(g * 0.22 + 8);
                const cardDarkB = Math.round(b * 0.22 + 8);
                body.style.setProperty("--wallpaper-dark-rgb", `${cardDarkR}, ${cardDarkG}, ${cardDarkB}`);
            }
        } catch (e) {
            console.error("[WallpaperManager] Failed to parse wallpaper color:", e);
        }
    }

    /**
     * 清理自适应色彩 CSS 自定义属性。
     */
    static clearAdaptiveWallpaperColor(): void {
        document.body.style.removeProperty("--primary-color-rgb");
        document.body.style.removeProperty("--wallpaper-dark-rgb");
    }

    /**
     * 应用指定 Preset 预设或自定义图片壁纸。
     *
     * Args:
     *     presetName (string): 预设方案名称如 "custom" 或 "obsidian"。
     *     customBase64 (string, optional): 自定义图片的 Base64 文本。
     */
    static applyWallpaper(presetName: string, customBase64?: string): void {
        const body = document.body;
        const img = document.getElementById("wallpaper-img") as HTMLImageElement | null;
        if (!img) return;

        if (presetName === "custom" && customBase64) {
            body.classList.add("has-custom-wallpaper");
            img.style.display = "block";

            img.onload = () => {
                this.setupWallpaperImageDimensions();
                this.loadSavedTransform();
            };
            img.src = customBase64;

            if (img.complete) {
                this.setupWallpaperImageDimensions();
                this.loadSavedTransform();
            }

            this.applyAdaptiveWallpaperColor();
        } else {
            body.classList.remove("has-custom-wallpaper");
            img.removeAttribute("src");
            img.style.display = "none";
            this.clearAdaptiveWallpaperColor();
        }
    }

    /**
     * 读取并恢复本地存储的壁纸预设、自定义 Base64、高斯模糊及遮罩浓度。
     */
    static loadSavedWallpaper(): void {
        const savedPreset = localStorage.getItem("ynufe_wallpaper_preset") || "obsidian";
        const savedCustomData = localStorage.getItem("ynufe_custom_wallpaper");
        const savedBlur = localStorage.getItem("ynufe_wallpaper_blur") || "0";
        const savedMaskOpacity = localStorage.getItem("ynufe_wallpaper_mask_opacity") || "0.32";

        document.body.style.setProperty("--wallpaper-blur", `${savedBlur}px`);
        document.body.style.setProperty("--wallpaper-mask-opacity", savedMaskOpacity);

        const blurInput = document.getElementById("slider-wallpaper-blur") as HTMLInputElement | null;
        const maskInput = document.getElementById("slider-wallpaper-mask") as HTMLInputElement | null;
        if (blurInput) blurInput.value = savedBlur;
        if (maskInput) maskInput.value = (parseFloat(savedMaskOpacity) * 100).toString();

        const blurValText = document.getElementById("val-wallpaper-blur");
        const maskValText = document.getElementById("val-wallpaper-mask");
        if (blurValText) blurValText.innerText = `${savedBlur}px`;
        if (maskValText) maskValText.innerText = `${Math.round(parseFloat(savedMaskOpacity) * 100)}%`;

        const adjustSec = document.getElementById("wallpaper-adjust-section");
        const tuneSec = document.getElementById("wallpaper-tune-section");
        if (adjustSec) adjustSec.style.display = (savedPreset === "custom" && savedCustomData) ? "block" : "none";
        if (tuneSec) tuneSec.style.display = (savedPreset === "custom" && savedCustomData) ? "block" : "none";

        if (savedPreset === "custom" && savedCustomData) {
            this.applyWallpaper("custom", savedCustomData);
        } else {
            this.applyWallpaper(savedPreset);
        }
    }

    /**
     * 处理相册选取的壁纸文件，进行像素采样压缩及配色提取。
     *
     * Args:
     *     file (File): 用户选取的本地图像 File 对象。
     */
    static handleWallpaperUpload(file: File): void {
        if (!file.type.startsWith("image/")) {
            alert("请选择有效的图片文件！");
            return;
        }

        const statusText = document.getElementById("upload-status-text");
        if (statusText) {
            statusText.innerText = "正在读取并进行高保真压缩...";
            statusText.style.color = "var(--warning-color)";
        }

        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const bestColor = ColorExtractor.extractDominantColor(img);

                const canvas = document.createElement("canvas");
                const ctx = canvas.getContext("2d");
                const MAX_DIM = 1080;
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > MAX_DIM) {
                        height *= MAX_DIM / width;
                        width = MAX_DIM;
                    }
                } else {
                    if (height > MAX_DIM) {
                        width *= MAX_DIM / height;
                        height = MAX_DIM;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                if (ctx) ctx.drawImage(img, 0, 0, width, height);

                const compressedBase64 = canvas.toDataURL("image/jpeg", 0.7);

                try {
                    localStorage.setItem("ynufe_custom_wallpaper", compressedBase64);
                    localStorage.setItem("ynufe_wallpaper_preset", "custom");
                    localStorage.setItem("ynufe_wallpaper_color", JSON.stringify(bestColor));

                    this.applyWallpaper("custom", compressedBase64);

                    const adjustSec = document.getElementById("wallpaper-adjust-section");
                    const tuneSec = document.getElementById("wallpaper-tune-section");
                    if (adjustSec) adjustSec.style.display = "block";
                    if (tuneSec) tuneSec.style.display = "block";
                    this.resetTransform();

                    if (statusText) {
                        statusText.innerText = "自定义壁纸已成功保存，强调色已自适应更新";
                        statusText.style.color = "var(--accent-color)";
                    }
                } catch (err) {
                    console.error("[WallpaperManager] LocalStorage quota exceeded:", err);
                    if (statusText) {
                        statusText.innerText = "保存失败，照片过大请更换较小照片！";
                        statusText.style.color = "var(--error-color)";
                    }
                }
            };
            img.src = e.target?.result as string;
        };
    }

    /**
     * 绑定文件选择、重置按钮及高斯模糊/遮罩滑动调控事件。
     */
    private static bindEvents(): void {
        const fileInput = document.getElementById("wallpaper-file-input") as HTMLInputElement | null;
        if (fileInput) {
            fileInput.addEventListener("change", (e) => {
                const target = e.target as HTMLInputElement;
                if (target.files && target.files[0]) {
                    this.handleWallpaperUpload(target.files[0]);
                }
            });
        }

        const btnResetWallpaper = document.getElementById("btn-reset-wallpaper");
        if (btnResetWallpaper) {
            btnResetWallpaper.addEventListener("click", () => {
                localStorage.setItem("ynufe_wallpaper_preset", "obsidian");
                localStorage.removeItem("ynufe_custom_wallpaper");
                localStorage.removeItem("ynufe_wallpaper_color");
                localStorage.removeItem("ynufe_wallpaper_transform");
                const adjustSec = document.getElementById("wallpaper-adjust-section");
                const tuneSec = document.getElementById("wallpaper-tune-section");
                if (adjustSec) adjustSec.style.display = "none";
                if (tuneSec) tuneSec.style.display = "none";
                this.applyWallpaper("obsidian");
                const statusText = document.getElementById("upload-status-text");
                if (statusText) statusText.innerText = "背景及配色已成功恢复为默认宇宙曜黑！";
            });
        }

        const blurInput = document.getElementById("slider-wallpaper-blur") as HTMLInputElement | null;
        if (blurInput) {
            blurInput.addEventListener("input", (e) => {
                const val = (e.target as HTMLInputElement).value;
                document.body.style.setProperty("--wallpaper-blur", `${val}px`);
                localStorage.setItem("ynufe_wallpaper_blur", val);
                const text = document.getElementById("val-wallpaper-blur");
                if (text) text.innerText = `${val}px`;
            });
        }

        const maskInput = document.getElementById("slider-wallpaper-mask") as HTMLInputElement | null;
        if (maskInput) {
            maskInput.addEventListener("input", (e) => {
                const val = (e.target as HTMLInputElement).value;
                const opacity = (parseFloat(val) / 100).toFixed(2);
                document.body.style.setProperty("--wallpaper-mask-opacity", opacity);
                localStorage.setItem("ynufe_wallpaper_mask_opacity", opacity);
                const text = document.getElementById("val-wallpaper-mask");
                if (text) text.innerText = `${val}%`;
            });
        }
    }

    /**
     * 初始化全手机级壁纸手势拖拽、捏合缩放及遮罩控制面板。
     */
    static initWallpaperGestureAdjust(): void {
        const adjustOverlay = document.getElementById("wallpaper-adjust-overlay");
        const btnEnterAdjust = document.getElementById("btn-enter-wallpaper-adjust");
        const btnSaveAdjust = document.getElementById("btn-save-wallpaper-adjust");
        const btnCancelAdjust = document.getElementById("btn-cancel-wallpaper-adjust");
        const imgEl = document.getElementById("wallpaper-img");

        if (!adjustOverlay || !btnEnterAdjust || !btnSaveAdjust || !btnCancelAdjust || !imgEl) {
            return;
        }

        let startX = 0, startY = 0;
        let initialX = 0, initialY = 0;
        let isDragging = false;

        let isPinching = false;
        let initialDistance = 0;
        let initialScale = 1.0;

        // 绑定点击“调整壁纸大小和位置”按钮
        btnEnterAdjust.addEventListener("click", (e) => {
            e.stopPropagation();
            this.backupState = { ...this.transformState };

            // 自动收起设置菜单，腾出全屏视野
            const settingsSheet = document.getElementById("settings-sheet");
            const settingsOverlay = document.getElementById("settings-overlay");
            if (settingsSheet) {
                settingsSheet.style.transform = "translateY(100%)";
                settingsSheet.classList.remove("active");
                setTimeout(() => { settingsSheet.style.display = "none"; }, 300);
            }
            if (settingsOverlay) {
                settingsOverlay.classList.remove("active");
                setTimeout(() => { settingsOverlay.style.display = "none"; }, 300);
            }

            adjustOverlay.style.display = "block";
        });

        const getPinchDistance = (touches: TouchList): number => {
            const dx = touches[0].clientX - touches[1].clientX;
            const dy = touches[0].clientY - touches[1].clientY;
            return Math.sqrt(dx * dx + dy * dy);
        };

        // Touch 触控事件
        adjustOverlay.addEventListener("touchstart", (e: TouchEvent) => {
            if (e.touches.length === 1) {
                isDragging = true;
                isPinching = false;
                startX = e.touches[0].clientX;
                startY = e.touches[0].clientY;
                initialX = this.transformState.x;
                initialY = this.transformState.y;
            } else if (e.touches.length === 2) {
                isDragging = false;
                isPinching = true;
                initialDistance = getPinchDistance(e.touches);
                initialScale = this.transformState.scale;
            }
        });

        adjustOverlay.addEventListener("touchmove", (e: TouchEvent) => {
            e.preventDefault();
            if (isDragging && e.touches.length === 1) {
                const dx = e.touches[0].clientX - startX;
                const dy = e.touches[0].clientY - startY;
                this.transformState.x = initialX + dx;
                this.transformState.y = initialY + dy;
                this.applyTransform();
            } else if (isPinching && e.touches.length === 2) {
                const currentDistance = getPinchDistance(e.touches);
                if (initialDistance > 0) {
                    const factor = currentDistance / initialDistance;
                    this.transformState.scale = Math.min(Math.max(initialScale * factor, 0.5), 5.0);
                    this.applyTransform();
                }
            }
        }, { passive: false });

        adjustOverlay.addEventListener("touchend", () => {
            isDragging = false;
            isPinching = false;
        });

        // Mouse 鼠标事件 (兼容 PC 调试)
        adjustOverlay.addEventListener("mousedown", (e: MouseEvent) => {
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            initialX = this.transformState.x;
            initialY = this.transformState.y;
        });

        adjustOverlay.addEventListener("mousemove", (e: MouseEvent) => {
            if (isDragging) {
                const dx = e.clientX - startX;
                const dy = e.clientY - startY;
                this.transformState.x = initialX + dx;
                this.transformState.y = initialY + dy;
                this.applyTransform();
            }
        });

        window.addEventListener("mouseup", () => { isDragging = false; });

        // PC 滚轮缩放
        adjustOverlay.addEventListener("wheel", (e: WheelEvent) => {
            e.preventDefault();
            const factor = e.deltaY < 0 ? 1.05 : 0.95;
            this.transformState.scale = Math.min(Math.max(this.transformState.scale * factor, 0.5), 5.0);
            this.applyTransform();
        }, { passive: false });

        // 点击“保存位置”
        btnSaveAdjust.addEventListener("click", () => {
            localStorage.setItem("ynufe_wallpaper_transform", JSON.stringify(this.transformState));
            adjustOverlay.style.display = "none";
            const settingsSheet = document.getElementById("settings-sheet");
            const settingsOverlay = document.getElementById("settings-overlay");
            if (settingsSheet) {
                settingsSheet.style.transform = "translateY(0)";
                settingsSheet.style.display = "flex";
                settingsSheet.classList.add("active");
            }
            if (settingsOverlay) {
                settingsOverlay.style.display = "block";
                settingsOverlay.classList.add("active");
            }
        });

        // 点击“取消”
        btnCancelAdjust.addEventListener("click", () => {
            this.transformState = { ...this.backupState };
            this.applyTransform();
            adjustOverlay.style.display = "none";
            const settingsSheet = document.getElementById("settings-sheet");
            const settingsOverlay = document.getElementById("settings-overlay");
            if (settingsSheet) {
                settingsSheet.style.transform = "translateY(0)";
                settingsSheet.style.display = "flex";
                settingsSheet.classList.add("active");
            }
            if (settingsOverlay) {
                settingsOverlay.style.display = "block";
                settingsOverlay.classList.add("active");
            }
        });

        // 窗口 resize 监听
        window.addEventListener("resize", () => {
            this.setupWallpaperImageDimensions();
        });
    }
}
