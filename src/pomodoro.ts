/**
 * 番茄钟管理器
 * 管理所有番茄钟会话的创建、暂停、恢复、停止和持久化
 * 支持完整的番茄工作法循环：专注 → 短休息 → 专注 → ... → 长休息
 */

import { Notice } from 'obsidian';
import { PomodoroSession, PomodoroState, PomodoroStats, PomodoroPauseRecord } from './types';

/** 番茄钟事件监听器 */
export interface PomodoroEventListener {
    /** 番茄钟状态变化 */
    onSessionChange?: (session: PomodoroSession) => void;
    /** 番茄钟完成（专注阶段完成） */
    onSessionComplete?: (session: PomodoroSession) => void;
    /** 休息开始 */
    onBreakStart?: (session: PomodoroSession) => void;
    /** 休息结束 */
    onBreakEnd?: (session: PomodoroSession) => void;
}

export class PomodoroManager {
    private sessions: Map<string, PomodoroSession> = new Map();
    private allSessions: PomodoroSession[] = [];
    private timerInterval: number | null = null;
    private listeners: Set<PomodoroEventListener> = new Set();
    private plugin: any;

    private duration: number = 25;
    private shortBreakDuration: number = 5;
    private longBreakDuration: number = 15;
    private longBreakInterval: number = 4;
    private soundEnabled: boolean = true;

    /** 每个 memo 的连续完成计数（用于判断长休息），不持久化 */
    private consecutiveCounts: Map<string, number> = new Map();

    constructor(
        plugin: any,
        duration: number = 25,
        soundEnabled: boolean = true,
        shortBreak: number = 5,
        longBreak: number = 15,
        longBreakInterval: number = 4,
    ) {
        this.plugin = plugin;
        this.duration = duration;
        this.soundEnabled = soundEnabled;
        this.shortBreakDuration = shortBreak;
        this.longBreakDuration = longBreak;
        this.longBreakInterval = longBreakInterval;
    }

    /**
     * 启动番茄钟
     */
    start(memoId: string, duration?: number): PomodoroSession | null {
        const existing = this.sessions.get(memoId);

        // 如果正在休息中，跳过休息直接开始新一轮
        if (existing && (existing.state === 'short_break' || existing.state === 'long_break')) {
            this.sessions.delete(memoId);
        } else if (existing && (existing.state === 'running' || existing.state === 'paused')) {
            new Notice('该 memo 已有运行中的番茄钟');
            return existing;
        }

        const sessionId = this.generateId();
        const plannedMinutes = duration || this.duration;

        const consecutiveCount = this.consecutiveCounts.get(memoId) || 0;

        const session: PomodoroSession = {
            id: sessionId,
            memoId: memoId,
            startTime: Date.now(),
            plannedMinutes: plannedMinutes,
            state: 'running',
            remainingSeconds: plannedMinutes * 60,
            pausedAccumulatedSeconds: 0,
            pauseHistory: [],
            consecutiveCount: consecutiveCount,
        };

        this.sessions.set(memoId, session);
        this.allSessions.push(session);

        this.startTimer();
        this.save();
        this.notifyChange(session);

        new Notice(`🍅 番茄钟已启动 (${plannedMinutes}分钟)`);

        return session;
    }

    /**
     * 暂停番茄钟（仅专注阶段可暂停）
     */
    pause(sessionId: string): void {
        const session = this.findSession(sessionId);
        if (!session) return;

        if (session.state !== 'running') {
            new Notice('只能暂停运行中的番茄钟');
            return;
        }

        session.state = 'paused';

        const pauseRecord: PomodoroPauseRecord = {
            pauseStartTime: Date.now()
        };

        if (!session.pauseHistory) {
            session.pauseHistory = [];
        }
        session.pauseHistory.push(pauseRecord);

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

        const now = Date.now();

        const currentPause = session.pauseHistory?.find(
            p => !p.pauseEndTime
        );

        if (currentPause) {
            currentPause.pauseEndTime = now;
            currentPause.duration = Math.floor(
                (now - currentPause.pauseStartTime) / 1000
            );

            session.pausedAccumulatedSeconds =
                (session.pausedAccumulatedSeconds || 0) + currentPause.duration;
        }

        session.state = 'running';
        this.save();

        this.startTimer();
        this.notifyChange(session);

        new Notice('▶ 番茄钟已继续');
    }

    /**
     * 停止番茄钟（支持专注阶段和休息阶段）
     */
    stop(sessionId: string, save: boolean = false): void {
        const session = this.findSession(sessionId);
        if (!session) return;

        const memoId = session.memoId;
        const wasBreak = session.state === 'short_break' || session.state === 'long_break';

        if (wasBreak) {
            // 休息阶段被手动结束，直接清理
            this.sessions.delete(memoId);
            this.save();
            this.notifyChange(session);
            this.checkAndStopTimer();
            new Notice('☕ 休息已结束');
            return;
        }

        if (save) {
            this.finalizePausedTime(session);

            session.endTime = Date.now();

            const totalElapsedSeconds = Math.floor(
                (session.endTime - session.startTime) / 1000
            );
            const actualSeconds = totalElapsedSeconds - (session.pausedAccumulatedSeconds || 0);

            // 不足 60 秒视为简单跟进/提醒任务，丢弃记录
            if (actualSeconds < 60) {
                this.sessions.delete(memoId);
                this.allSessions = this.allSessions.filter(s => s.id !== session.id);
                this.save();
                this.notifyChange(session);
                this.checkAndStopTimer();
                new Notice('⏱ 专注不足 1 分钟，不计入番茄记录');
                return;
            }

            session.state = 'completed';
            session.actualMinutes = Math.max(1, Math.round(actualSeconds / 60));

            const count = (this.consecutiveCounts.get(memoId) || 0) + 1;
            this.consecutiveCounts.set(memoId, count);
            session.consecutiveCount = count;

            this.sessions.delete(memoId);
        } else {
            this.sessions.delete(memoId);
            this.allSessions = this.allSessions.filter(s => s.id !== sessionId);
            this.consecutiveCounts.delete(memoId);
        }

        this.save();
        this.notifyChange(session);
        this.checkAndStopTimer();

        if (save) {
            new Notice('✅ 番茄钟已完成！');
        } else {
            new Notice('🗑 番茄钟已取消');
        }
    }

    /**
     * 跳过当前休息阶段
     */
    skipBreak(memoId: string): void {
        const session = this.sessions.get(memoId);
        if (!session) return;

        if (session.state !== 'short_break' && session.state !== 'long_break') {
            return;
        }

        this.sessions.delete(memoId);
        this.save();

        // 通知 UI 休息结束
        for (const listener of this.listeners) {
            if (listener.onBreakEnd) {
                listener.onBreakEnd(session);
            }
        }
        this.notifyChange(session);
        this.checkAndStopTimer();

        new Notice('⏭ 休息已跳过');
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
     * 获取运行中的番茄钟（包含休息中的）
     */
    getActivePomodoros(): PomodoroSession[] {
        return Array.from(this.sessions.values()).filter(
            s => s.state === 'running' || s.state === 'paused'
                || s.state === 'short_break' || s.state === 'long_break'
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

    // ============ 数据管理 ============

    /**
     * 获取所有历史会话（供侧边栏展示）
     */
    getAllSessions(): PomodoroSession[] {
        return [...this.allSessions];
    }

    /**
     * 删除单条历史记录
     */
    deleteSession(sessionId: string): void {
        this.allSessions = this.allSessions.filter(s => s.id !== sessionId);
        // 同时从活跃 sessions 中移除（如果存在）
        for (const [memoId, session] of this.sessions.entries()) {
            if (session.id === sessionId) {
                this.sessions.delete(memoId);
                break;
            }
        }
        this.save();
        this.notifyDataChange();
    }

    /**
     * 批量删除历史记录
     */
    deleteSessions(sessionIds: Set<string>): void {
        this.allSessions = this.allSessions.filter(s => !sessionIds.has(s.id));
        for (const [memoId, session] of this.sessions.entries()) {
            if (sessionIds.has(session.id)) {
                this.sessions.delete(memoId);
            }
        }
        this.save();
        this.notifyDataChange();
    }

    /**
     * 清除所有历史数据
     */
    clearAllData(): void {
        this.allSessions = [];
        this.sessions.clear();
        this.consecutiveCounts.clear();
        this.checkAndStopTimer();
        this.save();
        this.notifyDataChange();
    }

    /**
     * 通知数据变化（供侧边栏刷新）
     */
    private notifyDataChange(): void {
        for (const listener of this.listeners) {
            if (listener.onSessionChange) {
                // 发送一个空信号触发 UI 刷新
                listener.onSessionChange(undefined as any);
            }
        }
    }

    addListener(listener: PomodoroEventListener): void {
        this.listeners.add(listener);
    }

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
                consecutiveCounts: Array.from(this.consecutiveCounts.entries()),
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
                for (const session of this.allSessions) {
                    if (!session.pauseHistory) {
                        session.pauseHistory = [];
                    }
                }
                if (data.sessions) {
                    for (const [memoId, session] of data.sessions) {
                        const s = session as PomodoroSession;
                        if (s.state === 'running') {
                            s.state = 'paused';
                        }
                        // 休息阶段重启后直接清理，不保留
                        if (s.state === 'short_break' || s.state === 'long_break') {
                            continue;
                        }
                        if (!s.pauseHistory) {
                            s.pauseHistory = [];
                        }
                        this.sessions.set(memoId, s);
                    }
                }
                // 恢复连续计数
                if (data.consecutiveCounts) {
                    for (const [memoId, count] of data.consecutiveCounts) {
                        this.consecutiveCounts.set(memoId, count as number);
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
    updateSettings(
        duration: number,
        soundEnabled: boolean,
        shortBreak: number = 5,
        longBreak: number = 15,
        longBreakInterval: number = 4,
    ): void {
        this.duration = duration;
        this.soundEnabled = soundEnabled;
        this.shortBreakDuration = shortBreak;
        this.longBreakDuration = longBreak;
        this.longBreakInterval = longBreakInterval;
    }

    // ============ 定时器与核心循环 ============

    /**
     * 每秒更新
     * 先快照再遍历，避免遍历过程中修改 Map 导致状态丢失
     */
    private tick(): void {
        const snapshot = Array.from(this.sessions.values());

        for (const session of snapshot) {
            if (session.state === 'running') {
                this.tickFocus(session);
            } else if (session.state === 'short_break' || session.state === 'long_break') {
                this.tickBreak(session);
            }
        }

        // tick 处理完后再检查是否还有活跃的（此时 startBreak 等新增的 session 已在 Map 中）
        this.checkAndStopTimer();
    }

    /**
     * 基于真实时间计算剩余秒数
     * 解决 setInterval 在后台被节流/暂停导致计时漂移的问题
     */
    private calcRemainingSeconds(session: PomodoroSession): number {
        const now = Date.now();
        const elapsedMs = now - session.startTime;
        const pausedMs = (session.pausedAccumulatedSeconds || 0) * 1000;
        const activeMs = elapsedMs - pausedMs;
        const totalMs = session.plannedMinutes * 60 * 1000;
        return Math.max(0, Math.ceil((totalMs - activeMs) / 1000));
    }

    /**
     * 专注阶段 tick — 基于真实时间
     */
    private tickFocus(session: PomodoroSession): void {
        const remaining = this.calcRemainingSeconds(session);
        session.remainingSeconds = remaining;

        if (remaining <= 0) {
            this.completeSession(session);
        } else {
            this.notifyChange(session);
        }
    }

    /**
     * 休息阶段 tick — 基于真实时间
     * 休息 session 没有暂停机制，直接用 startTime + breakMinutes 计算
     */
    private tickBreak(session: PomodoroSession): void {
        const now = Date.now();
        const breakMs = (session.breakMinutes || session.plannedMinutes) * 60 * 1000;
        const remaining = Math.max(0, Math.ceil((breakMs - (now - session.startTime)) / 1000));
        session.remainingSeconds = remaining;

        if (remaining <= 0) {
            this.completeBreak(session);
        } else {
            this.notifyChange(session);
        }
    }

    /**
     * 专注阶段自然完成 → 自动进入休息
     */
    private completeSession(session: PomodoroSession): void {
        session.state = 'completed';
        session.endTime = Date.now();

        const totalElapsedSeconds = Math.floor(
            (session.endTime - session.startTime) / 1000
        );
        const actualSeconds = totalElapsedSeconds - (session.pausedAccumulatedSeconds || 0);
        session.actualMinutes = Math.max(0, Math.round(actualSeconds / 60));

        if (this.soundEnabled) {
            this.playNotificationSound();
        }

        // 更新连续计数
        const memoId = session.memoId;
        const count = (this.consecutiveCounts.get(memoId) || 0) + 1;
        this.consecutiveCounts.set(memoId, count);
        session.consecutiveCount = count;

        // 触发完成事件
        for (const listener of this.listeners) {
            if (listener.onSessionComplete) {
                listener.onSessionComplete(session);
            }
        }

        // 从活跃 sessions 中移除已完成的专注会话
        this.sessions.delete(memoId);
        this.save();

        // 自动进入休息阶段
        this.startBreak(memoId, count);
    }

    /**
     * 开始休息阶段
     */
    private startBreak(memoId: string, completedCount: number): void {
        const isLongBreak = completedCount > 0 && completedCount % this.longBreakInterval === 0;
        const breakMinutes = isLongBreak ? this.longBreakDuration : this.shortBreakDuration;
        const breakState: PomodoroState = isLongBreak ? 'long_break' : 'short_break';

        const breakSession: PomodoroSession = {
            id: this.generateId(),
            memoId: memoId,
            startTime: Date.now(),
            plannedMinutes: breakMinutes,
            state: breakState,
            remainingSeconds: breakMinutes * 60,
            breakMinutes: breakMinutes,
            consecutiveCount: completedCount,
        };

        this.sessions.set(memoId, breakSession);

        this.startTimer();

        // 触发休息开始事件
        for (const listener of this.listeners) {
            if (listener.onBreakStart) {
                listener.onBreakStart(breakSession);
            }
        }
        this.notifyChange(breakSession);
        this.save();

        if (isLongBreak) {
            new Notice(`🌿 第 ${completedCount} 个番茄完成！长休息 ${breakMinutes} 分钟`);
            // 长休息后重置连续计数
            this.consecutiveCounts.set(memoId, 0);
        } else {
            new Notice(`☕ 番茄钟完成！短休息 ${breakMinutes} 分钟`);
        }
    }

    /**
     * 休息阶段自然完成
     */
    private completeBreak(session: PomodoroSession): void {
        const memoId = session.memoId;

        if (this.soundEnabled) {
            this.playBreakEndSound();
        }

        this.sessions.delete(memoId);
        this.save();

        for (const listener of this.listeners) {
            if (listener.onBreakEnd) {
                listener.onBreakEnd(session);
            }
        }
        this.notifyChange(session);
        // 定时器由 tick() 末尾统一检查停止

        new Notice('⏰ 休息结束！准备开始下一个番茄吧');
    }

    // ============ 定时器管理 ============

    private startTimer(): void {
        if (this.timerInterval !== null) {
            return;
        }

        this.timerInterval = window.setInterval(() => {
            this.tick();
        }, 1000);
    }

    private checkAndStopTimer(): void {
        const hasActive = Array.from(this.sessions.values()).some(
            s => s.state === 'running' || s.state === 'short_break' || s.state === 'long_break'
        );

        if (!hasActive && this.timerInterval !== null) {
            window.clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }

    // ============ 工具方法 ============

    private notifyChange(session: PomodoroSession): void {
        for (const listener of this.listeners) {
            if (listener.onSessionChange) {
                listener.onSessionChange(session);
            }
        }
    }

    private findSession(sessionId: string): PomodoroSession | undefined {
        // 先从活跃 sessions 中找（休息 session 不在 allSessions 中）
        for (const session of this.sessions.values()) {
            if (session.id === sessionId) return session;
        }
        return this.allSessions.find(s => s.id === sessionId);
    }

    private finalizePausedTime(session: PomodoroSession): void {
        if (session.state === 'paused' && session.pauseHistory) {
            const currentPause = session.pauseHistory.find(p => !p.pauseEndTime);
            if (currentPause) {
                const now = Date.now();
                currentPause.pauseEndTime = now;
                currentPause.duration = Math.floor(
                    (now - currentPause.pauseStartTime) / 1000
                );
                session.pausedAccumulatedSeconds =
                    (session.pausedAccumulatedSeconds || 0) + currentPause.duration;
            }
        }
    }

    private generateId(): string {
        return `pomodoro-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * 专注完成提示音（较高频率，积极感）
     */
    private playNotificationSound(): void {
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
     * 休息结束提示音（两声短促音，提醒回来工作）
     */
    private playBreakEndSound(): void {
        try {
            const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();

            const playBeep = (startTime: number, freq: number) => {
                const osc = audioContext.createOscillator();
                const gain = audioContext.createGain();
                osc.connect(gain);
                gain.connect(audioContext.destination);
                osc.frequency.value = freq;
                osc.type = 'sine';
                gain.gain.setValueAtTime(0.25, startTime);
                gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.3);
                osc.start(startTime);
                osc.stop(startTime + 0.3);
            };

            playBeep(audioContext.currentTime, 600);
            playBeep(audioContext.currentTime + 0.4, 800);
        } catch (error) {
            console.error('Failed to play break end sound:', error);
        }
    }

    dispose(): void {
        if (this.timerInterval !== null) {
            window.clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
        this.listeners.clear();
    }
}
