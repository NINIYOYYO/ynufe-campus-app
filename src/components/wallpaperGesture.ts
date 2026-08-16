import { StorageKeys } from '../config/storageKeys';
import { CacheService } from '../services/cacheService';

export interface WallpaperTransformState {
    scale: number;
    x: number;
    y: number;
}

/**
 * WallpaperGesture: 全手机级壁纸手势平移、双指缩放及变换矩阵控制器
 */
export class WallpaperGesture {
    public static transformState: WallpaperTransformState = { scale: 1.0, x: 0, y: 0 };
    private static backupState: WallpaperTransformState = { scale: 1.0, x: 0, y: 0 };

    /**
     * 将 Transform 变换应用到壁纸 HTMLImageElement。
     */
    static applyTransform(): void {
        const imgEl = document.getElementById("wallpaper-img");
        if (imgEl) {
            imgEl.style.transform = `translate(${this.transformState.x}px, ${this.transformState.y}px) scale(${this.transformState.scale})`;
        }
    }

    /**
     * 从 CacheService 读取并恢复之前保存的壁纸手势参数。
     */
    static loadSavedTransform(): void {
        const savedState = CacheService.get<WallpaperTransformState>(StorageKeys.WALLPAPER_TRANSFORM);
        if (savedState && typeof savedState.scale === "number" && typeof savedState.x === "number" && typeof savedState.y === "number") {
            this.transformState = savedState;
            this.applyTransform();
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
        CacheService.remove(StorageKeys.WALLPAPER_TRANSFORM);
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

        btnEnterAdjust.addEventListener("click", (e) => {
            e.stopPropagation();
            this.backupState = { ...this.transformState };

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

        adjustOverlay.addEventListener("wheel", (e: WheelEvent) => {
            e.preventDefault();
            const factor = e.deltaY < 0 ? 1.05 : 0.95;
            this.transformState.scale = Math.min(Math.max(this.transformState.scale * factor, 0.5), 5.0);
            this.applyTransform();
        }, { passive: false });

        btnSaveAdjust.addEventListener("click", () => {
            CacheService.set(StorageKeys.WALLPAPER_TRANSFORM, this.transformState);
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

        window.addEventListener("resize", () => {
            this.setupWallpaperImageDimensions();
        });
    }
}
