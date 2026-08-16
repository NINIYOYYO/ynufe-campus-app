/**
 * 教务网表格解析公用工具。
 *
 * 强智教务系统的列顺序会随版本/学校配置变动，硬编码 tds[4] 这类下标一旦错位
 * 不会报错，只会静默显示错误数据。这里提供「按表头名取列」的能力，并用 ParseError
 * 把「页面结构变了」和「确实没有数据」区分开。
 */

/**
 * ParseError: 页面结构无法识别。
 *
 * 与「查询结果为空」严格区分——后者是正常业务状态，前者说明教务系统改版或
 * 返回了非预期页面，必须让用户看见，而不是伪装成一个空列表。
 */
export class ParseError extends Error {
    constructor(module: string, detail: string) {
        super(`[${module}] ${detail}`);
        this.name = "ParseError";
    }
}

/** 教务网在无数据时会渲染的占位文案 */
const EMPTY_MARKERS = ["未查询到数据", "暂无数据", "没有找到", "无查询结果"];

/**
 * 判断页面是否带有「确实没有数据」的明确标记。
 *
 * Args:
 *     text (string): 页面文本或 HTML。
 *
 * Returns:
 *     boolean: 命中任一空数据占位文案则为 true。
 */
export function hasEmptyMarker(text: string): boolean {
    return EMPTY_MARKERS.some(m => text.includes(m));
}

/**
 * 从表格的第一行表头构建「表头文字 → 列下标」映射。
 *
 * Args:
 *     table (Element): 目标表格元素。
 *
 * Returns:
 *     Record<string, number>: 表头名到列下标的映射；无 th 表头时返回空对象。
 */
export function buildHeaderIndex(table: Element): Record<string, number> {
    const map: Record<string, number> = {};
    const rows = table.querySelectorAll("tr");

    for (let i = 0; i < rows.length; i++) {
        const ths = rows[i].querySelectorAll("th");
        if (ths.length === 0) continue;

        let colIndex = 0;
        for (let c = 0; c < ths.length; c++) {
            const key = ths[c].textContent?.trim() || "";
            const span = parseInt(ths[c].getAttribute("colspan") || "1", 10) || 1;
            if (key && map[key] === undefined) map[key] = colIndex;
            colIndex += span;
        }
        break; // 只取第一行表头（等级考试那类合并双表头由调用方自行按位处理）
    }
    return map;
}

/**
 * 解析复合多行表头（支持 rowspan 与 colspan 网格展开），
 * 生成每个数据列的复合表头全路径名称数组。
 *
 * Args:
 *     table (Element): 包含 thead/tr/th 的表格元素。
 *
 * Returns:
 *     string[]: 每个数据列对应展平后的表头组合名称列表。
 */
export function buildMultiRowHeaderColumns(table: Element): string[] {
    const rows = table.querySelectorAll("tr");
    const headerRows: Element[] = [];

    for (let i = 0; i < rows.length; i++) {
        if (rows[i].querySelectorAll("th").length > 0) {
            headerRows.push(rows[i]);
        }
    }

    if (headerRows.length === 0) return [];

    const grid: string[][] = [];
    for (let r = 0; r < headerRows.length; r++) {
        const ths = headerRows[r].querySelectorAll("th");
        let col = 0;

        for (let c = 0; c < ths.length; c++) {
            while (grid[r] && grid[r][col] !== undefined) {
                col++;
            }

            const text = ths[c].textContent?.trim() || "";
            const rowspan = parseInt(ths[c].getAttribute("rowspan") || "1", 10) || 1;
            const colspan = parseInt(ths[c].getAttribute("colspan") || "1", 10) || 1;

            for (let dr = 0; dr < rowspan; dr++) {
                const targetRow = r + dr;
                if (!grid[targetRow]) grid[targetRow] = [];
                for (let dc = 0; dc < colspan; dc++) {
                    const targetCol = col + dc;
                    grid[targetRow][targetCol] = text;
                }
            }
            col += colspan;
        }
    }

    const maxCols = Math.max(...grid.map(row => row.length), 0);
    const result: string[] = [];

    for (let c = 0; c < maxCols; c++) {
        const parts: string[] = [];
        for (let r = 0; r < grid.length; r++) {
            const cell = grid[r] ? grid[r][c] : undefined;
            if (cell && !parts.includes(cell)) {
                parts.push(cell);
            }
        }
        result.push(parts.join("_"));
    }

    return result;
}

/**
 * 按表头名解析列下标，全部匹配不到时回退到硬编码下标。
 *
 * Args:
 *     map (Record<string, number>): buildHeaderIndex 的结果。
 *     names (string[]): 候选表头名（按优先级排列）。
 *     fallback (number): 兜底列下标。
 *
 * Returns:
 *     number: 最终采用的列下标。
 */
export function pickIndex(map: Record<string, number>, names: string[], fallback: number): number {
    for (const n of names) {
        if (map[n] !== undefined) return map[n];
    }
    return fallback;
}

/**
 * 按表头名取单元格文本。
 *
 * Args:
 *     tds (ArrayLike<Element>): 当前数据行的单元格集合。
 *     map (Record<string, number>): 表头映射。
 *     names (string[]): 候选表头名。
 *     fallback (number): 兜底列下标。
 *
 * Returns:
 *     string: 去空白后的单元格文本；越界时返回空串。
 */
export function cellText(
    tds: ArrayLike<Element>,
    map: Record<string, number>,
    names: string[],
    fallback: number
): string {
    const idx = pickIndex(map, names, fallback);
    const cell = tds[idx];
    return cell ? cell.textContent?.trim() || "" : "";
}

/**
 * 在候选选择器中挑出「实际含数据行最多」的表格。
 *
 * 教务网存在同一页面多个相同 id 表格的情况（如空教室查询有两个 id="dataList"，
 * 靠前的那个是空壳），直接 querySelector 会拿到错误的表。
 *
 * Args:
 *     doc (Document): 文档对象。
 *     selectors (string): 逗号分隔的候选选择器。
 *
 * Returns:
 *     Element | null: 行数最多的表格；一个都没有则为 null。
 */
export function pickRichestTable(doc: Document, selectors: string): Element | null {
    let best: Element | null = null;
    let maxRows = 0;

    doc.querySelectorAll(selectors).forEach(t => {
        const n = t.querySelectorAll("tr").length;
        if (n > maxRows) {
            maxRows = n;
            best = t;
        }
    });
    return best;
}
