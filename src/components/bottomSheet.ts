/**
 * iOS 风格底部抽屉 (BottomSheet)：可跟手拖拽，松手按二阶弹簧回弹或顺势关闭。
 *
 * 结构约定（index.html）：
 *   #bottom-sheet          全屏定位容器（visibility 开关）
 *   ├─ #sheet-overlay      遮罩（透明度过渡，原地淡入淡出）
 *   └─ .sheet-content      抽屉本体（transform 滑入滑出，拖拽也作用于它）
 *       ├─ .sheet-handle   拖拽把手
 *       └─ .sheet-header   标题栏（同为拖拽起始区）
 *
 * 注意：拖拽必须作用在 .sheet-content 上而非全屏容器——旧实现把 transform
 * 打在容器上，关闭时遮罩会跟着抽屉一起滑走；且旧实现按 id 查找把手
 * （页面里只有同名 class），手势从未真正生效过。
 */
export class BottomSheet {
    /** 拖拽状态 */
    private static isDragging = false;
    private static startY = 0;
    private static currentY = 0;
    /** 速度采样（用于甩动关闭判定与弹簧初速度） */
    private static lastY = 0;
    private static lastT = 0;
    private static velocity = 0;
    /** 弹簧动画帧句柄，重入时用于中断上一轮 */
    private static springRaf = 0;

    /** 甩动关闭的速度阈值 (px/ms) */
    private static readonly FLICK_VELOCITY = 0.8;
    /** 位移关闭阈值：拖过抽屉高度的这一比例即关闭 */
    private static readonly DISMISS_RATIO = 0.35;

    /**
     * 初始化底部抽屉事件监听器。
     */
    static init(): void {
        this.bindEvents();
    }

    /**
     * 弹出显示底部抽屉并装填标题与 HTML 内容。
     *
     * Args:
     *     title (string): 抽屉顶栏标题。
     *     tagText (string): 标签微文本。
     *     contentHtml (string): 抽屉内部 DOM HTML 字符串。
     */
    static show(title: string, tagText: string, contentHtml: string): void {
        const sheet = document.getElementById("bottom-sheet");
        const titleEl = document.getElementById("sheet-title");
        const tagEl = document.getElementById("sheet-tag");
        const bodyEl = document.getElementById("sheet-body-content");
        const content = sheet?.querySelector<HTMLElement>(".sheet-content") || null;

        if (titleEl) titleEl.innerText = title;
        if (tagEl) {
            tagEl.innerText = tagText;
            tagEl.style.display = tagText ? "inline-block" : "none";
        }
        if (bodyEl) bodyEl.innerHTML = contentHtml;

        if (content) {
            // 清掉上一次拖拽/关闭残留的内联样式，让 .active 的过渡接管入场
            this.cancelSpring();
            content.style.transition = "";
            content.style.transform = "";
            content.scrollTop = 0;
        }
        if (sheet) {
            sheet.style.display = "block";
            // 强制 reflow，确保 display 生效后再加 active，过渡才会播放
            void sheet.offsetWidth;
            sheet.classList.add("active");
        }
    }

    /**
     * 等待入场滑动过渡结束。
     *
     * 异步装填的抽屉（如公告详情）必须等入场动画播完再替换正文：
     * 入场用的 translateY(100%) 是按元素自身高度解析的百分比，正文一换、
     * 高度突变，进行中的过渡起点会被重新解释，观感上像动画重播了一次。
     *
     * Returns:
     *     Promise<void>: transform 过渡结束（或 400ms 兜底超时）后 resolve。
     *     抽屉已经静止时依赖兜底超时，不会悬挂。
     */
    static settled(): Promise<void> {
        return new Promise(resolve => {
            const sheet = document.getElementById("bottom-sheet");
            const content = sheet?.querySelector<HTMLElement>(".sheet-content") || null;
            if (!sheet || !content || !sheet.classList.contains("active")) {
                resolve();
                return;
            }

            let done = false;
            const finish = () => {
                if (done) return;
                done = true;
                content.removeEventListener("transitionend", onEnd);
                resolve();
            };
            const onEnd = (e: TransitionEvent) => {
                if (e.propertyName === "transform") finish();
            };
            content.addEventListener("transitionend", onEnd);
            window.setTimeout(finish, 400); // 过渡 0.3s，余量兜底（含过渡已结束的情形）
        });
    }

    /**
     * 平滑隐藏底部抽屉浮层（遮罩原地淡出，抽屉本体下滑）。
     */
    static hide(): void {
        const sheet = document.getElementById("bottom-sheet");
        if (!sheet) return;
        const content = sheet.querySelector<HTMLElement>(".sheet-content");

        this.cancelSpring();
        if (content) {
            // 从拖拽中途关闭时内联 transform 存在，恢复过渡并显式滑出，
            // 保证从当前位置连续动画到屏幕外
            content.style.transition = "";
            content.style.transform = "translateY(100%)";
        }
        sheet.classList.remove("active");
        window.setTimeout(() => {
            sheet.style.display = "none";
            if (content) content.style.transform = "";
        }, 300);
    }

    /**
     * 中断进行中的弹簧回弹动画。
     */
    private static cancelSpring(): void {
        if (this.springRaf) {
            cancelAnimationFrame(this.springRaf);
            this.springRaf = 0;
        }
    }

    /**
     * 松手后以二阶弹簧振子 (F = -kx - cv) 把抽屉弹回原位。
     *
     * Args:
     *     content (HTMLElement): 抽屉本体。
     *     fromY (number): 松手时的位移 (px)。
     *     initialVelocity (number): 松手时的速度 (px/帧，向下为正)。
     */
    private static springBack(content: HTMLElement, fromY: number, initialVelocity: number): void {
        this.cancelSpring();
        let y = fromY;
        let v = initialVelocity;

        const step = () => {
            // 刚度与阻尼按 60FPS 每帧积分（参数手感：快速收敛、末端一次微小回弹）
            const a = -0.08 * y - 0.22 * v;
            v += a;
            y += v;

            if (Math.abs(y) < 0.4 && Math.abs(v) < 0.4) {
                content.style.transform = "";
                content.style.transition = "";
                this.springRaf = 0;
                return;
            }
            content.style.transform = `translateY(${y.toFixed(2)}px)`;
            this.springRaf = requestAnimationFrame(step);
        };
        this.springRaf = requestAnimationFrame(step);
    }

    /**
     * 绑定抽屉关闭按钮、遮罩层及触摸拖拽手势。
     */
    private static bindEvents(): void {
        const closeBtn = document.getElementById("btn-close-sheet");
        const overlay = document.getElementById("sheet-overlay");
        const sheet = document.getElementById("bottom-sheet");
        const content = sheet?.querySelector<HTMLElement>(".sheet-content") || null;

        if (closeBtn) closeBtn.addEventListener("click", () => this.hide());
        if (overlay) overlay.addEventListener("click", () => this.hide());
        if (!sheet || !content) return;

        /**
         * 判断触点是否落在拖拽起始区（把手或标题栏）。
         * 正文区要保留原生滚动，不能整面接管。
         */
        const inDragZone = (target: EventTarget | null): boolean => {
            if (!(target instanceof Element)) return false;
            return !!target.closest(".sheet-handle, .sheet-header");
        };

        content.addEventListener("touchstart", (e: TouchEvent) => {
            if (!inDragZone(e.target)) return;
            this.cancelSpring();
            this.isDragging = true;
            this.startY = e.touches[0].clientY;
            this.lastY = this.startY;
            this.lastT = e.timeStamp;
            this.velocity = 0;
            this.currentY = 0;
            content.style.transition = "none"; // 拖拽期间禁掉过渡，保证 1:1 跟手
        }, { passive: true });

        window.addEventListener("touchmove", (e: TouchEvent) => {
            if (!this.isDragging) return;
            const touchY = e.touches[0].clientY;
            const dt = e.timeStamp - this.lastT;
            if (dt > 0) this.velocity = (touchY - this.lastY) / dt; // px/ms，向下为正
            this.lastY = touchY;
            this.lastT = e.timeStamp;

            const deltaY = touchY - this.startY;
            // 向下 1:1 跟手；向上做橡皮筋阻尼——能拉动但拉不远，传达"到头了"
            this.currentY = deltaY >= 0 ? deltaY : -Math.pow(-deltaY, 0.72);
            content.style.transform = `translateY(${this.currentY.toFixed(2)}px)`;
        }, { passive: true });

        window.addEventListener("touchend", () => {
            if (!this.isDragging) return;
            this.isDragging = false;

            const dismissDistance = content.offsetHeight * this.DISMISS_RATIO;
            const flicked = this.velocity > this.FLICK_VELOCITY && this.currentY > 24;

            if (this.currentY > dismissDistance || flicked) {
                this.hide();
            } else {
                // 速度从 px/ms 折算为 px/帧（60FPS ≈ 16.7ms/帧）作为弹簧初速度
                this.springBack(content, this.currentY, this.velocity * 16.7);
            }
            this.currentY = 0;
        });
    }
}
