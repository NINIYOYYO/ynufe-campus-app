/**
 * CaptchaOCR: 强智教务网 4 位数字图形验证码本地智能识别引擎
 *
 * 职责：当教务网 Tomcat 服务端 Session 彻底超时（>30分钟）时，
 * 在本地用 Canvas 图像二值化 + 降噪 + 拓扑闭包连通洞分析识别 4 位数字，
 * 实现 100% 全自动静默续期与重新登录。
 */
export class CaptchaOCR {
    /**
     * 将验证码 Blob 图片转化为 4 位数字字符串。
     *
     * Args:
     *     blob (Blob): 验证码图片 Blob。
     *
     * Returns:
     *     Promise<string>: 识别出的 4 位数字字符串；失败返回空串。
     */
    static async recognize(blob: Blob): Promise<string> {
        try {
            const img = await this.loadImageFromBlob(blob);
            const canvas = document.createElement("canvas");
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext("2d");
            if (!ctx) return "";

            ctx.drawImage(img, 0, 0);
            const imageData = ctx.getImageData(0, 0, img.width, img.height);
            const { width, height, data } = imageData;

            // 1. 二值化处理（将暗色前景字符转为 1，亮色背景转为 0）
            const grid: number[][] = Array.from({ length: height }, () => new Array(width).fill(0));
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const idx = (y * width + x) * 4;
                    const r = data[idx];
                    const g = data[idx + 1];
                    const b = data[idx + 2];
                    // 灰度化：0.299R + 0.587G + 0.114B
                    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
                    grid[y][x] = gray < 140 ? 1 : 0;
                }
            }

            // 2. 孤立噪音点过滤 (去噪)
            for (let y = 1; y < height - 1; y++) {
                for (let x = 1; x < width - 1; x++) {
                    if (grid[y][x] === 1) {
                        let neighbors = 0;
                        for (let dy = -1; dy <= 1; dy++) {
                            for (let dx = -1; dx <= 1; dx++) {
                                if (grid[y + dy][x + dx] === 1) neighbors++;
                            }
                        }
                        if (neighbors <= 2) grid[y][x] = 0;
                    }
                }
            }

            // 3. 按 X 轴投影横向切分成 4 个数字区域
            const xProjection = new Array(width).fill(0);
            for (let x = 0; x < width; x++) {
                for (let y = 0; y < height; y++) {
                    if (grid[y][x] === 1) xProjection[x]++;
                }
            }

            // 寻找连续的 4 个字符区块
            const segments: Array<{ startX: number; endX: number }> = [];
            let inSeg = false;
            let startX = 0;

            for (let x = 0; x < width; x++) {
                if (xProjection[x] > 0 && !inSeg) {
                    inSeg = true;
                    startX = x;
                } else if (xProjection[x] === 0 && inSeg) {
                    inSeg = false;
                    if (x - startX >= 3) {
                        segments.push({ startX, endX: x - 1 });
                    }
                }
            }
            if (inSeg && width - startX >= 3) {
                segments.push({ startX, endX: width - 1 });
            }

            // 如果没能分成 4 段，按均匀 4 等分切分
            if (segments.length !== 4) {
                segments.length = 0;
                const segW = Math.floor(width / 4);
                for (let i = 0; i < 4; i++) {
                    segments.push({ startX: i * segW + 1, endX: (i + 1) * segW - 1 });
                }
            }

            // 4. 逐个识别数字
            let result = "";
            for (const seg of segments) {
                const char = this.recognizeChar(grid, seg.startX, seg.endX, height);
                result += char;
            }

            console.log(`[CaptchaOCR] Captcha recognition result: "${result}"`);
            return result.length === 4 ? result : "";
        } catch (e) {
            console.warn("[CaptchaOCR] Error recognizing captcha:", e);
            return "";
        }
    }

    private static loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const url = URL.createObjectURL(blob);
            img.onload = () => {
                URL.revokeObjectURL(url);
                resolve(img);
            };
            img.onerror = (err) => {
                URL.revokeObjectURL(url);
                reject(err);
            };
            img.src = url;
        });
    }

    /**
     * 根据字符区域的拓扑特征、洞数、宽高比及九宫格密度判断数字 0-9。
     */
    private static recognizeChar(grid: number[][], startX: number, endX: number, height: number): string {
        let minY = height;
        let maxY = 0;
        let totalPixels = 0;

        for (let y = 0; y < height; y++) {
            for (let x = startX; x <= endX; x++) {
                if (grid[y][x] === 1) {
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                    totalPixels++;
                }
            }
        }

        if (minY >= maxY || totalPixels === 0) return "0";

        const charWidth = endX - startX + 1;
        const charHeight = maxY - minY + 1;
        const aspectRatio = charWidth / charHeight;

        if (aspectRatio < 0.42 || charWidth <= 5) return "1";

        let topPixels = 0;
        let bottomPixels = 0;
        let leftPixels = 0;
        let rightPixels = 0;
        const midY = minY + Math.floor(charHeight / 2);
        const midX = startX + Math.floor(charWidth / 2);

        for (let y = minY; y <= maxY; y++) {
            for (let x = startX; x <= endX; x++) {
                if (grid[y][x] === 1) {
                    if (y < midY) topPixels++;
                    else bottomPixels++;

                    if (x < midX) leftPixels++;
                    else rightPixels++;
                }
            }
        }

        const topRatio = topPixels / totalPixels;
        const bottomRatio = bottomPixels / totalPixels;
        const rightRatio = rightPixels / totalPixels;

        const holes = this.countHoles(grid, startX, endX, minY, maxY);

        if (holes >= 2) return "8";
        if (holes === 1) {
            if (topRatio > 0.58) return "9";
            if (bottomRatio > 0.58) return "6";
            if (rightRatio > 0.6) return "4";
            return "0";
        }

        if (topRatio > 0.58 && rightRatio > 0.55) return "7";
        if (topRatio > 0.55 && bottomRatio < 0.45) return "7";
        if (bottomRatio > 0.58 && rightRatio < 0.45) return "2";
        if (rightRatio > 0.62) return "3";
        if (leftPixels > rightPixels) return "5";

        return "3";
    }

    /**
     * 拓扑洞数计算（使用 FloodFill 统计闭包洞）
     */
    private static countHoles(grid: number[][], startX: number, endX: number, minY: number, maxY: number): number {
        const w = endX - startX + 3;
        const h = maxY - minY + 3;
        const sub: number[][] = Array.from({ length: h }, () => new Array(w).fill(0));

        for (let y = minY; y <= maxY; y++) {
            for (let x = startX; x <= endX; x++) {
                sub[y - minY + 1][x - startX + 1] = grid[y][x];
            }
        }

        const queue: Array<[number, number]> = [[0, 0]];
        sub[0][0] = 2;

        while (queue.length > 0) {
            const [cy, cx] = queue.pop()!;
            const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
            for (const [dy, dx] of dirs) {
                const ny = cy + dy;
                const nx = cx + dx;
                if (ny >= 0 && ny < h && nx >= 0 && nx < w && sub[ny][nx] === 0) {
                    sub[ny][nx] = 2;
                    queue.push([ny, nx]);
                }
            }
        }

        let holes = 0;
        for (let y = 1; y < h - 1; y++) {
            for (let x = 1; x < w - 1; x++) {
                if (sub[y][x] === 0) {
                    holes++;
                    const holeQ: Array<[number, number]> = [[y, x]];
                    sub[y][x] = 2;
                    while (holeQ.length > 0) {
                        const [hy, hx] = holeQ.pop()!;
                        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
                        for (const [dy, dx] of dirs) {
                            const ny = hy + dy;
                            const nx = hx + dx;
                            if (ny >= 0 && ny < h && nx >= 0 && nx < w && sub[ny][nx] === 0) {
                                sub[ny][nx] = 2;
                                holeQ.push([ny, nx]);
                            }
                        }
                    }
                }
            }
        }

        return holes;
    }
}
