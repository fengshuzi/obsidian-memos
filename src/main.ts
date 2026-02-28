/**
 * Obsidian 闪念笔记插件 — 入口文件
 *
 * ## 模块职责
 * - main.ts（本文件）: 插件生命周期、命令注册、文件变更监听
 * - MemosView.ts: 主 UI 视图（卡片列表、输入框、番茄钟 UI）
 * - pomodoro.ts: 番茄钟纯逻辑引擎（不依赖 UI）
 * - storage.ts: 日记文件的读写和解析，memo 缓存管理
 * - types.ts: 所有接口/类型定义和正则常量
 *
 * ## 文件变更监听
 * vault.modify + metadataCache.changed 双重监听，确保外部编辑（Alfred/脚本）也能触发刷新
 * 通过 scheduleDebouncedRefresh 合并 300ms 内的多次事件为一次 refresh
 */

import { Plugin, WorkspaceLeaf, addIcon, TFile } from 'obsidian';
import { MemosPluginSettings, DEFAULT_SETTINGS, MEMOS_VIEW_TYPE, POMODORO_STATS_VIEW_TYPE } from './types';
import { MemosStorage } from './storage';
import { MemosView } from './MemosView';
import { MemoInputModal } from './InputModal';
import { MemosSettingTab } from './settings';
import { PomodoroManager } from './pomodoro';
import { PomodoroStatsView } from './PomodoroStatsView';

// 自定义图标
const MEMOS_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;

export default class MemosPlugin extends Plugin {
    settings: MemosPluginSettings = DEFAULT_SETTINGS;
    storage: MemosStorage | null = null;
    pomodoroManager: PomodoroManager | null = null;
    private pendingRefreshTimer: ReturnType<typeof setTimeout> | null = null;

    async onload(): Promise<void> {
        console.log('加载闪念笔记插件');

        // 加载设置
        await this.loadSettings();

        // 初始化存储
        this.storage = new MemosStorage(this.app, this.settings);

        // 初始化番茄钟管理器
        this.pomodoroManager = new PomodoroManager(
            this,
            this.settings.pomodoroDuration,
            this.settings.pomodoroSoundEnabled,
            this.settings.pomodoroShortBreak,
            this.settings.pomodoroLongBreak,
            this.settings.pomodoroLongBreakInterval,
        );
        await this.pomodoroManager.load();

        // 注册自定义图标
        addIcon('memos', MEMOS_ICON);

        // 注册视图
        this.registerView(
            MEMOS_VIEW_TYPE,
            (leaf) => new MemosView(leaf, this, this.storage!, this.settings, this.pomodoroManager!)
        );

        // 注册番茄钟统计视图
        this.registerView(
            POMODORO_STATS_VIEW_TYPE,
            (leaf) => new PomodoroStatsView(leaf, this.pomodoroManager!)
        );

        // 添加侧边栏按钮
        this.addRibbonIcon('lightbulb', '闪念笔记', () => {
            this.activateView();
        });

        // 注册命令
        this.registerCommands();

        // 添加设置页面
        this.addSettingTab(new MemosSettingTab(this.app, this));

        // 文件变更监听：storage.onFileChange 判断是否为日记文件，是则失效缓存并返回 true
        // 两层保障：vault 事件覆盖 Obsidian 内部编辑，metadataCache 覆盖外部工具写入
        const scheduleRefresh = () => this.scheduleDebouncedRefresh();

        this.registerEvent(
            this.app.vault.on('modify', (file) => {
                if (file instanceof TFile && this.storage?.onFileChange(file)) {
                    scheduleRefresh();
                }
            })
        );

        this.registerEvent(
            this.app.vault.on('create', (file) => {
                if (file instanceof TFile && this.storage?.onFileChange(file)) {
                    scheduleRefresh();
                }
            })
        );

        this.registerEvent(
            this.app.vault.on('delete', (file) => {
                if (file instanceof TFile && this.storage?.onFileChange(file)) {
                    scheduleRefresh();
                }
            })
        );

        this.registerEvent(
            this.app.metadataCache.on('changed', (file) => {
                if (file instanceof TFile && this.storage?.onFileChange(file)) {
                    scheduleRefresh();
                }
            })
        );

        // 启动时打开闪念页面
        if (this.settings.openOnStartup) {
            this.app.workspace.onLayoutReady(() => {
                this.activateView();
            });
        }
    }

    onunload(): void {
        console.log('卸载闪念笔记插件');
        if (this.pendingRefreshTimer) {
            clearTimeout(this.pendingRefreshTimer);
        }
        this.pomodoroManager?.dispose();
    }

    /**
     * 300ms 防抖刷新：多次文件变更只触发一次 view.refresh()
     * 配合 MemosView.shouldSkipAutoRefresh() 避免内部修改文件时的多余刷新
     */
    private scheduleDebouncedRefresh(): void {
        if (this.pendingRefreshTimer) {
            clearTimeout(this.pendingRefreshTimer);
        }
        this.pendingRefreshTimer = setTimeout(() => {
            this.pendingRefreshTimer = null;
            const view = this.getActiveMemosView();
            if (view && !view.shouldSkipAutoRefresh()) {
                view.refresh();
            }
        }, 300);
    }

    /**
     * 注册命令
     */
    private registerCommands(): void {
        // 打开闪念视图
        this.addCommand({
            id: 'open-memos-view',
            name: '打开闪念视图',
            callback: () => {
                this.activateView();
            },
        });

        // 快速新建闪念（弹窗）
        this.addCommand({
            id: 'new-memo',
            name: '新建闪念（弹窗）',
            hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'm' }],
            callback: () => {
                this.openInputModal();
            },
        });

        // 发送闪念（在闪念视图输入框中）
        this.addCommand({
            id: 'submit-memo',
            name: '发送闪念',
            hotkeys: [{ modifiers: ['Mod'], key: 'Enter' }],
            callback: () => {
                const view = this.getActiveMemosView();
                if (view) {
                    view.submitFromCommand();
                }
            },
        });

        // 刷新闪念列表
        this.addCommand({
            id: 'refresh-memos',
            name: '刷新闪念列表',
            callback: async () => {
                const view = this.getActiveMemosView();
                if (view) {
                    await view.refresh();
                }
            },
        });

        // 打开番茄钟统计面板
        this.addCommand({
            id: 'open-pomodoro-stats',
            name: '打开番茄钟统计',
            callback: () => {
                this.activatePomodoroStats();
            },
        });
    }

    /**
     * 激活闪念视图
     */
    async activateView(): Promise<void> {
        const { workspace } = this.app;

        // 检查是否已有视图打开
        let leaf = workspace.getLeavesOfType(MEMOS_VIEW_TYPE)[0];

        if (!leaf) {
            // 在主内容区域创建新标签页（和普通文档一样）
            leaf = workspace.getLeaf('tab');
            await leaf.setViewState({
                type: MEMOS_VIEW_TYPE,
                active: true,
            });
        }

        if (leaf) {
            workspace.revealLeaf(leaf);
        }
    }

    /**
     * 激活番茄钟统计侧边栏
     */
    async activatePomodoroStats(): Promise<void> {
        const { workspace } = this.app;

        let leaf = workspace.getLeavesOfType(POMODORO_STATS_VIEW_TYPE)[0];

        if (!leaf) {
            const rightLeaf = workspace.getRightLeaf(false);
            if (rightLeaf) {
                await rightLeaf.setViewState({
                    type: POMODORO_STATS_VIEW_TYPE,
                    active: true,
                });
                leaf = rightLeaf;
            }
        }

        if (leaf) {
            workspace.revealLeaf(leaf);
        }
    }

    /**
     * 打开输入弹窗
     */
    openInputModal(): void {
        if (!this.storage) return;

        const modal = new MemoInputModal(
            this.app,
            this.storage,
            this.settings,
            () => {
                // 刷新视图
                const view = this.getActiveMemosView();
                if (view) {
                    view.refresh();
                }
            }
        );
        modal.open();
    }

    /**
     * 获取当前活跃的闪念视图
     */
    private getActiveMemosView(): MemosView | null {
        const leaves = this.app.workspace.getLeavesOfType(MEMOS_VIEW_TYPE);
        if (leaves.length > 0) {
            return leaves[0].view as MemosView;
        }
        return null;
    }

    /**
     * 加载设置
     */
    async loadSettings(): Promise<void> {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    /**
     * 保存设置
     */
    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
        
        // 更新存储设置
        if (this.storage) {
            this.storage.updateSettings(this.settings);
        }

        // 更新视图设置
        const view = this.getActiveMemosView();
        if (view) {
            view.updateSettings(this.settings);
        }

        // 更新番茄钟设置
        if (this.pomodoroManager) {
            this.pomodoroManager.updateSettings(
                this.settings.pomodoroDuration,
                this.settings.pomodoroSoundEnabled,
                this.settings.pomodoroShortBreak,
                this.settings.pomodoroLongBreak,
                this.settings.pomodoroLongBreakInterval,
            );
        }
    }
}
