import { escapeHtml } from '../utils/escapeHtml';

/**
 * CustomSelect: 全局 iOS 风格精美毛玻璃自定义下拉菜单组件
 * 职责：替代浏览器原生点开后黑边尖角、白底蓝条的硬沉 <select><option> 弹出框，
 * 渲染带纯实心防透背景、优雅圆角、暗光阴影与打勾高亮徽章的自适应浮层，并保持原生 change 事件无缝触发。
 */
export class CustomSelect {
    private static menuMap = new WeakMap<HTMLSelectElement, HTMLElement>();
    private static observerMap = new WeakMap<HTMLSelectElement, MutationObserver>();

    /**
     * 将指定的原生 <select> 节点增强包装为 iOS 风格毛玻璃自定义下拉菜单。
     *
     * Args:
     *     selectEl (HTMLSelectElement): 需要增强的原生 HTMLSelectElement 节点。
     */
    static enhance(selectEl: HTMLSelectElement): void {
        if (!selectEl) return;
        if (selectEl.dataset.customEnhanced === "true") {
            this.updateMenuOptions(selectEl);
            return;
        }

        selectEl.dataset.customEnhanced = "true";

        // 创建包裹容器
        const wrapper = document.createElement("div");
        wrapper.className = "custom-select-wrapper";
        if (selectEl.id) wrapper.classList.add(`wrapper-${selectEl.id}`);

        // 将原 select 隐形但保留在 DOM 中（供表单提交和事件监听）
        selectEl.style.display = "none";
        selectEl.parentNode?.insertBefore(wrapper, selectEl);
        wrapper.appendChild(selectEl);

        // 创建触发按钮 (Trigger Button)
        const trigger = document.createElement("div");
        trigger.className = "custom-select-trigger";
        
        const textSpan = document.createElement("span");
        textSpan.className = "custom-select-text";
        textSpan.innerText = selectEl.options[selectEl.selectedIndex]?.text || selectEl.value || "请选择";

        const arrowSvg = document.createElement("div");
        arrowSvg.className = "custom-select-arrow";
        arrowSvg.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>`;

        trigger.appendChild(textSpan);
        trigger.appendChild(arrowSvg);
        wrapper.appendChild(trigger);

        // 创建浮层菜单并挂载至 body，通过 WeakMap 维护持久引用避免 DOM 丢失
        const menu = document.createElement("div");
        menu.className = "custom-select-menu";
        if (selectEl.id) menu.dataset.selectId = selectEl.id;
        document.body.appendChild(menu);

        this.menuMap.set(selectEl, menu);

        // 构建下拉选项列表
        this.buildMenuOptions(selectEl, wrapper, trigger, menu, textSpan);

        // 点击 Trigger 打开/关闭菜单
        trigger.addEventListener("click", (e: MouseEvent) => {
            e.stopPropagation();
            const isOpen = menu.classList.contains("active");
            CustomSelect.closeAll();
            if (!isOpen) {
                this.buildMenuOptions(selectEl, wrapper, trigger, menu, textSpan);

                // 动态计算在视口中的定位，挂载至 document.body 规避父容器裁切与指针阻断
                const rect = trigger.getBoundingClientRect();
                menu.style.position = "fixed";
                menu.style.top = `${rect.bottom + 4}px`;
                menu.style.left = `${rect.left}px`;
                menu.style.width = `${rect.width}px`;
                menu.style.zIndex = "999999";

                requestAnimationFrame(() => {
                    menu.classList.add("active");
                    trigger.classList.add("active");
                    wrapper.classList.add("active-wrapper");
                });
            }
        });

        // 监听原生 select 变化（例如外部代码通过 JS 修改了 select.value）
        selectEl.addEventListener("change", () => {
            const selectedOpt = selectEl.options[selectEl.selectedIndex];
            if (selectedOpt) {
                textSpan.innerText = selectedOpt.text;
            }
        });

        // 监听 MutationObserver 处理动态增删的 option
        const observer = new MutationObserver(() => {
            this.updateMenuOptions(selectEl);
        });
        observer.observe(selectEl, { childList: true, subtree: true });
        this.observerMap.set(selectEl, observer);
    }

    /**
     * 重新更新并重新渲染指定 select 的下拉选项卡。
     *
     * Args:
     *     selectEl (HTMLSelectElement): 目标 select 节点。
     */
    static updateMenuOptions(selectEl: HTMLSelectElement): void {
        if (!selectEl) return;
        const wrapper = selectEl.closest(".custom-select-wrapper") as HTMLElement | null;
        if (!wrapper) return;

        const trigger = wrapper.querySelector(".custom-select-trigger") as HTMLElement | null;
        const textSpan = wrapper.querySelector(".custom-select-text") as HTMLElement | null;
        const menu = this.menuMap.get(selectEl) || (wrapper.querySelector(".custom-select-menu") as HTMLElement | null) || (document.querySelector(`.custom-select-menu[data-select-id="${selectEl.id}"]`) as HTMLElement | null);

        if (trigger && textSpan) {
            const selectedOpt = selectEl.options[selectEl.selectedIndex];
            textSpan.innerText = selectedOpt ? selectedOpt.text : (selectEl.value || "请选择");
            if (menu) {
                this.buildMenuOptions(selectEl, wrapper, trigger, menu, textSpan);
            }
        }
    }

    /**
     * 动态构建并渲染浮层内部的选项节点列表。
     *
     * Args:
     *     selectEl (HTMLSelectElement): 原生 select 节点。
     *     wrapper (HTMLElement): 容器节点。
     *     trigger (HTMLElement): 触发器节点。
     *     menu (HTMLElement): 下拉菜单浮层节点。
     *     textSpan (HTMLElement): 显示文案节点。
     */
    private static buildMenuOptions(
        selectEl: HTMLSelectElement,
        wrapper: HTMLElement,
        trigger: HTMLElement,
        menu: HTMLElement,
        textSpan: HTMLElement
    ): void {
        menu.innerHTML = "";
        if (selectEl.id) menu.dataset.selectId = selectEl.id;

        Array.from(selectEl.options).forEach((opt, idx) => {
            const item = document.createElement("div");
            item.className = "custom-select-option";
            if (opt.selected || selectEl.selectedIndex === idx) {
                item.classList.add("selected");
            }

            item.innerHTML = `
                <span>${escapeHtml(opt.text)}</span>
                <span class="check-mark"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>
            `;

            item.addEventListener("click", (e: MouseEvent) => {
                e.stopPropagation();

                // 精准同步原生 select 的 selected 属性与 value 属性
                Array.from(selectEl.options).forEach((o, i) => {
                    o.selected = (i === idx);
                });
                selectEl.selectedIndex = idx;
                selectEl.value = opt.value;
                textSpan.innerText = opt.text;

                // 向原生 select 强发原生 change 事件驱动业务逻辑
                selectEl.dispatchEvent(new Event("change", { bubbles: true }));

                CustomSelect.closeAll();
            });

            menu.appendChild(item);
        });
    }

    /**
     * 关闭页面上所有当前打开的自定义下拉菜单浮层（仅移除 active 类，不销毁 DOM 节点）。
     */
    static closeAll(): void {
        document.querySelectorAll(".custom-select-menu.active").forEach(m => {
            m.classList.remove("active");
        });
        document.querySelectorAll(".custom-select-trigger.active").forEach(t => t.classList.remove("active"));
        document.querySelectorAll(".custom-select-wrapper.active-wrapper").forEach(w => w.classList.remove("active-wrapper"));
    }

    /**
     * 自动扫描页面并增强所有原生 select 下拉菜单。
     */
    static enhanceAll(): void {
        const selects = document.querySelectorAll("select");
        selects.forEach(sel => {
            if (sel instanceof HTMLSelectElement) {
                this.enhance(sel);
            }
        });

        // 监听全局点击与滚动事件，点击空白处或滚动页面时自动收起浮层
        const win = window as unknown as { _customSelectGlobalClickBound?: boolean };
        if (!win._customSelectGlobalClickBound) {
            win._customSelectGlobalClickBound = true;
            document.addEventListener("click", () => {
                CustomSelect.closeAll();
            });
            window.addEventListener("scroll", () => {
                CustomSelect.closeAll();
            }, { passive: true });
        }
    }
}
