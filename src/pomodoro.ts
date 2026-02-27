/**
 * 番茄钟管理器
 * 管理所有番茄钟会话的创建、暂停、恢复、停止和持久化
 */

import { Notice } from 'obsidian';
import { PomodoroSession, PomodoroState, PomodoroStats } from './types';

/** 番茄钟事件监听器 */
export interface PomodoroEventListener {
    /** 番茄钟状态变化 */
    onSessionChange?: (session: PomodoroSession) => void;
    /** 番茄钟完成 */
    onSessionComplete?: (session: PomodoroSession) => void;
}

export class PomodoroManager {
    /** 所有番茄钟会话，key 为 memoId */
    private sessions: Map<string, PomodoroSession> = new Map();

    /** 所有历史记录（包括已完成） */
    private allSessions: PomodoroSession[] = [];

    /** 定时器引用 */
    private timerInterval: number | null = null;

    /** 事件监听器 */
    private listeners: Set<PomodoroEventListener> = new Set();

    /** 存储路径 */
    private storagePath: string = 'pomodoro-sessions.json';

    /** 插件实例，用于访问 storage */
    private plugin: any;

    /** 番茄钟时长（分钟） */
    private duration: number = 25;

    /** 是否启用提示音 */
    private soundEnabled: boolean = true;

    constructor(plugin: any, duration: number = 25, soundEnabled: boolean = true) {
        this.plugin = plugin;
        this.duration = duration;
        this.soundEnabled = soundEnabled;
    }

    /**
     * 启动番茄钟
     */
    start(memoId: string, duration?: number): PomodoroSession | null {
        // 检查是否已有运行中的番茄钟
        const existing = this.sessions.get(memoId);
        if (existing && (existing.state === 'running' || existing.state === 'paused')) {
            new Notice('该 memo 已有运行中的番茄钟');
            return existing;
        }

        const sessionId = this.generateId();
        const plannedMinutes = duration || this.duration;

        const session: PomodoroSession = {
            id: sessionId,
            memoId: memoId,
            startTime: Date.now(),
            plannedMinutes: plannedMinutes,
            state: 'running',
            remainingSeconds: plannedMinutes * 60,
            pausedAccumulatedSeconds: 0,
        };

        this.sessions.set(memoId, session);
        this.allSessions.push(session);

        // 启动定时器
        this.startTimer();

        // 保存
        this.save();

        // 触发事件
        this.notifyChange(session);

        new Notice(`🍅 番茄钟已启动 (${plannedMinutes}分钟)`);

        return session;
    }

    /**
     * 暂停番茄钟
     */
    pause(sessionId: string): void {
        const session = this.findSession(sessionId);
        if (!session) return;

        if (session.state !== 'running') {
            new Notice('只能暂停运行中的番茄钟');
            return;
        }

        session.state = 'paused';
        this.save();
        this.notifyChange(session);

        new Notice('⏸ 番茄钟已暂停');
    }

    /**
     * 恢复番茄钟
     */
    resume(sessionId: string): void {
        const session = this.findSession(sessionId);
        if (!session) return;

        if (session.state !== 'paused') {
            new Notice('只能恢复已暂停的番茄钟');
            return;
        }

        session.state = 'running';
        this.save();

        // 确保定时器正在运行
        this.startTimer();

        this.notifyChange(session);

        new Notice('▶ 番茄钟已继续');
    }

    /**
     * 停止番茄钟
     */
    stop(sessionId: string, save: boolean = false): void {
        const session = this.findSession(sessionId);
        if (!session) return;

        const memoId = session.memoId;

        if (save) {
            // 保存为完成状态
            session.state = 'completed';
            session.endTime = Date.now();
            const elapsedMinutes = Math.round(
                (session.endTime - session.startTime) / 60000
            );
            session.actualMinutes = elapsedMinutes;
        } else {
            // 取消不保存
            this.sessions.delete(memoId);
            // 从历史记录中移除
            this.allSessions = this.allSessions.filter(s => s.id !== sessionId);
        }

        this.save();
        this.notifyChange(session);

        // 检查是否还有运行中的番茄钟
        this.checkAndStopTimer();

        if (save) {
            new Notice('✅ 番茄钟已完成！');
        } else {
            new Notice('🗑 番茄钟已取消');
        }
    }

    /**
     * 获取 memo 的当前番茄钟会话
     */
    getSession(memoId: string): PomodoroSession | undefined {
        return this.sessions.get(memoId);
    }

    /**
     * 获取 memo 的所有番茄钟记录
     */
    getMemoPomodoros(memoId: string): PomodoroSession[] {
        return this.allSessions.filter(s => s.memoId === memoId);
    }

    /**
     * 获取运行中的番茄钟
     */
    getActivePomodoros(): PomodoroSession[] {
        return Array.from(this.sessions.values()).filter(
            s => s.state === 'running' || s.state === 'paused'
        );
    }

    /**
     * 获取统计数据
     */
    getStats(): PomodoroStats {
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

        const todaySessions = this.allSessions.filter(s => {
            return s.state === 'completed' && s.startTime >= todayStart;
        });

        const stats: PomodoroStats = {
            totalPomodoros: this.allSessions.filter(s => s.state === 'completed').length,
            totalFocusMinutes: this.allSessions
                .filter(s => s.state === 'completed' && s.actualMinutes)
                .reduce((sum, s) => sum + (s.actualMinutes || 0), 0),
            todayPomodoros: todaySessions.length,
            todayFocusMinutes: todaySessions
                .filter(s => s.actualMinutes)
                .reduce((sum, s) => sum + (s.actualMinutes || 0), 0),
            byTag: {},
        };

        return stats;
    }

    /**
     * 添加事件监听器
     */
    addListener(listener: PomodoroEventListener): void {
        this.listeners.add(listener);
    }

    /**
     * 移除事件监听器
     */
    removeListener(listener: PomodoroEventListener): void {
        this.listeners.delete(listener);
    }

    /**
     * 保存到持久化存储
     */
    async save(): Promise<void> {
        try {
            const data = {
                sessions: Array.from(this.sessions.entries()),
                allSessions: this.allSessions,
            };
            await this.plugin.saveData(data);
        } catch (error) {
            console.error('Failed to save pomodoro data:', error);
        }
    }

    /**
     * 从持久化存储加载
     */
    async load(): Promise<void> {
        try {
            const data = await this.plugin.loadData();
            if (data && data.allSessions) {
                this.allSessions = data.allSessions;
                // 恢复运行中的会话（但重置为 paused 状态）
                if (data.sessions) {
                    for (const [memoId, session] of data.sessions) {
                        const s = session as PomodoroSession;
                        if (s.state === 'running') {
                            s.state = 'paused'; // 重启后暂停，避免意外计时
                        }
                        this.sessions.set(memoId, s);
                    }
                }
            }
        } catch (error) {
            console.error('Failed to load pomodoro data:', error);
        }
    }

    /**
     * 更新设置
     */
    updateSettings(duration: number, soundEnabled: boolean): void {
        this.duration = duration;
        this.soundEnabled = soundEnabled;
    }

    /**
     * 每秒更新（tick）
     */
    private tick(): void {
        let hasRunning = false;
        const now = Date.now();

        for (const session of this.sessions.values()) {
            if (session.state === 'running') {
                hasRunning = true;

                if (session.remainingSeconds !== undefined) {
                    session.remainingSeconds--;

                    // 检查是否完成
                    if (session.remainingSeconds <= 0) {
                        this.completeSession(session);
                    } else {
                        // 每秒通知更新（用于UI更新）
                        this.notifyChange(session);
                    }
                }
            }
        }

        // 如果没有运行中的番茄钟，停止定时器
        if (!hasRunning) {
            this.checkAndStopTimer();
        }
    }

    /**
     * 完成番茄钟会话
     */
    private completeSession(session: PomodoroSession): void {
        session.state = 'completed';
        session.endTime = Date.now();
        const elapsedMinutes = Math.round(
            (session.endTime - session.startTime) / 60000
        );
        session.actualMinutes = elapsedMinutes;

        // 播放提示音
        if (this.soundEnabled) {
            this.playNotificationSound();
        }

        // 触发完成事件
        for (const listener of this.listeners) {
            if (listener.onSessionComplete) {
                listener.onSessionComplete(session);
            }
        }

        // 触发变化事件
        this.notifyChange(session);

        // 保存
        this.save();

        // 移除会话
        this.sessions.delete(session.memoId);

        // 检查是否还有运行中的番茄钟
        this.checkAndStopTimer();

        new Notice('🎉 番茄钟完成！休息一下吧');
    }

    /**
     * 启动定时器
     */
    private startTimer(): void {
        if (this.timerInterval !== null) {
            return; // 定时器已在运行
        }

        this.timerInterval = window.setInterval(() => {
            this.tick();
        }, 1000);
    }

    /**
     * 检查并停止定时器
     */
    private checkAndStopTimer(): void {
        const hasRunning = Array.from(this.sessions.values()).some(
            s => s.state === 'running'
        );

        if (!hasRunning && this.timerInterval !== null) {
            window.clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }

    /**
     * 通知所有监听器
     */
    private notifyChange(session: PomodoroSession): void {
        for (const listener of this.listeners) {
            if (listener.onSessionChange) {
                listener.onSessionChange(session);
            }
        }
    }

    /**
     * 查找会话
     */
    private findSession(sessionId: string): PomodoroSession | undefined {
        return this.allSessions.find(s => s.id === sessionId);
    }

    /**
     * 生成唯一ID
     */
    private generateId(): string {
        return `pomodoro-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * 播放提示音
     */
    private playNotificationSound(): void {
        // 使用浏览器的 Audio API 播放简单的提示音
        try {
            const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);

            oscillator.frequency.value = 800;
            oscillator.type = 'sine';

            gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(
                0.01,
                audioContext.currentTime + 0.5
            );

            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.5);
        } catch (error) {
            console.error('Failed to play notification sound:', error);
        }
    }

    /**
     * 清理资源
     */
    dispose(): void {
        if (this.timerInterval !== null) {
            window.clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
        this.listeners.clear();
    }
}
