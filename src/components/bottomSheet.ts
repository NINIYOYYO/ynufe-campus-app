/**
 * iOS 风格底部抽屉 (BottomSheet) 手势拖拽与通用无障碍浮层组件
 */
export class BottomSheet {
    private static currentY = 0;
    private static startY = 0;
    private static isDragging = false;

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
        const overlay = document.getElementById("sheet-overlay");

        if (titleEl) titleEl.innerText = title;
        if (tagEl) {
            tagEl.innerText = tagText;
            tagEl.style.display = tagText ? "inline-block" : "none";
        }
        if (bodyEl) bodyEl.innerHTML = contentHtml;

        if (sheet) {
            sheet.style.transform = "translateY(0)";
            sheet.style.display = "flex";
            sheet.classList.add("active");
        }
        if (overlay) {
            overlay.style.display = "block";
            overlay.classList.add("active");
        }
    }

    /**
     * 平滑隐藏底部抽屉浮层。
     */
    static hide(): void {
        const sheet = document.getElementById("bottom-sheet");
        const overlay = document.getElementById("sheet-overlay");

        if (sheet) {
            sheet.style.transform = "translateY(100%)";
            sheet.classList.remove("active");
            setTimeout(() => {
                sheet.style.display = "none";
            }, 300);
        }
        if (overlay) {
            overlay.classList.remove("active");
            setTimeout(() => {
                overlay.style.display = "none";
            }, 300);
        }
    }

    /**
     * 绑定抽屉关闭按钮、遮罩层及触摸拖拽手势。
     */
    private static bindEvents(): void {
        const closeBtn = document.getElementById("btn-close-sheet");
        const overlay = document.getElementById("sheet-overlay");
        const handle = document.getElementById("sheet-handle");
        const sheet = document.getElementById("bottom-sheet");

        if (closeBtn) closeBtn.addEventListener("click", () => this.hide());
        if (overlay) overlay.addEventListener("click", () => this.hide());

        if (handle && sheet) {
            handle.addEventListener("touchstart", (e: TouchEvent) => {
                this.isDragging = true;
                this.startY = e.touches[0].clientY;
                this.currentY = 0;
            }, { passive: true });

            window.addEventListener("touchmove", (e: TouchEvent) => {
                if (!this.isDragging) return;
                const deltaY = e.touches[0].clientY - this.startY;
                if (deltaY > 0) {
                    this.currentY = deltaY;
                    sheet.style.transform = `translateY(${deltaY}px)`;
                }
            }, { passive: true });

            window.addEventListener("touchend", () => {
                if (!this.isDragging) return;
                this.isDragging = false;
                if (this.currentY > 120) {
                    this.hide();
                } else {
                    sheet.style.transform = "translateY(0)";
                }
            });
        }
    }
}
