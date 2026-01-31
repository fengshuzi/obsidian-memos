/**
 * Obsidian 闪念笔记插件
 * 像发微博一样记录灵感 - 支持时间戳、标签分类和历史浏览
 */

import { Plugin, WorkspaceLeaf, addIcon, TFile } from 'obsidian';
import { MemosPluginSettings, DEFAULT_SETTINGS, MEMOS_VIEW_TYPE } from './types';
import { MemosStorage } from './storage';
import { MemosView } from './MemosView';
import { MemoInputModal } from './InputModal';
import { MemosSettingTab } from './settings';

// 自定义图标
const MEMOS_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;

export default class MemosPlugin extends Plugin {
    settings: MemosPluginSettings = DEFAULT_SETTINGS;
    storage: MemosStorage | null = null;

    async onload(): Promise<void> {
        console.log('加载闪念笔记插件');

        // 加载设置
        await this.loadSettings();

        // 初始化存储
        this.storage = new MemosStorage(this.app, this.settings);

        // 注册自定义图标
        addIcon('memos', MEMOS_ICON);

        // 注册视图
        this.registerView(
            MEMOS_VIEW_TYPE,
            (leaf) => new MemosView(leaf, this, this.storage!, this.settings)
        );

        // 添加侧边栏按钮
        this.addRibbonIcon('lightbulb', '闪念笔记', () => {
            this.activateView();
        });

        // 注册命令
        this.registerCommands();

        // 添加设置页面
        this.addSettingTab(new MemosSettingTab(this.app, this));

        // 监听日记文件变化（Alfred/外部写入等），失效缓存并刷新视图，无需定时轮询
        this.registerEvent(
            this.app.vault.on('modify', (file) => {
                if (file instanceof TFile && this.storage?.onFileChange(file)) {
                    this.getActiveMemosView()?.refresh();
                }
            })
        );

        this.registerEvent(
            this.app.vault.on('create', (file) => {
                if (file instanceof TFile && this.storage?.onFileChange(file)) {
                    this.getActiveMemosView()?.refresh();
                }
            })
        );

        this.registerEvent(
            this.app.vault.on('delete', (file) => {
                if (file instanceof TFile && this.storage?.onFileChange(file)) {
                    this.getActiveMemosView()?.refresh();
                }
            })
        );

        // 外部修改（如 Alfred/Python 写文件）时，vault 的 modify 可能不触发；metadataCache 在重新解析文件后会触发 changed
        this.registerEvent(
            this.app.metadataCache.on('changed', (file) => {
                if (file instanceof TFile && this.storage?.onFileChange(file)) {
                    this.getActiveMemosView()?.refresh();
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
    }
}
