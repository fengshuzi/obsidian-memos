/**
 * 番茄钟管理器（纯逻辑层，不依赖 UI）
 *
 * ## 架构概览
 * - 本模块是独立的番茄工作法引擎，通过事件监听器模式与 MemosView 通信
 * - 不直接操作 DOM，所有 UI 更新都通过 PomodoroEventListener 回调
 *
 * ## 核心概念
 * - **stableMemoId**: 格式为 `${filePath}-${lineNumber}`，用于关联番茄钟和 memo
 *   注意：这不是 MemoItem.id（随机 UUID），而是基于文件路径和行号的稳定标识
 *   外部编辑可能改变行号导致失效，由 MemosView.reconcilePomodoroSessions() 修复
 *
 * ## 数据模型（双层结构）
 * - `sessions` Map: 活跃会话，key 为 stableMemoId → 快速查找某个 memo 的当前番茄钟
 * - `allSessions` 数组: 全部历史记录（含已完成）→ 统计和历史展示
 * - 两者通过 session.id 关联，session.memoId 存储 stableMemoId
 *
 * ## 状态机
 * ```
 * idle → running ⇄ paused → running → completed → short_break/long_break → idle
 *                                  ↘ stop(cancel) → idle
 * ```
 *
 * ## 持久化
 * 通过 plugin.saveData/loadData 存储到 Obsidian 的 data.json
 * 重启后 running 状态自动转为 paused，休息状态直接丢弃
 */

import { Notice, Plugin } from 'obsidian';
import { PomodoroSession, PomodoroState, PomodoroStats, PomodoroPauseRecord } from './types';

/** MemosView 通过此接口监听番茄钟状态变化，驱动 UI 更新 */
export interface PomodoroEventListener {
    /** 每秒 tick 或状态变化时触发（更新倒计时、切换按钮等） */
    onSessionChange?: (session: PomodoroSession) => void;
    /** 专注阶段自然完成时触发（更新已完成番茄数） */
    onSessionComplete?: (session: PomodoroSession) => void;
    /** 进入休息阶段时触发 */
    onBreakStart?: (session: PomodoroSession) => void;
    /** 休息结束时触发 */
    onBreakEnd?: (session: PomodoroSession) => void;
}

export class PomodoroManager {
    /** 活跃会话表：stableMemoId → session，每个 memo 最多一个活跃会话 */
    private sessions: Map<string, PomodoroSession> = new Map();
    /** 全部历史记录（含已完成的），用于统计和侧边栏展示 */
    private allSessions: PomodoroSession[] = [];
    /** 全局 1 秒定时器句柄，无活跃 session 时自动停止 */
    private timerInterval: number | null = null;
    private listeners: Set<PomodoroEventListener> = new Set();
    /** 宿主插件实例，用于 saveData/loadData 持久化 */
    private plugin: Plugin;

    private duration: number = 25;
    private shortBreakDuration: number = 5;
    private longBreakDuration: number = 15;
    private longBreakInterval: number = 4;
    private soundEnabled: boolean = true;

    /** 每个 memo 的连续完成计数（用于判断长休息），仅运行时维护不持久化 */
    private consecutiveCounts: Map<string, number> = new Map();

    constructor(
        plugin: Plugin,
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

    // ============ 会话生命周期：start / pause / resume / stop / skipBreak ============

    /**
     * 启动番茄钟
     * @param memoId stableMemoId 格式：`${filePath}-${lineNumber}`
     * @param duration 可选自定义时长（分钟）
     * @param memoContent 关联任务的内容摘要，用于统计面板展示
     */
    start(memoId: string, duration?: number, memoContent?: string): PomodoroSession | null {
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
            memoContent: memoContent,
            sessionType: 'focus',
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
        void this.save();
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

        void this.save();
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
        void this.save();

        this.startTimer();
        this.notifyChange(session);

        new Notice('▶ 番茄钟已继续');
    }

    /**
     * 停止番茄钟
     * @param save true=完成并记录到历史（DOING→DONE 时调用）; false=取消丢弃
     */
    stop(sessionId: string, save: boolean = false): void {
        const session = this.findSession(sessionId);
        if (!session) return;

        const memoId = session.memoId;
        const wasBreak = session.state === 'short_break' || session.state === 'long_break';

        if (wasBreak) {
            // 休息阶段被手动结束：更新历史记录后清理
            session.endTime = Date.now();
            session.skipped = true;
            session.actualMinutes = Math.max(0, Math.round(
                (session.endTime - session.startTime) / 60000
            ));
            // 若已在 allSessions 中则直接更新，否则推入（兼容旧数据）
            if (!this.allSessions.find(s => s.id === session.id)) {
                this.allSessions.push(session);
            }
            this.sessions.delete(memoId);
            void this.save();
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
                void this.save();
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

        void this.save();
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

        session.endTime = Date.now();
        session.skipped = true;
        session.actualMinutes = Math.max(0, Math.round(
            (session.endTime - session.startTime) / 60000
        ));
        if (!this.allSessions.find(s => s.id === session.id)) {
            this.allSessions.push(session);
        }

        this.sessions.delete(memoId);
        void this.save();

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

    // ============ 查询接口 ============

    /** 获取某个 memo 的活跃番茄钟（参数为 stableMemoId） */
    getSession(memoId: string): PomodoroSession | undefined {
        return this.sessions.get(memoId);
    }

    /** 获取某个 memo 的所有历史记录（含已完成，参数为 stableMemoId） */
    getMemoPomodoros(memoId: string): PomodoroSession[] {
        return this.allSessions.filter(s => s.memoId === memoId);
    }

    /** 获取所有活跃会话（running / paused / 休息中） */
    getActivePomodoros(): PomodoroSession[] {
        return Array.from(this.sessions.values()).filter(
            s => s.state === 'running' || s.state === 'paused'
                || s.state === 'short_break' || s.state === 'long_break'
        );
    }

    /**
     * 重映射 session 的 memoId
     * 场景：外部工具（如 Alfred）编辑文件导致行号偏移，stableMemoId 失效
     * 由 MemosView.reconcilePomodoroSessions() 在刷新时调用
     */
    remapSessionMemoId(oldMemoId: string, newMemoId: string): void {
        const session = this.sessions.get(oldMemoId);
        if (!session) return;

        this.sessions.delete(oldMemoId);
        session.memoId = newMemoId;
        this.sessions.set(newMemoId, session);

        for (const s of this.allSessions) {
            if (s.memoId === oldMemoId) {
                s.memoId = newMemoId;
            }
        }

        const count = this.consecutiveCounts.get(oldMemoId);
        if (count !== undefined) {
            this.consecutiveCounts.delete(oldMemoId);
            this.consecutiveCounts.set(newMemoId, count);
        }

        void this.save();
    }

    /** 获取汇总统计（今日/全部的番茄数、专注时长、休息时长） */
    getStats(): PomodoroStats {
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

        const isFocus = (s: PomodoroSession) =>
            s.sessionType === 'focus' || !s.sessionType; // 兼容旧数据（无 sessionType 字段）
        const isBreak = (s: PomodoroSession) => s.sessionType === 'break';
        const isEnded = (s: PomodoroSession) =>
            s.state === 'completed' || (s.sessionType === 'break' && !!s.endTime);

        const focusDone = this.allSessions.filter(s => isFocus(s) && s.state === 'completed');
        const breakDone = this.allSessions.filter(s => isBreak(s) && isEnded(s));

        const stats: PomodoroStats = {
            totalPomodoros: focusDone.length,
            totalFocusMinutes: focusDone.reduce((sum, s) => sum + (s.actualMinutes || 0), 0),
            todayPomodoros: focusDone.filter(s => s.startTime >= todayStart).length,
            todayFocusMinutes: focusDone
                .filter(s => s.startTime >= todayStart)
                .reduce((sum, s) => sum + (s.actualMinutes || 0), 0),
            totalBreaks: breakDone.length,
            totalBreakMinutes: breakDone.reduce((sum, s) => sum + (s.actualMinutes || 0), 0),
            todayBreaks: breakDone.filter(s => s.startTime >= todayStart).length,
            todayBreakMinutes: breakDone
                .filter(s => s.startTime >= todayStart)
                .reduce((sum, s) => sum + (s.actualMinutes || 0), 0),
            byTag: {},
        };

        return stats;
    }

    // ============ 数据管理（侧边栏 PomodoroStatsView 使用） ============

    /** 返回全部历史会话的浅拷贝 */
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
        void this.save();
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
        void this.save();
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
        void this.save();
        this.notifyDataChange();
    }

    /** 通知所有监听器数据已变化（批量删除/清空后触发 UI 刷新） */
    private notifyDataChange(): void {
        for (const listener of this.listeners) {
            if (listener.onSessionChange) {
                listener.onSessionChange(undefined as unknown as PomodoroSession);
            }
        }
    }

    addListener(listener: PomodoroEventListener): void {
        this.listeners.add(listener);
    }

    removeListener(listener: PomodoroEventListener): void {
        this.listeners.delete(listener);
    }

    // ============ 持久化（Obsidian data.json） ============

    /** 序列化 Map 和数组，写入 plugin.saveData */
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
     * 从持久化存储恢复状态
     * 重启后处理：running → paused（需用户手动继续），休息中 → 直接丢弃
     */
    async load(): Promise<void> {
        interface SavedData {
            allSessions?: PomodoroSession[];
            sessions?: Array<[string, PomodoroSession]>;
            consecutiveCounts?: Array<[string, number]>;
        }
        try {
            const data = await this.plugin.loadData() as SavedData | null;
            if (data && data.allSessions) {
                this.allSessions = data.allSessions;
                for (const session of this.allSessions) {
                    if (!session.pauseHistory) {
                        session.pauseHistory = [];
                    }
                }
                if (data.sessions) {
                    for (const [memoId, session] of data.sessions) {
                        const s = session;
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
                        this.consecutiveCounts.set(memoId, count);
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

    // ============ 定时器与核心循环（1 秒 tick） ============

    /**
     * 全局 1 秒心跳。先快照再遍历，因为 tickFocus 可能触发 completeSession →
     * startBreak 修改 sessions Map，直接遍历 Map 会导致迭代器失效
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
     * 基于挂钟时间计算剩余秒数，而非累加 tick 次数
     * 原因：浏览器/Electron 在后台标签页会节流 setInterval，
     * 累加方式会导致计时越来越慢。公式：remaining = planned - (now - start - paused)
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
     * 专注阶段倒计时归零时调用
     * 流程：标记完成 → 通知监听器 → 移出活跃表 → 自动进入休息阶段
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
        void this.save();

        // 自动进入休息阶段
        this.startBreak(memoId, count);
    }

    /**
     * 开始休息阶段（completeSession 自动调用）
     * 根据 completedCount % longBreakInterval 决定短休息还是长休息
     */
    private startBreak(memoId: string, completedCount: number): void {
        const isLongBreak = completedCount > 0 && completedCount % this.longBreakInterval === 0;
        const breakMinutes = isLongBreak ? this.longBreakDuration : this.shortBreakDuration;
        const breakState: PomodoroState = isLongBreak ? 'long_break' : 'short_break';

        // 继承关联专注会话的 memoContent，让统计面板能显示任务名
        const focusSession = this.allSessions
            .filter(s => s.memoId === memoId && s.sessionType === 'focus')
            .at(-1);

        const breakSession: PomodoroSession = {
            id: this.generateId(),
            memoId: memoId,
            memoContent: focusSession?.memoContent,
            sessionType: 'break',
            startTime: Date.now(),
            plannedMinutes: breakMinutes,
            state: breakState,
            remainingSeconds: breakMinutes * 60,
            breakMinutes: breakMinutes,
            consecutiveCount: completedCount,
        };

        this.sessions.set(memoId, breakSession);
        this.allSessions.push(breakSession);

        this.startTimer();

        // 触发休息开始事件
        for (const listener of this.listeners) {
            if (listener.onBreakStart) {
                listener.onBreakStart(breakSession);
            }
        }
        this.notifyChange(breakSession);
        void this.save();

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

        session.endTime = Date.now();
        session.actualMinutes = Math.max(0, Math.round(
            (session.endTime - session.startTime) / 60000
        ));
        // state 保持 short_break/long_break，但已有 endTime 可区分是否结束
        // 若已在 allSessions 中则引用相同对象，直接修改即可；否则补推（兼容旧数据）
        if (!this.allSessions.find(s => s.id === session.id)) {
            this.allSessions.push(session);
        }

        this.sessions.delete(memoId);
        void this.save();

        for (const listener of this.listeners) {
            if (listener.onBreakEnd) {
                listener.onBreakEnd(session);
            }
        }
        this.notifyChange(session);
        // 定时器由 tick() 末尾统一检查停止

        new Notice('⏰ 休息结束！准备开始下一个番茄吧');
    }

    // ============ 全局定时器管理（单例，按需启停） ============

    /** 确保全局 1 秒定时器正在运行（幂等） */
    private startTimer(): void {
        if (this.timerInterval !== null) {
            return;
        }

        this.timerInterval = window.setInterval(() => {
            this.tick();
        }, 1000);
    }

    /** 无活跃 session 时停止定时器，节省资源 */
    private checkAndStopTimer(): void {
        const hasActive = Array.from(this.sessions.values()).some(
            s => s.state === 'running' || s.state === 'short_break' || s.state === 'long_break'
        );

        if (!hasActive && this.timerInterval !== null) {
            window.clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }

    // ============ 内部工具方法 ============

    /** 广播状态变化到所有监听器（MemosView 收到后更新对应卡片的番茄钟 UI） */
    private notifyChange(session: PomodoroSession): void {
        for (const listener of this.listeners) {
            if (listener.onSessionChange) {
                listener.onSessionChange(session);
            }
        }
    }

    /**
     * 通过 session.id 查找会话。先查活跃表再查历史表，
     * 因为休息阶段的 session 只存在于活跃表，不在 allSessions 中
     */
    private findSession(sessionId: string): PomodoroSession | undefined {
        for (const session of this.sessions.values()) {
            if (session.id === sessionId) return session;
        }
        return this.allSessions.find(s => s.id === sessionId);
    }

    /** stop 时如果处于暂停状态，结算当前未关闭的暂停记录 */
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
        return `pomodoro-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    }

    // ============ 提示音（Web Audio API） ============

    /** 专注完成提示音：800Hz 正弦波，0.5 秒衰减 */
    private playNotificationSound(): void {
        try {
            const audioContext = new (window.AudioContext || (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)();
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

    /** 休息结束提示音：两声短促音（600Hz + 800Hz），提醒回来工作 */
    private playBreakEndSound(): void {
        try {
            const audioContext = new (window.AudioContext || (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)();

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
