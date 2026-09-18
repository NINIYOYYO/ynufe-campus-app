import { StorageKey } from '../config/storageKeys';

/**
 * 缓存数据信封包装结构
 */
interface CacheEnvelope<T> {
    data: T;
    cachedAt: number;
    version?: number;
}

/**
 * 强类型本地缓存与存储服务 (CacheService)
 *
 * 职责：
 * 1. 统一管理全站 LocalStorage 读写，支持泛型 `<T>`。
 * 2. 具备 TTL 过期时间自动失效控制与缓存时间戳追踪。
 * 3. 防御性反序列化与损坏数据自愈清理，防止 JSON 解析崩溃。
 * 4. 向后兼容直接存储的旧版未包装 JSON 数据。
 */
export class CacheService {
    private static CURRENT_SCHEMA_VERSION = 1;

    /**
     * 写入带时间戳信封的强类型缓存数据。
     *
     * Args:
     *     key (StorageKey | string): 存储键名。
     *     data (T): 待持久化数据。
     *
     * Raises:
     *     Error: 当 LocalStorage 超出存储配额 (QuotaExceededError) 或持久化失败时抛出。
     */
    static set<T>(key: StorageKey | string, data: T): void {
        try {
            const envelope: CacheEnvelope<T> = {
                data,
                cachedAt: Date.now(),
                version: this.CURRENT_SCHEMA_VERSION,
            };
            localStorage.setItem(key, JSON.stringify(envelope));
        } catch (err) {
            console.error(`[CacheService] Failed to set cache for key "${key}":`, err);
            throw err;
        }
    }

    /**
     * 获取缓存数据，支持 TTL 有效期检查与向后兼容。
     *
     * Args:
     *     key (StorageKey | string): 存储键名。
     *     maxAgeMs (number, optional): 可选的最大允许缓存存活毫秒数，超过则返回 null。
     *
     * Returns:
     *     T | null: 缓存存在且未过期时返回实体，否则返回 null。
     */
    static get<T>(key: StorageKey | string, maxAgeMs?: number): T | null {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return null;

            let parsed: unknown;
            try {
                parsed = JSON.parse(raw);
            } catch (jsonErr) {
                // 若以 '{' 或 '[' 开头却无法解析，则判定为损坏的 JSON 结构，交由外层 catch 清理
                const trimmed = raw.trim();
                if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
                    throw jsonErr;
                }
                // 否则平滑向后兼容旧版未包装的裸字符串数据 (例如 "dark", "#3b82f6", "custom")
                return raw as unknown as T;
            }

            // 1. 判断是否为新版 CacheEnvelope 信封包装
            if (parsed && typeof parsed === "object" && "cachedAt" in parsed && "data" in parsed) {
                const envelope = parsed as CacheEnvelope<T>;
                if (maxAgeMs && maxAgeMs > 0) {
                    const age = Date.now() - envelope.cachedAt;
                    if (age > maxAgeMs) {
                        return null; // 已过期
                    }
                }
                return envelope.data;
            }

            // 2. 向后兼容旧版未包装的直接 JSON 对象
            return parsed as T;
        } catch (err) {
            console.warn(`[CacheService] Corrupted cache detected for key "${key}", safely clearing:`, err);
            this.remove(key);
            return null;
        }
    }

    /**
     * 获取指定缓存的写入时间戳（毫秒）。
     *
     * Args:
     *     key (StorageKey | string): 存储键名。
     *
     * Returns:
     *     number | null: 写入时的时间戳，若无信封或不存在则返回 null。
     */
    static getTimestamp(key: StorageKey | string): number | null {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === "object" && typeof parsed.cachedAt === "number") {
                return parsed.cachedAt;
            }
            return null;
        } catch {
            return null;
        }
    }

    /**
     * 判断缓存是否存在。
     *
     * Args:
     *     key (StorageKey | string): 存储键名。
     *
     * Returns:
     *     boolean: 存在返回 true。
     */
    static has(key: StorageKey | string): boolean {
        return localStorage.getItem(key) !== null;
    }

    /**
     * 删除指定键名缓存。
     *
     * Args:
     *     key (StorageKey | string): 存储键名。
     */
    static remove(key: StorageKey | string): void {
        try {
            localStorage.removeItem(key);
        } catch (err) {
            console.error(`[CacheService] Failed to remove key "${key}":`, err);
        }
    }

    /**
     * 批量清理匹配前缀的所有缓存项。
     *
     * Args:
     *     prefix (string): 键名前缀（如 "ynufe_cache_"）。
     */
    static clearByPrefix(prefix: string): void {
        try {
            const keysToRemove: string[] = [];
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && k.startsWith(prefix)) {
                    keysToRemove.push(k);
                }
            }
            keysToRemove.forEach(k => localStorage.removeItem(k));
        } catch (err) {
            console.error(`[CacheService] Failed to clear prefix "${prefix}":`, err);
        }
    }
}
