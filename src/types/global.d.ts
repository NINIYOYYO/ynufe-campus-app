/**
 * 全局扩展接口与第三方容器声明
 */
export interface NativeCookiePluginType {
    getCookie(options: { url: string }): Promise<{ cookie?: string }>;
    setCookie(options: { url: string; cookie: string }): Promise<void>;
    saveAndOpenFile?(options: { fileName: string; base64Data: string; mimeType?: string }): Promise<{ success: boolean; filePath?: string; fileName?: string }>;
}

export interface CapacitorCookiesPluginType {
    getCookies(options?: { url?: string }): Promise<Record<string, string>>;
    setCookie(options: { url: string; key: string; value: string; expires?: string; path?: string }): Promise<void>;
    clearCookies(options: { url: string }): Promise<void>;
}

export interface CapacitorHttpPluginType {
    get(options: NativeHttpOptions): Promise<NativeHttpResponse>;
    post(options: NativeHttpOptions): Promise<NativeHttpResponse>;
    request(options: NativeHttpOptions): Promise<NativeHttpResponse>;
}

export interface NativeHttpOptions {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    data?: unknown;
    params?: Record<string, string>;
    responseType?: string;
    connectTimeout?: number;
    readTimeout?: number;
}

export interface NativeHttpResponse {
    data: unknown;
    status: number;
    headers: Record<string, string>;
    url: string;
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
        CapacitorHttp?: CapacitorHttpPluginType;
        App?: CapacitorAppPluginType;
        [pluginName: string]: unknown;
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
