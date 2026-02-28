import { ItemView, WorkspaceLeaf, Notice, setIcon } from 'obsidian';
import { POMODORO_STATS_VIEW_TYPE, PomodoroSession } from './types';
import { PomodoroManager, PomodoroEventListener } from './pomodoro';

type SortField = 'startTime' | 'actualMinutes' | 'memoId';
type SortOrder = 'asc' | 'desc';

export class PomodoroStatsView extends ItemView {
    private pomodoroManager: PomodoroManager;
    private listener: PomodoroEventListener;
    private selectedIds: Set<string> = new Set();
    private sortField: SortField = 'startTime';
    private sortOrder: SortOrder = 'desc';
    private filterState: 'all' | 'completed' | 'cancelled' = 'all';

    constructor(leaf: WorkspaceLeaf, pomodoroManager: PomodoroManager) {
        super(leaf);
        this.pomodoroManager = pomodoroManager;

        this.listener = {
            onSessionChange: () => this.renderContent(),
            onSessionComplete: () => this.renderContent(),
        };
        this.pomodoroManager.addListener(this.listener);
    }

    getViewType(): string {
        return POMODORO_STATS_VIEW_TYPE;
    }

    getDisplayText(): string {
        return '番茄钟统计';
    }

    getIcon(): string {
        return 'clock';
    }

    async onOpen(): Promise<void> {
        this.renderContent();
    }

    async onClose(): Promise<void> {
        this.pomodoroManager.removeListener(this.listener);
    }

    private renderContent(): void {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('pomodoro-stats-container');

        this.renderStats(container);
        this.renderToolbar(container);
        this.renderSessionList(container);
    }

    // ============ 统计概览 ============

    private renderStats(container: HTMLElement): void {
        const stats = this.pomodoroManager.getStats();
        const allSessions = this.pomodoroManager.getAllSessions();

        const statsSection = container.createDiv({ cls: 'pomo-stats-overview' });

        // 今日
        const todayRow = statsSection.createDiv({ cls: 'pomo-stats-row pomo-stats-today' });
        todayRow.createEl('h3', { text: '📅 今日' });
        const todayGrid = todayRow.createDiv({ cls: 'pomo-stats-grid' });
        this.createStatCard(todayGrid, '🍅', `${stats.todayPomodoros}`, '个番茄');
        this.createStatCard(todayGrid, '⏱', `${stats.todayFocusMinutes}`, '分钟专注');

        // 总计
        const totalRow = statsSection.createDiv({ cls: 'pomo-stats-row' });
        totalRow.createEl('h3', { text: '📊 总计' });
        const totalGrid = totalRow.createDiv({ cls: 'pomo-stats-grid' });
        this.createStatCard(totalGrid, '🍅', `${stats.totalPomodoros}`, '个番茄');
        this.createStatCard(totalGrid, '⏱', `${stats.totalFocusMinutes}`, '分钟专注');
        const avgMinutes = stats.totalPomodoros > 0
            ? Math.round(stats.totalFocusMinutes / stats.totalPomodoros)
            : 0;
        this.createStatCard(totalGrid, '📐', `${avgMinutes}`, '分钟/个');
        this.createStatCard(totalGrid, '📋', `${allSessions.length}`, '条记录');
    }

    private createStatCard(parent: HTMLElement, icon: string, value: string, label: string): void {
        const card = parent.createDiv({ cls: 'pomo-stat-card' });
        card.createSpan({ cls: 'pomo-stat-icon', text: icon });
        const info = card.createDiv({ cls: 'pomo-stat-info' });
        info.createSpan({ cls: 'pomo-stat-value', text: value });
        info.createSpan({ cls: 'pomo-stat-label', text: label });
    }

    // ============ 工具栏 ============

    private renderToolbar(container: HTMLElement): void {
        const toolbar = container.createDiv({ cls: 'pomo-toolbar' });

        // 筛选
        const filterGroup = toolbar.createDiv({ cls: 'pomo-filter-group' });
        const filters: { label: string; value: typeof this.filterState }[] = [
            { label: '全部', value: 'all' },
            { label: '已完成', value: 'completed' },
        ];
        for (const f of filters) {
            const btn = filterGroup.createEl('button', {
                cls: `pomo-filter-btn ${this.filterState === f.value ? 'pomo-filter-active' : ''}`,
                text: f.label,
            });
            btn.addEventListener('click', () => {
                this.filterState = f.value;
                this.selectedIds.clear();
                this.renderContent();
            });
        }

        // 操作按钮
        const actions = toolbar.createDiv({ cls: 'pomo-toolbar-actions' });

        if (this.selectedIds.size > 0) {
            const deleteBtn = actions.createEl('button', {
                cls: 'pomo-btn pomo-btn-danger',
                text: `🗑 删除选中 (${this.selectedIds.size})`,
            });
            deleteBtn.addEventListener('click', () => {
                this.pomodoroManager.deleteSessions(this.selectedIds);
                this.selectedIds.clear();
                new Notice(`已删除 ${this.selectedIds.size} 条记录`);
            });
        }

        const clearBtn = actions.createEl('button', {
            cls: 'pomo-btn pomo-btn-danger-outline',
            text: '清空全部',
        });
        clearBtn.addEventListener('click', () => {
            const total = this.pomodoroManager.getAllSessions().length;
            if (total === 0) {
                new Notice('没有数据可以清空');
                return;
            }
            this.pomodoroManager.clearAllData();
            this.selectedIds.clear();
            new Notice(`已清空 ${total} 条记录`);
        });
    }

    // ============ 会话列表 ============

    private renderSessionList(container: HTMLElement): void {
        let sessions = this.pomodoroManager.getAllSessions();

        // 筛选
        if (this.filterState === 'completed') {
            sessions = sessions.filter(s => s.state === 'completed');
        }

        // 排序
        sessions.sort((a, b) => {
            let cmp = 0;
            if (this.sortField === 'startTime') {
                cmp = a.startTime - b.startTime;
            } else if (this.sortField === 'actualMinutes') {
                cmp = (a.actualMinutes || 0) - (b.actualMinutes || 0);
            } else if (this.sortField === 'memoId') {
                cmp = a.memoId.localeCompare(b.memoId);
            }
            return this.sortOrder === 'desc' ? -cmp : cmp;
        });

        const listSection = container.createDiv({ cls: 'pomo-session-list' });

        // 表头
        const header = listSection.createDiv({ cls: 'pomo-session-header' });

        const selectAllCb = header.createEl('input', { type: 'checkbox' }) as HTMLInputElement;
        selectAllCb.checked = sessions.length > 0 && this.selectedIds.size === sessions.length;
        selectAllCb.addEventListener('change', () => {
            if (selectAllCb.checked) {
                sessions.forEach(s => this.selectedIds.add(s.id));
            } else {
                this.selectedIds.clear();
            }
            this.renderContent();
        });

        this.createSortableHeader(header, '时间', 'startTime');
        this.createSortableHeader(header, '关联任务', 'memoId');
        this.createSortableHeader(header, '时长', 'actualMinutes');
        header.createSpan({ cls: 'pomo-col-state', text: '状态' });
        header.createSpan({ cls: 'pomo-col-action', text: '操作' });

        if (sessions.length === 0) {
            const empty = listSection.createDiv({ cls: 'pomo-empty' });
            empty.setText('暂无番茄钟记录');
            return;
        }

        // 列表
        for (const session of sessions) {
            this.renderSessionRow(listSection, session);
        }
    }

    private createSortableHeader(parent: HTMLElement, label: string, field: SortField): void {
        const cls = field === 'memoId' ? 'pomo-col-memo' :
            field === 'startTime' ? 'pomo-col-time' : 'pomo-col-duration';
        const headerEl = parent.createSpan({ cls: `${cls} pomo-sortable` });
        const arrow = this.sortField === field
            ? (this.sortOrder === 'desc' ? ' ↓' : ' ↑')
            : '';
        headerEl.setText(`${label}${arrow}`);
        headerEl.addEventListener('click', () => {
            if (this.sortField === field) {
                this.sortOrder = this.sortOrder === 'desc' ? 'asc' : 'desc';
            } else {
                this.sortField = field;
                this.sortOrder = 'desc';
            }
            this.renderContent();
        });
    }

    private renderSessionRow(parent: HTMLElement, session: PomodoroSession): void {
        const row = parent.createDiv({ cls: 'pomo-session-row' });

        // 复选框
        const cb = row.createEl('input', { type: 'checkbox' }) as HTMLInputElement;
        cb.checked = this.selectedIds.has(session.id);
        cb.addEventListener('change', () => {
            if (cb.checked) {
                this.selectedIds.add(session.id);
            } else {
                this.selectedIds.delete(session.id);
            }
            this.renderContent();
        });

        // 时间
        const timeEl = row.createSpan({ cls: 'pomo-col-time' });
        const d = new Date(session.startTime);
        const dateStr = `${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
        const timeStr = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
        timeEl.setText(`${dateStr} ${timeStr}`);

        // 关联任务 memoId
        const memoEl = row.createSpan({ cls: 'pomo-col-memo' });
        const memoId = session.memoId;
        const lastDash = memoId.lastIndexOf('-');
        if (lastDash !== -1) {
            const file = memoId.substring(0, lastDash);
            const line = memoId.substring(lastDash + 1);
            const shortFile = file.split('/').pop() || file;
            memoEl.setText(`${shortFile}:${line}`);
            memoEl.setAttribute('title', memoId);
        } else {
            memoEl.setText(memoId);
        }

        // 时长
        const durEl = row.createSpan({ cls: 'pomo-col-duration' });
        if (session.state === 'completed' && session.actualMinutes !== undefined) {
            durEl.setText(`${session.actualMinutes} 分钟`);
        } else if (session.plannedMinutes) {
            durEl.setText(`${session.plannedMinutes} 分钟(计划)`);
        } else {
            durEl.setText('-');
        }

        // 状态
        const stateEl = row.createSpan({ cls: 'pomo-col-state' });
        const stateMap: Record<string, { text: string; cls: string }> = {
            'completed': { text: '✅ 完成', cls: 'pomo-state-completed' },
            'running': { text: '🍅 运行中', cls: 'pomo-state-running' },
            'paused': { text: '⏸ 暂停', cls: 'pomo-state-paused' },
            'idle': { text: '⏹ 空闲', cls: 'pomo-state-idle' },
            'short_break': { text: '☕ 短休息', cls: 'pomo-state-break' },
            'long_break': { text: '🌿 长休息', cls: 'pomo-state-break' },
        };
        const stateInfo = stateMap[session.state] || { text: session.state, cls: '' };
        const badge = stateEl.createSpan({ cls: `pomo-state-badge ${stateInfo.cls}` });
        badge.setText(stateInfo.text);

        // 操作
        const actionEl = row.createSpan({ cls: 'pomo-col-action' });
        const delBtn = actionEl.createEl('button', {
            cls: 'pomo-row-delete',
            attr: { 'aria-label': '删除' },
        });
        setIcon(delBtn, 'trash-2');
        delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.pomodoroManager.deleteSession(session.id);
            this.selectedIds.delete(session.id);
        });
    }
}
