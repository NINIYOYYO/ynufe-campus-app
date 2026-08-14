import { YnufeClient } from '../api/client';
import { YnufeSession } from '../stores/sessionStore';
import { AppConfig } from '../config';

/**
 * HeartbeatService: 后台心跳保活服务
 * 职责：维持教务网 Tomcat 会话活跃状态，防止由于空闲超时被服务器注销。
 */
export class HeartbeatService {
    private static heartbeatIntervalId: ReturnType<typeof setInterval> | null = null;

    /**
     * 启动后台心跳保活请求。
     */
    static start(): void {
        this.stop();

        this.heartbeatIntervalId = setInterval(async () => {
            if (!YnufeSession.getHasSession() || document.hidden) {
                return;
            }
            try {
                await YnufeClient.getHtml("/jsxsd/framework/xsMain.jsp");
            } catch (err) {
                console.warn("[HeartbeatService] 心跳保活检测失败:", err);
            }
        }, AppConfig.HEARTBEAT_INTERVAL_MS);
    }

    /**
     * 停止后台心跳定时器。
     */
    static stop(): void {
        if (this.heartbeatIntervalId !== null) {
            clearInterval(this.heartbeatIntervalId);
            this.heartbeatIntervalId = null;
        }
    }

    /**
     * 查询心跳是否处于运行中。
     *
     * Returns:
     *     boolean: 心跳定时器活跃时返回 true。
     */
    static isRunning(): boolean {
        return this.heartbeatIntervalId !== null;
    }
}
