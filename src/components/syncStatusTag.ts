export type SyncStatusState = "online" | "offline" | "syncing";

/**
 * 顶部数据同步与离线状态指示微标签组件
 */
export class SyncStatusTag {
    /**
     * 动态更新顶栏数据同步状态指示标签。
     *
     * Args:
     *     status (SyncStatusState): "online" | "offline" | "syncing" 状态标识。
     *     text (string): 标签显示的文本内容。
     */
    static update(status: SyncStatusState, text: string): void {
        const tag = document.getElementById("sync-status-tag");
        if (!tag) return;
        tag.className = `sync-tag ${status}`;
        const textDom = tag.querySelector(".sync-text") as HTMLElement | null;
        if (textDom) textDom.innerText = text;
    }
}
