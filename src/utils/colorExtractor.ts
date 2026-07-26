export interface RGBColor {
    r: number;
    g: number;
    b: number;
}

/**
 * Material You 级 1024 点 HSL 直方图加权聚类色彩提取器
 */
export class ColorExtractor {
    static extractDominantColor(imgElement: HTMLImageElement): RGBColor {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) return { r: 59, g: 130, b: 246 };

        const MAX_DIM = 1080;
        let width = imgElement.width;
        let height = imgElement.height;
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
        ctx.drawImage(imgElement, 0, 0, width, height);

        // 32x32 1024 点高密度采样
        const miniCanvas = document.createElement("canvas");
        miniCanvas.width = 32;
        miniCanvas.height = 32;
        const miniCtx = miniCanvas.getContext("2d");
        if (!miniCtx) return { r: 59, g: 130, b: 246 };

        miniCtx.drawImage(canvas, 0, 0, 32, 32);
        const imgData = miniCtx.getImageData(0, 0, 32, 32).data;

        // 24 个 HSL 色相桶
        const buckets = Array.from({ length: 24 }, () => ({ score: 0, sumR: 0, sumG: 0, sumB: 0, count: 0 }));
        let totalR = 0, totalG = 0, totalB = 0, validPixelCount = 0;

        for (let i = 0; i < 1024; i++) {
            const rVal = imgData[i * 4];
            const gVal = imgData[i * 4 + 1];
            const bVal = imgData[i * 4 + 2];

            totalR += rVal;
            totalG += gVal;
            totalB += bVal;
            validPixelCount++;

            const rPct = rVal / 255;
            const gPct = gVal / 255;
            const bPct = bVal / 255;
            const max = Math.max(rPct, gPct, bPct);
            const min = Math.min(rPct, gPct, bPct);
            let h = 0, s = 0, l = (max + min) / 2;

            if (max !== min) {
                const d = max - min;
                s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
                switch (max) {
                    case rPct: h = (gPct - bPct) / d + (gPct < bPct ? 6 : 0); break;
                    case gPct: h = (bPct - rPct) / d + 2; break;
                    case bPct: h = (rPct - gPct) / d + 4; break;
                }
                h /= 6;
            }

            // 过滤过暗(死黑)、过亮(纯白)或灰色无偏向噪音
            if (l > 0.12 && l < 0.88 && s > 0.12) {
                const hueDegree = h * 360;
                const bucketIdx = Math.floor(hueDegree / 15) % 24;
                const lightnessWeight = 1 - Math.abs(l - 0.5) * 1.2;
                const pixelScore = s * Math.max(0.2, lightnessWeight);

                buckets[bucketIdx].score += pixelScore;
                buckets[bucketIdx].sumR += rVal;
                buckets[bucketIdx].sumG += gVal;
                buckets[bucketIdx].sumB += bVal;
                buckets[bucketIdx].count++;
            }
        }

        let bestBucket = null;
        let maxScore = -1;
        for (const b of buckets) {
            if (b.count > 0 && b.score > maxScore) {
                maxScore = b.score;
                bestBucket = b;
            }
        }

        if (bestBucket && bestBucket.count > 0) {
            return {
                r: Math.round(bestBucket.sumR / bestBucket.count),
                g: Math.round(bestBucket.sumG / bestBucket.count),
                b: Math.round(bestBucket.sumB / bestBucket.count)
            };
        } else if (validPixelCount > 0) {
            return {
                r: Math.round(totalR / validPixelCount),
                g: Math.round(totalG / validPixelCount),
                b: Math.round(totalB / validPixelCount)
            };
        }

        return { r: 59, g: 130, b: 246 };
    }
}
