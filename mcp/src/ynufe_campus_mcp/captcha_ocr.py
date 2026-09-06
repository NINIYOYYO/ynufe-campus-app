#!/usr/bin/env python3
"""云财教务系统验证码 OCR - 移植自 NINIYOYYO/ynufe-campus-app (captchaOcr.ts)
MIT License, 原作者 NINIYOYYO
"""
import base64
from collections import deque

from .captcha_templates_data import PACKED_TEMPLATES

CANVAS_WIDTH = 14
CANVAS_HEIGHT = 36

_decoded_cache = None


def _decode_base64_template(b64: str):
    """63字节Base64 -> 36行 每行14位 行掩码"""
    binary = base64.b64decode(b64)
    bits = []
    for byte in binary:
        for shift in range(7, -1, -1):
            bits.append((byte >> shift) & 1)
    rows = []
    for y in range(CANVAS_HEIGHT):
        row_val = 0
        for x in range(CANVAS_WIDTH):
            if bits[y * CANVAS_WIDTH + x] == 1:
                row_val |= (1 << (CANVAS_WIDTH - 1 - x))
        rows.append(row_val)
    return rows


def get_templates():
    global _decoded_cache
    if _decoded_cache is None:
        _decoded_cache = {
            ch: [_decode_base64_template(s) for s in arr]
            for ch, arr in PACKED_TEMPLATES.items()
        }
    return _decoded_cache


def preprocess_pixels(rgba, width, height):
    """灰度二值化 + 噪线剥离"""
    grid = [[0] * width for _ in range(height)]
    for y in range(2, height - 2):
        for x in range(2, width - 2):
            if y < 10 or y > 31:
                continue
            idx = (y * width + x) * 4
            gray = 0.299 * rgba[idx] + 0.587 * rgba[idx + 1] + 0.114 * rgba[idx + 2]
            if gray < 170:
                grid[y][x] = 1

    for _round in range(2):
        to_remove = []
        for y in range(1, height - 1):
            for x in range(1, width - 1):
                if grid[y][x] == 1:
                    is_diag1 = (grid[y - 1][x - 1] == 1 or grid[y + 1][x + 1] == 1) and \
                        grid[y - 1][x] == 0 and grid[y + 1][x] == 0 and grid[y][x - 1] == 0 and grid[y][x + 1] == 0
                    is_diag2 = (grid[y - 1][x + 1] == 1 or grid[y + 1][x - 1] == 1) and \
                        grid[y - 1][x] == 0 and grid[y + 1][x] == 0 and grid[y][x - 1] == 0 and grid[y][x + 1] == 0
                    neighbors = 0
                    for dy in (-1, 0, 1):
                        for dx in (-1, 0, 1):
                            if (dy != 0 or dx != 0) and grid[y + dy][x + dx] == 1:
                                neighbors += 1
                    if is_diag1 or is_diag2 or neighbors < 1:
                        to_remove.append((y, x))
        for ry, rx in to_remove:
            grid[ry][rx] = 0
    return grid


def extract_typography_blocks(grid, width, height):
    """槽位列簇切分 -> 4 个 14x36 矩阵"""
    slot_width = (width - 4) / 4.0
    intervals = []

    for i in range(4):
        slot_sx = int(2 + i * slot_width)
        slot_ex = int(2 + (i + 1) * slot_width)
        search_sx = max(0, slot_sx - 3)
        search_ex = min(width - 1, slot_ex + 3)

        clusters = []
        in_cluster = False
        cur_sx = 0
        for x in range(search_sx, search_ex + 1):
            col_count = sum(1 for y in range(height) if grid[y][x] == 1)
            if col_count >= 1 and not in_cluster:
                in_cluster = True
                cur_sx = x
            elif col_count < 1 and in_cluster:
                in_cluster = False
                clusters.append([cur_sx, x - 1])
        if in_cluster:
            clusters.append([cur_sx, search_ex])

        if not clusters:
            intervals.append([slot_sx, slot_ex])
        else:
            # 合并微小间隙
            merged = []
            cur_csx, cur_cex = clusters[0]
            for csx, cex in clusters[1:]:
                if csx - cur_cex <= 2:
                    cur_cex = cex
                else:
                    merged.append([cur_csx, cur_cex])
                    cur_csx, cur_cex = csx, cex
            merged.append([cur_csx, cur_cex])

            slot_center = (slot_sx + slot_ex) / 2.0
            best_cluster = merged[0]
            best_score = -9999
            for csx, cex in merged:
                c_center = (csx + cex) / 2.0
                c_mass = 0
                for cx in range(csx, cex + 1):
                    for cy in range(height):
                        if grid[cy][cx] == 1:
                            c_mass += 1
                score = c_mass - abs(c_center - slot_center) * 6
                if score > best_score:
                    best_score = score
                    best_cluster = [csx, cex]

            min_x, max_x = best_cluster
            if max_x - min_x < 5:
                pad_needed = 6 - (max_x - min_x + 1)
                min_x = max(0, min_x - pad_needed // 2)
                max_x = min(width - 1, min_x + 5)
            intervals.append([min_x, max_x])

    matrices = []
    for min_x, max_x in intervals:
        src_w = max_x - min_x + 1
        norm = [[0] * CANVAS_WIDTH for _ in range(CANVAS_HEIGHT)]
        for y in range(2, min(CANVAS_HEIGHT + 2, height - 2)):
            ny = y - 2
            for nx in range(CANVAS_WIDTH):
                sx_mapped = min_x + (nx * src_w) // CANVAS_WIDTH
                if 0 <= sx_mapped < width and grid[y][sx_mapped] == 1:
                    norm[ny][nx] = 1

        # CCA 连通分量处理
        visited = [[False] * CANVAS_WIDTH for _ in range(CANVAS_HEIGHT)]
        components = []
        for y in range(CANVAS_HEIGHT):
            for x in range(CANVAS_WIDTH):
                if norm[y][x] == 1 and not visited[y][x]:
                    comp = []
                    queue = deque([(y, x)])
                    visited[y][x] = True
                    while queue:
                        cy, cx = queue.popleft()
                        comp.append((cy, cx))
                        for dy in (-1, 0, 1):
                            for dx in (-1, 0, 1):
                                ny_, nx_ = cy + dy, cx + dx
                                if 0 <= ny_ < CANVAS_HEIGHT and 0 <= nx_ < CANVAS_WIDTH and \
                                   norm[ny_][nx_] == 1 and not visited[ny_][nx_]:
                                    visited[ny_][nx_] = True
                                    queue.append((ny_, nx_))
                    components.append(comp)

        if len(components) > 1:
            components.sort(key=lambda c: -len(c))
            max_comp = components[0]
            max_comp_min_x = min(p[1] for p in max_comp)
            max_comp_max_x = max(p[1] for p in max_comp)
            for comp in components[1:]:
                comp_min_x = min(p[1] for p in comp)
                comp_max_x = max(p[1] for p in comp)
                is_overlap = not (comp_max_x < max_comp_min_x - 1 or comp_min_x > max_comp_max_x + 1)
                if not is_overlap:
                    for py, px in comp:
                        norm[py][px] = 0

        matrices.append(norm)
    return matrices


def _count_set_bits(n):
    c = 0
    while n > 0:
        n &= (n - 1)
        c += 1
    return c


def calculate_similarity(mat, template_rows):
    inter = 0
    union = 0
    for y in range(CANVAS_HEIGHT):
        row_val = 0
        for x in range(CANVAS_WIDTH):
            if mat[y][x] == 1:
                row_val |= (1 << (CANVAS_WIDTH - 1 - x))
        t = template_rows[y]
        inter += _count_set_bits(row_val & t)
        union += _count_set_bits(row_val | t)
    return inter / union if union > 0 else 0


def classify_block(mat):
    best_char = '?'
    best_score = -1
    for ch, t_list in get_templates().items():
        for t_rows in t_list:
            s = calculate_similarity(mat, t_rows)
            if s > best_score:
                best_score = s
                best_char = ch

    if best_char == 'l':
        best_char = '1'

    # 判决1: p/n/h/u
    if best_char in ('n', 'h', 'p', 'u'):
        bot_left_descender = 0
        for y in range(28, CANVAS_HEIGHT):
            for x in range(0, 7):
                if mat[y][x] == 1:
                    bot_left_descender += 1
        if bot_left_descender >= 3:
            best_char = 'p'
        elif best_char == 'p' and bot_left_descender == 0:
            top_arch = 0
            for y in range(15, 18):
                for x in range(CANVAS_WIDTH):
                    if mat[y][x] == 1:
                        top_arch += 1
            best_char = 'n' if top_arch >= 8 else 'u'

    # 判决2: h/n
    if best_char in ('h', 'n'):
        left_top = 0
        for y in range(0, 14):
            for x in range(2, 8):
                if mat[y][x] == 1:
                    left_top += 1
        best_char = 'h' if left_top >= 4 else 'n'

    # 判决3: 1/i
    if best_char in ('1', 'i'):
        has_gap = False
        for y in range(12, 16):
            if sum(mat[y]) == 0:
                has_gap = True
                break
        best_char = 'i' if has_gap else '1'

    return best_char, best_score


def recognize_rgba(rgba, width, height):
    grid = preprocess_pixels(rgba, width, height)
    mats = extract_typography_blocks(grid, width, height)
    text = ""
    confs = []
    for mat in mats:
        ch, score = classify_block(mat)
        text += ch
        confs.append(score)
    avg = sum(confs) / len(confs) if confs else 0
    return text, avg, confs


def recognize_jpeg(data: bytes) -> str:
    """JPEG bytes -> OCR 文本 (使用 PIL)"""
    from PIL import Image
    import io
    img = Image.open(io.BytesIO(data)).convert("RGBA")
    w, h = img.size
    rgba = list(img.tobytes())
    text, avg, confs = recognize_rgba(rgba, w, h)
    return text, avg, confs


if __name__ == "__main__":
    import sys
    data = open(sys.argv[1], 'rb').read() if len(sys.argv) > 1 else None
    if data:
        text, avg, confs = recognize_jpeg(data)
        print(f"OCR: {text!r} avg_conf={avg:.3f} confs={[round(c,3) for c in confs]}")
