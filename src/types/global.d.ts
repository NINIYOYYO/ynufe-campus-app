/**
 * 全局扩展接口与第三方容器声明
 */
export interface NativeCookiePluginType {
    getCookie(options: { url: string }): Promise<{ cookie?: string }>;
    setCookie(options: { url: string; cookie: string }): Promise<void>;
}

export interface CapacitorCookiesPluginType {
    getCookies(options?: { url?: string }): Promise<Record<string, string>>;
    setCookie(options: { url: string; key: string; value: string; expires?: string; path?: string }): Promise<void>;
    clearCookies(options: { url: string }): Promise<void>;
    flushCookies(): Promise<void>;
}

export interface CapacitorAppPluginType {
    addListener(eventName: 'backButton', listenerFunc: (info: { canGoBack?: boolean }) => void): Promise<{ remove: () => void }> | void;
    exitApp(): Promise<void> | void;
}

export interface CapacitorGlobal {
    isNativePlatform?: () => boolean;
    getPlatform?: () => string;
    Plugins?: {
        NativeCookie?: NativeCookiePluginType;
        CapacitorCookies?: CapacitorCookiesPluginType;
        App?: CapacitorAppPluginType;
        [pluginName: string]: any;
    };
    [key: string]: unknown;
}

declare global {
    interface Window {
        Capacitor?: CapacitorGlobal;
        _customSelectGlobalClickBound?: boolean;
        _themeCustomizerBound?: boolean;
    }

    interface HTMLElement {
        _staggerCleanup?: () => void;
    }
}

export {};
