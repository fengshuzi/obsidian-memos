/**
 * 闪念笔记列表视图（主 UI 层）
 *
 * ## 功能
 * 类似 Flomo/微博的卡片式展示，支持按日期分组、标签筛选和搜索
 * 在 Obsidian 主内容区域显示（和普通文档一样的标签页）
 *
 * ## 番茄钟集成要点
 * - 通过 stableMemoId（`${filePath}-${lineNumber}`）关联 memo 和 PomodoroManager 中的会话
 * - 注意：stableMemoId ≠ MemoItem.id（后者是随机 UUID，每次刷新都会变）
 * - pomodoroUIElements Map 缓存 stableMemoId → DOM 容器，避免每次 tick 都重新查 DOM
 * - 外部编辑导致行号变化时，reconcilePomodoroSessions() 在 loadMemos 中修复映射
 *
 * ## 刷新策略
 * - skipNextAutoRefresh: 内部修改文件（如切换任务状态）时设置，防止 modify 事件触发多余刷新
 * - refreshVersion: 异步操作的取消令牌，新的 loadMemos 会让旧的放弃渲染
 */

import { ItemView, WorkspaceLeaf, Menu, Notice, MarkdownRenderer, TFile } from 'obsidian';
import { MemosStorage } from './storage';
import { MemoItem, MemosPluginSettings, MEMOS_VIEW_TYPE, parseQuickTags, QuickTag, parseSmartKeywords, matchSmartKeyword, matchHabitKeyword, TaskStatus, PomodoroSession } from './types';
import { getFriendlyDateDisplay, debounce, truncateText } from './utils';
import { MemoInputModal } from './InputModal';
import { PomodoroManager } from './pomodoro';
import type MemosPlugin from './main';

export class MemosView extends ItemView {
    private plugin: MemosPlugin;
    private storage: MemosStorage;
    private settings: MemosPluginSettings;
    private pomodoroManager: PomodoroManager;
    private contentContainer: HTMLElement | null = null;
    private memosList: HTMLElement | null = null;
    private currentFilter: { tag?: string; filterTags?: string[]; search?: string; taskListMode?: 'all' | 'todo' | 'done' } = {};
    private displayedMemos: MemoItem[] = [];
    private page: number = 1;
    private inputTextArea: HTMLTextAreaElement | null = null;
    private currentTag: string = '';
    private currentQuickTag: QuickTag | null = null;
    private editingMemo: MemoItem | null = null;
    private quickTagsSelect: HTMLSelectElement | null = null;
    /**
     * 番茄钟 UI 容器缓存：stableMemoId → 该卡片中的 .memos-pomodoro-control 元素
     * 避免 PomodoroManager 每秒 tick 时都要 querySelector 查 DOM
     * loadMemos 重建 DOM 时会 clear，onPomodoroChange 中按需重建
     */
    private pomodoroUIElements: Map<string, HTMLElement> = new Map();
    /**
     * 专注模式：有番茄钟 running/break 时，其他卡片半透明、此卡片高亮
     * 存储的是 stableMemoId，null 表示无专注
     */
    private focusMemoId: string | null = null;
    /**
     * 防自刷环：toggleTaskStatus 修改文件 → vault.modify 事件 → scheduleDebouncedRefresh
     * 设置此标志后，下一次 shouldSkipAutoRefresh() 调用返回 true 并自动重置
     */
    private skipNextAutoRefresh: boolean = false;
    /** 递增版本号：loadMemos 开始时 ++，异步回调检查 myVersion === refreshVersion 判断是否过期 */
    private refreshVersion: number = 0;

    constructor(
        leaf: WorkspaceLeaf,
        plugin: MemosPlugin,
        storage: MemosStorage,
        settings: MemosPluginSettings,
        pomodoroManager: PomodoroManager
    ) {
        super(leaf);
        this.plugin = plugin;
        this.storage = storage;
        this.settings = settings;
        this.pomodoroManager = pomodoroManager;

        // 注册番茄钟事件监听
        this.pomodoroManager.addListener({
            onSessionChange: (session) => this.onPomodoroChange(session),
            onSessionComplete: (session) => this.onPomodoroComplete(session),
            onBreakStart: (session) => this.onPomodoroChange(session),
            onBreakEnd: (session) => this.onPomodoroChange(session),
        });
    }

    getViewType(): string {
        return MEMOS_VIEW_TYPE;
    }

    getDisplayText(): string {
        return '闪念';
    }

    getIcon(): string {
        return 'lightbulb';
    }

    /**
     * 检查是否应该跳过自动刷新（用于内部修改文件时）
     * 调用后会自动重置标志位
     */
    shouldSkipAutoRefresh(): boolean {
        if (this.skipNextAutoRefresh) {
            this.skipNextAutoRefresh = false;
            return true;
        }
        return false;
    }

    async onOpen(): Promise<void> {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass('memos-view-container');
        container.addClass('memos-main-view'); // 主内容区域样式

        // 创建主结构
        this.createHeader(container as HTMLElement);
        this.contentContainer = container.createDiv({ cls: 'memos-content' });
        
        // 加载数据
        await this.loadMemos();
    }

    async onClose(): Promise<void> {
        // 清理
    }

    /**
     * 创建头部区域
     */
    private createHeader(container: HTMLElement): void {
        const header = container.createDiv({ cls: 'memos-header' });

        // 左侧：标题和统计
        const headerLeft = header.createDiv({ cls: 'memos-header-left' });
        const title = headerLeft.createEl('h4', { cls: 'memos-title' });
        title.setText('💡 闪念');
        
        const stats = headerLeft.createDiv({ cls: 'memos-stats' });
        this.updateStats(stats);

        // 右侧：操作按钮
        const headerRight = header.createDiv({ cls: 'memos-header-right' });
        
        // 新建按钮（聚焦输入框）
        const newBtn = headerRight.createEl('button', {
            cls: 'memos-new-btn',
            attr: { 'aria-label': '新建闪念' }
        });
        newBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
        newBtn.addEventListener('click', () => {
            this.cancelEdit();
            this.inputTextArea?.focus();
        });

        // 刷新按钮
        const refreshBtn = headerRight.createEl('button', {
            cls: 'memos-refresh-btn',
            attr: { 'aria-label': '刷新' }
        });
        refreshBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>';
        refreshBtn.addEventListener('click', () => this.refresh());

        // 输入区域
        this.createInputArea(container);

        // 工具栏：搜索和筛选（手机端隐藏搜索框）
        const toolbar = container.createDiv({ cls: 'memos-toolbar' });

        // 搜索框（小屏时隐藏）
        const searchContainer = toolbar.createDiv({ cls: 'memos-search-container' });
        const searchInput = searchContainer.createEl('input', {
            cls: 'memos-search-input',
            attr: {
                type: 'text',
                placeholder: '搜索闪念...',
            }
        });
        
        // 防抖搜索
        const debouncedSearch = debounce((query: string) => {
            this.currentFilter.search = query || undefined;
            this.loadMemos();
        }, 300);
        
        searchInput.addEventListener('input', (e) => {
            debouncedSearch((e.target as HTMLInputElement).value);
        });

        // 标签筛选下拉
        const tagFilter = toolbar.createDiv({ cls: 'memos-tag-filter' });
        this.createTagFilterDropdown(tagFilter);
    }

    /**
     * 创建输入区域（直接在页面上编辑）
     */
    private createInputArea(container: HTMLElement): void {
        const inputArea = container.createDiv({ cls: 'memos-input-area' });

        // 输入框容器（包含输入框和发送按钮）
        const inputRow = inputArea.createDiv({ cls: 'memos-input-row' });

        // 输入框
        this.inputTextArea = inputRow.createEl('textarea', {
            cls: 'memos-inline-input',
            attr: {
                placeholder: this.settings.placeholder,
                rows: '1',
            }
        });

        // 发送按钮
        const sendBtn = inputRow.createEl('button', {
            cls: 'memos-send-btn',
            attr: { 'aria-label': '发送 (⌘+Enter)' }
        });
        sendBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>';
        sendBtn.addEventListener('click', () => {
            this.submitInlineInput();
        });

        // 自动调整高度（手机端单行不扩展，由 CSS 控制）
        this.inputTextArea.addEventListener('input', () => {
            if (!this.inputTextArea) return;
            const isMobile = window.matchMedia('(max-width: 768px)').matches;
            if (isMobile) return;
            this.inputTextArea.style.height = 'auto';
            this.inputTextArea.style.height = Math.min(this.inputTextArea.scrollHeight, 150) + 'px';
        });

        // 快捷键处理
        this.inputTextArea.onkeydown = (e: KeyboardEvent) => {
            // Escape 取消编辑
            if ((e.key === 'Escape' || e.keyCode === 27) && this.editingMemo) {
                e.preventDefault();
                this.cancelEdit();
                return false;
            }
            return true;
        };

        // 快捷标签区域（桌面：按钮；手机端由 CSS 隐藏按钮、显示下拉）
        const quickTags = parseQuickTags(this.settings.quickTags);
        if (quickTags.length > 0) {
            const quickTagsContainer = inputArea.createDiv({ cls: 'memos-inline-quick-tags' });

            const syncQuickTagsSelect = () => {
                if (this.quickTagsSelect) {
                    this.quickTagsSelect.value = this.currentTag || '';
                }
            };

            // "全部"按钮
            const allBtn = quickTagsContainer.createEl('button', {
                cls: 'memos-quick-tag memos-quick-tag-all is-active',
                text: '全部'
            });
            allBtn.addEventListener('click', async () => {
                this.currentTag = '';
                this.currentQuickTag = null;
                this.currentFilter.tag = undefined;
                this.currentFilter.filterTags = undefined;
                this.currentFilter.taskListMode = undefined; // 清除任务列表模式
                quickTagsContainer.querySelectorAll('.memos-quick-tag').forEach(btn => {
                    btn.removeClass('is-active');
                });
                allBtn.addClass('is-active');
                syncQuickTagsSelect();
                await this.loadMemos();
            });

            // 快捷标签按钮
            for (const tag of quickTags) {
                const tagBtn = quickTagsContainer.createEl('button', {
                    cls: 'memos-quick-tag',
                    text: tag.label
                });
                tagBtn.setAttribute('data-keyword', tag.keyword);

                tagBtn.addEventListener('click', async () => {
                    this.currentTag = tag.keyword;
                    this.currentQuickTag = tag;
                    this.currentFilter.tag = tag.keyword;
                    this.currentFilter.filterTags = tag.keywords;
                    this.currentFilter.taskListMode = undefined; // 清除任务列表模式
                    quickTagsContainer.querySelectorAll('.memos-quick-tag').forEach(btn => {
                        btn.removeClass('is-active');
                    });
                    tagBtn.addClass('is-active');
                    syncQuickTagsSelect();
                    await this.loadMemos();
                });
            }

            // 特殊任务列表标签
            if (this.settings.enableTaskListTags) {
                // 所有任务
                const allTasksBtn = quickTagsContainer.createEl('button', {
                    cls: 'memos-quick-tag memos-task-list-tag',
                    text: this.settings.allTasksTagName
                });
                allTasksBtn.addEventListener('click', async () => {
                    this.currentTag = '';
                    this.currentQuickTag = null;
                    this.currentFilter.tag = undefined;
                    this.currentFilter.filterTags = undefined;
                    this.currentFilter.taskListMode = 'all'; // 显示所有任务
                    quickTagsContainer.querySelectorAll('.memos-quick-tag').forEach(btn => {
                        btn.removeClass('is-active');
                    });
                    allTasksBtn.addClass('is-active');
                    syncQuickTagsSelect();
                    await this.loadMemos();
                });

                // 待办任务
                const todoListBtn = quickTagsContainer.createEl('button', {
                    cls: 'memos-quick-tag memos-task-list-tag',
                    text: this.settings.todoListTagName
                });
                todoListBtn.addEventListener('click', async () => {
                    this.currentTag = '';
                    this.currentQuickTag = null;
                    this.currentFilter.tag = undefined;
                    this.currentFilter.filterTags = undefined;
                    this.currentFilter.taskListMode = 'todo'; // 只显示未完成任务
                    quickTagsContainer.querySelectorAll('.memos-quick-tag').forEach(btn => {
                        btn.removeClass('is-active');
                    });
                    todoListBtn.addClass('is-active');
                    syncQuickTagsSelect();
                    await this.loadMemos();
                });

                // 已完成任务
                const doneListBtn = quickTagsContainer.createEl('button', {
                    cls: 'memos-quick-tag memos-task-list-tag',
                    text: this.settings.doneListTagName
                });
                doneListBtn.addEventListener('click', async () => {
                    this.currentTag = '';
                    this.currentQuickTag = null;
                    this.currentFilter.tag = undefined;
                    this.currentFilter.filterTags = undefined;
                    this.currentFilter.taskListMode = 'done'; // 只显示已完成任务
                    quickTagsContainer.querySelectorAll('.memos-quick-tag').forEach(btn => {
                        btn.removeClass('is-active');
                    });
                    doneListBtn.addClass('is-active');
                    syncQuickTagsSelect();
                    await this.loadMemos();
                });
            }

            // 手机端：标签下拉（小屏时 CSS 显示、按钮隐藏，包含"全部"选项）
            const dropdownWrap = inputArea.createDiv({ cls: 'memos-quick-tags-dropdown' });
            const select = dropdownWrap.createEl('select', { cls: 'memos-quick-tags-select' });
            this.quickTagsSelect = select;
            // 手机端：添加"全部"选项和配置的标签
            if (quickTags.length > 0) {
                // 添加"全部"选项（显示全部内容）
                const allOption = select.createEl('option', { value: '', text: '全部' });
                allOption.setAttribute('selected', 'true');
                // 添加配置的标签
                for (const tag of quickTags) {
                    select.createEl('option', { value: tag.keyword, text: tag.label });
                }
            }
            select.addEventListener('change', async () => {
                const value = select.value;
                if (!value) {
                    // 选择了"全部"选项，清除所有筛选条件，显示全部内容
                    this.currentTag = '';
                    this.currentQuickTag = null;
                    this.currentFilter.tag = undefined;
                    this.currentFilter.filterTags = undefined;
                    quickTagsContainer.querySelectorAll('.memos-quick-tag').forEach(btn => {
                        btn.removeClass('is-active');
                    });
                    allBtn.addClass('is-active');
                } else {
                    const tag = quickTags.find(t => t.keyword === value);
                    if (tag) {
                        this.currentTag = tag.keyword;
                        this.currentQuickTag = tag;
                        this.currentFilter.tag = tag.keyword;
                        this.currentFilter.filterTags = tag.keywords;
                        quickTagsContainer.querySelectorAll('.memos-quick-tag').forEach(btn => {
                            btn.removeClass('is-active');
                            if (btn.getAttribute('data-keyword') === value) btn.addClass('is-active');
                        });
                        allBtn.removeClass('is-active');
                    }
                }
                await this.loadMemos();
            });
        }
    }

    /**
     * 提交内联输入
     */
    private async submitInlineInput(): Promise<void> {
        const content = this.inputTextArea?.value?.trim();
        if (!content) {
            new Notice('请输入内容');
            return;
        }

        // 智能标签追加
        let tags: string[] = [];
        
        // 1. 先检查智能关键词（记账识别，需要数字）
        const smartKeywords = parseSmartKeywords(this.settings.smartKeywords);
        const smartTag = matchSmartKeyword(content, smartKeywords);
        if (smartTag && !content.includes(`#${smartTag}`)) {
            tags.push(smartTag);
        }
        
        // 2. 检查习惯打卡关键词（不需要数字）
        const habitKeywords = parseSmartKeywords(this.settings.habitKeywords);
        const habitTag = matchHabitKeyword(content, habitKeywords);
        if (habitTag && !content.includes(`#${habitTag}`) && !tags.includes(habitTag)) {
            tags.push(habitTag);
        }
        
        // 3. 再检查快捷标签分组
        if (this.currentQuickTag && this.currentQuickTag.keywords.length > 0) {
            // 检查内容中是否已包含分组内的任意标签（包括刚添加的智能标签）
            const allTagsToCheck = [...this.currentQuickTag.keywords, ...tags];
            const contentHasGroupTag = this.currentQuickTag.keywords.some(keyword => 
                content.includes(`#${keyword}`) || tags.includes(keyword)
            );
            if (!contentHasGroupTag) {
                // 内容中没有分组标签，追加第一个关键词
                tags.push(this.currentQuickTag.keyword);
            }
        } else if (this.currentTag) {
            // 单关键词模式（向后兼容）
            if (!content.includes(`#${this.currentTag}`) && !tags.includes(this.currentTag)) {
                tags.push(this.currentTag);
            }
        }

        try {
            let success: boolean;
            
            if (this.editingMemo) {
                // 编辑模式
                success = await this.storage.updateMemo(this.editingMemo, content, tags);
                if (success) {
                    new Notice('✅ 闪念已更新');
                }
            } else {
                // 新建模式
                const memo = await this.storage.saveMemo(content, tags);
                success = !!memo;
                if (success) {
                    new Notice('✨ 闪念已记录');
                }
            }

            if (success) {
                // 清空输入框
                if (this.inputTextArea) {
                    this.inputTextArea.value = '';
                    this.inputTextArea.style.height = 'auto';
                }
                this.editingMemo = null;
                this.updateInputAreaState();
                await this.refresh();
            } else {
                new Notice('保存失败，请重试');
            }
        } catch (error) {
            console.error('保存闪念失败:', error);
            new Notice('保存失败: ' + (error as Error).message);
        }
    }

    /**
     * 加载闪念到输入框进行编辑
     */
    private loadMemoForEdit(memo: MemoItem): void {
        this.editingMemo = memo;
        if (this.inputTextArea) {
            this.inputTextArea.value = memo.content;
            this.inputTextArea.style.height = 'auto';
            this.inputTextArea.style.height = Math.min(this.inputTextArea.scrollHeight, 150) + 'px';
            this.inputTextArea.focus();
            // 光标移到末尾
            this.inputTextArea.selectionStart = this.inputTextArea.value.length;
            this.inputTextArea.selectionEnd = this.inputTextArea.value.length;
        }
        
        // 设置标签
        if (memo.tags.length > 0) {
            this.currentTag = memo.tags[0];
            // 更新标签按钮状态
            const quickTagsContainer = this.containerEl.querySelector('.memos-inline-quick-tags');
            if (quickTagsContainer) {
                quickTagsContainer.querySelectorAll('.memos-quick-tag').forEach(btn => {
                    btn.removeClass('is-active');
                    if (btn.getAttribute('data-keyword') === this.currentTag) {
                        btn.addClass('is-active');
                    }
                });
            }
        }
        
        this.updateInputAreaState();
    }

    /**
     * 取消编辑
     */
    private cancelEdit(): void {
        this.editingMemo = null;
        if (this.inputTextArea) {
            this.inputTextArea.value = '';
            this.inputTextArea.style.height = 'auto';
        }
        this.currentTag = '';
        this.currentQuickTag = null;
        // 重置标签按钮
        const quickTagsContainer = this.containerEl.querySelector('.memos-inline-quick-tags');
        if (quickTagsContainer) {
            quickTagsContainer.querySelectorAll('.memos-quick-tag').forEach(btn => {
                btn.removeClass('is-active');
            });
            quickTagsContainer.querySelector('.memos-quick-tag-all')?.addClass('is-active');
        }
        this.updateInputAreaState();
    }

    /**
     * 更新输入区域状态（编辑模式提示）
     */
    private updateInputAreaState(): void {
        const inputArea = this.containerEl.querySelector('.memos-input-area');
        if (!inputArea) return;

        // 移除旧的编辑提示
        inputArea.querySelector('.memos-edit-hint')?.remove();

        if (this.editingMemo) {
            inputArea.addClass('is-editing');
            const hint = inputArea.createDiv({ cls: 'memos-edit-hint' });
            hint.innerHTML = `<span>编辑中</span><button class="memos-cancel-edit">取消</button>`;
            hint.querySelector('.memos-cancel-edit')?.addEventListener('click', () => {
                this.cancelEdit();
            });
        } else {
            inputArea.removeClass('is-editing');
        }
    }

    /**
     * 创建标签筛选下拉菜单
     */
    private async createTagFilterDropdown(container: HTMLElement): Promise<void> {
        const tags = await this.storage.getAllTags();
        
        const select = container.createEl('select', { cls: 'memos-tag-select' });
        
        // 默认选项
        const defaultOption = select.createEl('option', { value: '' });
        defaultOption.setText('全部标签');
        
        // 标签选项
        for (const tag of tags) {
            const option = select.createEl('option', { value: tag });
            option.setText(`#${tag}`);
        }

        select.addEventListener('change', () => {
            this.currentFilter.tag = select.value || undefined;
            this.currentFilter.filterTags = undefined; // 下拉框只支持单标签筛选
            this.loadMemos();
        });
    }

    /**
     * 更新统计信息
     */
    private async updateStats(container: HTMLElement): Promise<void> {
        const stats = await this.storage.getStats();
        container.empty();
        container.createSpan({ 
            text: `共 ${stats.totalMemos} 条 · 今日 ${stats.todayMemos} 条`,
            cls: 'memos-stats-text'
        });
    }

    /**
     * 加载闪念笔记
     */
    async loadMemos(): Promise<void> {
        if (!this.contentContainer) return;

        const myVersion = ++this.refreshVersion;

        // 清理旧的番茄钟 UI 引用（DOM 即将被销毁）
        this.pomodoroUIElements.clear();

        this.contentContainer.empty();
        this.page = 1;

        // 显示加载状态
        const loading = this.contentContainer.createDiv({ cls: 'memos-loading' });
        loading.setText('加载中...');

        try {
            let memos: MemoItem[];

            // 根据筛选条件获取数据：标签与内容搜索是 AND 关系
            // 特殊处理：小番茄标签 → 展示 rawText 中包含 🍅 的笔记（已记录番茄数的已完成任务）
            const isPomodoriFilter =
                this.currentFilter.filterTags?.includes('小番茄') ||
                this.currentFilter.tag === '小番茄';

            if (isPomodoriFilter) {
                const allMemos = await this.storage.getAllMemos();
                memos = allMemos.filter(m => m.rawText.includes('🍅'));
            } else if (this.currentFilter.filterTags && this.currentFilter.filterTags.length > 0) {
                memos = await this.storage.getMemosByTags(this.currentFilter.filterTags);
            } else if (this.currentFilter.tag) {
                memos = await this.storage.getMemosByTag(this.currentFilter.tag);
            } else {
                memos = await this.storage.getAllMemos();
            }

            // 有更新的 refresh 启动，当前已过期，放弃渲染
            if (myVersion !== this.refreshVersion) return;

            // 任务列表模式过滤
            if (this.currentFilter.taskListMode) {
                if (this.currentFilter.taskListMode === 'all') {
                    memos = memos.filter(memo => memo.taskStatus !== undefined);
                } else if (this.currentFilter.taskListMode === 'todo') {
                    memos = memos.filter(memo => 
                        memo.taskStatus === 'CHECKBOX_UNCHECKED' ||
                        memo.taskStatus === 'TODO' ||
                        memo.taskStatus === 'DOING' ||
                        memo.taskStatus === 'NOW' ||
                        memo.taskStatus === 'LATER' ||
                        memo.taskStatus === 'WAITING'
                    );
                } else if (this.currentFilter.taskListMode === 'done') {
                    memos = memos.filter(memo => 
                        memo.taskStatus === 'CHECKBOX_CHECKED' ||
                        memo.taskStatus === 'DONE' ||
                        memo.taskStatus === 'CANCELLED'
                    );
                }
            }

            const searchQuery = this.currentFilter.search?.trim();
            if (searchQuery) {
                const lowerQuery = searchQuery.toLowerCase();
                memos = memos.filter(memo =>
                    memo.content.toLowerCase().includes(lowerQuery) ||
                    memo.tags.some(tag => tag.toLowerCase().includes(lowerQuery))
                );
            }

            this.displayedMemos = memos;

            // 外部编辑可能改变行号，协调番茄钟 session 的 memoId
            if (this.settings.enablePomodoro) {
                this.reconcilePomodoroSessions();
            }
            
            // 移除加载状态
            loading.remove();

            if (memos.length === 0) {
                this.showEmptyState();
                return;
            }

            // 创建列表容器
            this.memosList = this.contentContainer.createDiv({ cls: 'memos-list' });
            
            // 分页显示
            this.renderMemos();

            // 如果有更多数据，添加加载更多按钮
            if (memos.length > this.settings.itemsPerPage) {
                this.addLoadMoreButton();
            }
        } catch (error) {
            console.error('加载闪念失败:', error);
            if (myVersion === this.refreshVersion) {
                loading.setText('加载失败，请重试');
            }
        }
    }

    /**
     * 渲染闪念列表
     */
    private renderMemos(): void {
        if (!this.memosList) return;

        this.memosList.empty();

        const start = 0;
        const end = this.page * this.settings.itemsPerPage;
        const memosToShow = this.displayedMemos.slice(start, end);

        // 按日期分组
        let currentDate = '';
        
        for (const memo of memosToShow) {
            // 日期分隔符
            if (memo.dateString !== currentDate) {
                currentDate = memo.dateString;
                const dateHeader = this.memosList.createDiv({ cls: 'memos-date-header' });
                dateHeader.setText(getFriendlyDateDisplay(memo.dateString));
            }

            // 渲染单条闪念
            this.renderMemoCard(memo);
        }

        // 列表重新渲染后，恢复专注模式（memosList 可能是新建的 DOM 元素）
        if (this.focusMemoId) {
            // 检查该番茄钟是否仍在运行
            const activeSession = this.pomodoroManager.getActivePomodoros().find(
                s => s.memoId === this.focusMemoId &&
                    (s.state === 'running' || s.state === 'short_break' || s.state === 'long_break')
            );
            if (activeSession) {
                this.memosList.addClass('memos-focus-mode');
                const lastDash = this.focusMemoId.lastIndexOf('-');
                if (lastDash !== -1) {
                    const filePath = this.focusMemoId.substring(0, lastDash);
                    const lineNumber = parseInt(this.focusMemoId.substring(lastDash + 1));
                    const memo = this.displayedMemos.find(
                        m => m.filePath === filePath && m.lineNumber === lineNumber
                    );
                    if (memo) {
                        const card = this.memosList.querySelector(
                            `[data-memo-id="${memo.id}"]`
                        ) as HTMLElement;
                        if (card) {
                            card.addClass('memos-focus-target');
                        }
                    }
                }
            } else {
                // 番茄钟已不在运行，清理专注模式
                this.focusMemoId = null;
            }
        }
    }

    /**
     * 渲染单条闪念卡片
     * 简洁风格：直接显示完整内容，和笔记格式一致
     * 支持任务状态显示和时间追踪
     */
    private renderMemoCard(memo: MemoItem): void {
        if (!this.memosList) return;

        const card = this.memosList.createDiv({ cls: 'memos-card' });
        card.setAttribute('data-memo-id', memo.id);

        // 专注模式：标记当前专注的卡片
        if (this.focusMemoId) {
            const stableMemoId = `${memo.filePath}-${memo.lineNumber}`;
            if (stableMemoId === this.focusMemoId) {
                card.addClass('memos-focus-target');
            }
        }

        // 如果是任务，添加任务状态类
        if (memo.taskStatus) {
            card.addClass('memos-card-task');
            card.addClass(`memos-task-${memo.taskStatus.toLowerCase()}`);
        }

        // 卡片内容
        const cardContent = card.createDiv({ cls: 'memos-card-content' });
        
        // 对于复选框任务，直接创建 HTML 元素并支持点击切换
        if (memo.taskStatus === 'CHECKBOX_UNCHECKED' || memo.taskStatus === 'CHECKBOX_CHECKED') {
            const taskContainer = cardContent.createDiv({ cls: 'memos-task-container' });
            
            // 创建复选框
            const checkbox = taskContainer.createEl('input', {
                type: 'checkbox',
                cls: 'task-list-item-checkbox'
            });
            checkbox.checked = memo.taskStatus === 'CHECKBOX_CHECKED';
            
            // 如果启用时间追踪，点击复选框切换任务状态
            if (this.settings.enableTimeTracking) {
                checkbox.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    await this.toggleTaskStatus(memo);
                });
            } else {
                // 禁用时间追踪时，复选框只读
                checkbox.disabled = true;
            }
            
            // 创建文本内容
            const textSpan = taskContainer.createSpan({ cls: 'memos-task-text' });
            let textContent = '';
            if (memo.timeString) {
                textContent += memo.timeString + ' ';
            }
            if (memo.tags.length > 0) {
                textContent += memo.tags.map(t => `#${t}`).join(' ') + ' ';
            }
            textContent += memo.content;
            
            // 渲染文本内容（支持 Markdown）
            MarkdownRenderer.render(
                this.app,
                textContent,
                textSpan,
                memo.filePath,
                this
            );
        } 
        // 对于关键词任务，渲染为复选框 + 状态标签（参考 time-tracking）
        else if (memo.taskStatus) {
            const taskContainer = cardContent.createDiv({ cls: 'memos-task-keyword-container' });
            
            // 创建复选框（用于点击切换）
            const checkbox = taskContainer.createEl('input', {
                type: 'checkbox',
                cls: 'task-list-item-checkbox'
            });
            checkbox.checked = memo.taskStatus === 'DONE' || memo.taskStatus === 'CANCELLED';
            
            // 如果启用时间追踪，点击复选框切换任务状态
            if (this.settings.enableTimeTracking) {
                checkbox.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    await this.toggleTaskStatus(memo);
                });
            } else {
                // 禁用时间追踪时，复选框只读
                checkbox.disabled = true;
            }
            
            // 显示状态标签（除了 TODO 和 DONE，它们只显示复选框）
            if (!['TODO', 'DONE'].includes(memo.taskStatus)) {
                const statusLabel = taskContainer.createEl('span', {
                    cls: `memos-task-status-label memos-status-${memo.taskStatus.toLowerCase()}`
                });
                statusLabel.textContent = memo.taskStatus;
            }
            
            // 创建文本内容
            const textSpan = taskContainer.createSpan({ cls: 'memos-task-text' });
            let textContent = '';
            if (memo.timeString) {
                textContent += memo.timeString + ' ';
            }
            if (memo.tags.length > 0) {
                textContent += memo.tags.map(t => `#${t}`).join(' ') + ' ';
            }
            textContent += memo.content;
            
            MarkdownRenderer.render(
                this.app,
                textContent,
                textSpan,
                memo.filePath,
                this
            );
        }
        // 普通闪念
        else {
            let displayContent = '';
            if (memo.timeString) {
                displayContent = memo.timeString + ' ';
            }
            if (memo.tags.length > 0) {
                displayContent += memo.tags.map(t => `#${t}`).join(' ') + ' ';
            }
            displayContent += memo.content;
            
            MarkdownRenderer.render(
                this.app,
                displayContent,
                cardContent,
                memo.filePath,
                this
            );
        }

        // 更多操作按钮（悬停显示）
        const moreBtn = card.createEl('button', { 
            cls: 'memos-card-more',
            attr: { 'aria-label': '更多操作' }
        });
        moreBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="19" r="1"></circle></svg>';
        moreBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showMemoMenu(memo, moreBtn);
        });

        // 番茄钟控制区（仅任务显示）
        if (this.settings.enablePomodoro && memo.taskStatus) {
            this.renderPomodoroControl(memo, card);
        }

        // 点击卡片跳转到源文件
        card.addEventListener('click', () => {
            this.openMemoInFile(memo);
        });
    }

    /**
     * 点击复选框时切换任务状态并追踪时间
     * 修改文件后局部更新卡片 DOM（不触发全量 loadMemos），并联动番茄钟：
     * - TODO/[ ] → DOING: 自动启动番茄钟
     * - DOING → DONE/[x]: 自动停止并保存番茄钟
     */
    private async toggleTaskStatus(memo: MemoItem): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(memo.filePath);
        if (!(file instanceof TFile)) return;

        const content = await this.app.vault.read(file);
        const lines = content.split('\n');

        if (memo.lineNumber < 1 || memo.lineNumber > lines.length) return;

        const lineIndex = memo.lineNumber - 1;
        const oldLine = lines[lineIndex];
        // 使用稳定的 memoId（与番茄钟一致）
        const stableMemoId = `${memo.filePath}-${memo.lineNumber}`;
        const newLine = this.toggleTaskStatusInLine(oldLine, stableMemoId);

        // 记录旧状态，用于判断是否需要启动番茄钟
        const oldStatus = memo.taskStatus;

        // 设置标志位，阻止内部修改文件时的自动刷新
        this.skipNextAutoRefresh = true;

        try {
            // 修改文件
            lines[lineIndex] = newLine;
            await this.app.vault.modify(file, lines.join('\n'));

            // 解析新的 memo
            let updatedMemo = this.storage.parseMemoLine(
                newLine,
                memo.filePath,
                memo.lineNumber,
                memo.dateString
            );

            if (updatedMemo) {
                // ⭐ 关键修复：保持原来的 ID 不变
                // 因为 parseMemoLine 会生成新的随机 ID，导致番茄钟找不到 memo
                updatedMemo.id = memo.id;

                // 更新缓存
                this.storage.updateMemoInCache(updatedMemo);

                // 更新 displayedMemos 中的数据
                const displayIndex = this.displayedMemos.findIndex(m =>
                    m.filePath === memo.filePath &&
                    m.lineNumber === memo.lineNumber
                );
                if (displayIndex !== -1) {
                    this.displayedMemos[displayIndex] = updatedMemo;
                }

                // 局部更新卡片 UI
                this.updateSingleCard(memo.id, updatedMemo);

                // 如果启用了番茄钟，且任务从 TODO/CHECKBOX_UNCHECKED 变为 DOING，自动启动番茄钟
                if (this.settings.enablePomodoro && updatedMemo.taskStatus === 'DOING') {
                    const wasTodo = oldStatus === 'TODO' || oldStatus === 'CHECKBOX_UNCHECKED';
                    if (wasTodo) {
                        // 使用稳定的 memoId：filePath-lineNumber
                        const stableMemoId = `${updatedMemo.filePath}-${updatedMemo.lineNumber}`;
                        console.log('启动番茄钟，stableMemoId:', stableMemoId);

                        setTimeout(() => {
                            // 用切换前的原始内容，避免 DOING 行中包含 <!-- ts:... --> 注释
                            this.pomodoroManager.start(stableMemoId, undefined, memo.content);
                        }, 200);
                    }
                }

                // 如果启用了番茄钟，且任务从 DOING 变成 DONE/CANCELLED，自动停止并保存番茄钟
                if (this.settings.enablePomodoro &&
                    (updatedMemo.taskStatus === 'DONE' || updatedMemo.taskStatus === 'CANCELLED') &&
                    oldStatus === 'DOING') {
                    const stableMemoId = `${updatedMemo.filePath}-${updatedMemo.lineNumber}`;
                    const session = this.pomodoroManager.getSession(stableMemoId);

                    if (session && (session.state === 'short_break' || session.state === 'long_break')) {
                        setTimeout(() => {
                            this.pomodoroManager.skipBreak(stableMemoId);
                        }, 200);
                    } else if (session && (session.state === 'running' || session.state === 'paused')) {
                        console.log('任务完成，停止番茄钟，stableMemoId:', stableMemoId);

                        setTimeout(() => {
                            this.pomodoroManager.stop(session.id, true);
                        }, 200);
                    }
                }
            }
        } finally {
            // 延迟重置标志位，确保 modify 事件已经处理完毕
            setTimeout(() => {
                this.skipNextAutoRefresh = false;
            }, 300);
        }
    }

    /**
     * 更新单个卡片（局部更新，不刷新整个列表）
     */
    private updateSingleCard(oldMemoId: string, newMemo: MemoItem): void {
        if (!this.memosList) return;

        // 找到对应的卡片
        const card = this.memosList.querySelector(`[data-memo-id="${oldMemoId}"]`) as HTMLElement;
        if (!card) return;

        // ⭐ 重要：清理番茄钟 UI 元素的旧引用，因为卡片要被替换了
        this.pomodoroUIElements.delete(oldMemoId);

        // 添加更新动画类
        card.addClass('updating');

        // 创建新卡片
        const newCard = this.memosList.createDiv({ cls: 'memos-card' });
        newCard.setAttribute('data-memo-id', newMemo.id);

        // 专注模式：标记当前专注的卡片
        if (this.focusMemoId) {
            const stableMemoId = `${newMemo.filePath}-${newMemo.lineNumber}`;
            if (stableMemoId === this.focusMemoId) {
                newCard.addClass('memos-focus-target');
            }
        }

        // 如果是任务，添加任务状态类
        if (newMemo.taskStatus) {
            newCard.addClass('memos-card-task');
            newCard.addClass(`memos-task-${newMemo.taskStatus.toLowerCase()}`);
        }

        // 卡片内容
        const cardContent = newCard.createDiv({ cls: 'memos-card-content' });
        
        // 对于复选框任务
        if (newMemo.taskStatus === 'CHECKBOX_UNCHECKED' || newMemo.taskStatus === 'CHECKBOX_CHECKED') {
            const taskContainer = cardContent.createDiv({ cls: 'memos-task-container' });
            
            const checkbox = taskContainer.createEl('input', {
                type: 'checkbox',
                cls: 'task-list-item-checkbox'
            });
            checkbox.checked = newMemo.taskStatus === 'CHECKBOX_CHECKED';
            
            if (this.settings.enableTimeTracking) {
                checkbox.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    await this.toggleTaskStatus(newMemo);
                });
            } else {
                checkbox.disabled = true;
            }
            
            const textSpan = taskContainer.createSpan({ cls: 'memos-task-text' });
            let textContent = '';
            if (newMemo.timeString) {
                textContent += newMemo.timeString + ' ';
            }
            if (newMemo.tags.length > 0) {
                textContent += newMemo.tags.map(t => `#${t}`).join(' ') + ' ';
            }
            textContent += newMemo.content;
            
            MarkdownRenderer.render(
                this.app,
                textContent,
                textSpan,
                newMemo.filePath,
                this
            );
        } 
        // 对于关键词任务
        else if (newMemo.taskStatus) {
            const taskContainer = cardContent.createDiv({ cls: 'memos-task-keyword-container' });
            
            const checkbox = taskContainer.createEl('input', {
                type: 'checkbox',
                cls: 'task-list-item-checkbox'
            });
            checkbox.checked = newMemo.taskStatus === 'DONE' || newMemo.taskStatus === 'CANCELLED';
            
            if (this.settings.enableTimeTracking) {
                checkbox.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    await this.toggleTaskStatus(newMemo);
                });
            } else {
                checkbox.disabled = true;
            }
            
            if (!['TODO', 'DONE'].includes(newMemo.taskStatus)) {
                const statusLabel = taskContainer.createEl('span', {
                    cls: `memos-task-status-label memos-status-${newMemo.taskStatus.toLowerCase()}`
                });
                statusLabel.textContent = newMemo.taskStatus;
            }
            
            const textSpan = taskContainer.createSpan({ cls: 'memos-task-text' });
            let textContent = '';
            if (newMemo.timeString) {
                textContent += newMemo.timeString + ' ';
            }
            if (newMemo.tags.length > 0) {
                textContent += newMemo.tags.map(t => `#${t}`).join(' ') + ' ';
            }
            textContent += newMemo.content;
            
            MarkdownRenderer.render(
                this.app,
                textContent,
                textSpan,
                newMemo.filePath,
                this
            );
        }
        // 普通闪念
        else {
            let displayContent = '';
            if (newMemo.timeString) {
                displayContent = newMemo.timeString + ' ';
            }
            if (newMemo.tags.length > 0) {
                displayContent += newMemo.tags.map(t => `#${t}`).join(' ') + ' ';
            }
            displayContent += newMemo.content;
            
            MarkdownRenderer.render(
                this.app,
                displayContent,
                cardContent,
                newMemo.filePath,
                this
            );
        }

        // 更多操作按钮
        const moreBtn = newCard.createEl('button', {
            cls: 'memos-card-more',
            attr: { 'aria-label': '更多操作' }
        });
        moreBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="19" r="1"></circle></svg>';
        moreBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showMemoMenu(newMemo, moreBtn);
        });

        // 番茄钟控制区（仅任务显示）⭐ 重要：updateSingleCard 也需要渲染番茄钟控制区
        if (this.settings.enablePomodoro && newMemo.taskStatus) {
            this.renderPomodoroControl(newMemo, newCard);
        }

        // 点击卡片跳转到源文件
        newCard.addEventListener('click', () => {
            this.openMemoInFile(newMemo);
        });

        // 替换旧卡片
        card.replaceWith(newCard);
    }

    /**
     * 对单行文本执行任务状态切换，返回修改后的行内容
     * 时间追踪实现：切换到 DOING 时插入 `<!-- ts:ISO|source:todo -->` 隐藏注释，
     * 切换到 DONE 时解析注释计算时长，并可选追加到行末
     * @param memoId stableMemoId，用于查询番茄钟暂停时间从总时长中扣除
     */
    private toggleTaskStatusInLine(line: string, memoId?: string): string {
        // 如果禁用时间追踪，直接返回原行（不做任何修改）
        if (!this.settings.enableTimeTracking) {
            return line;
        }

        // 移除时间注释
        const removeTimeComment = (text: string) => text.replace(/\s*<!--\s*ts:[^>]*?-->\s*/g, '');
        const cleanedLine = removeTimeComment(line);

        // 格式化时间
        const formatStartTime = (isoString: string): string => {
            const date = new Date(isoString);
            return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
        };

        // 格式化时长
        const formatDuration = (seconds: number): string => {
            if (seconds < 60) return `${seconds}秒`;
            if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟`;
            return `${Math.floor(seconds / 3600)}小时`;
        };

        // 提取时间追踪信息
        const extractTrackingInfo = (text: string): { startTime: string; source: 'todo' | 'checkbox' } | null => {
            const match = text.match(/<!--\s*ts:([^|]+)\|source:(\w+)\s*-->/);
            return match ? { startTime: match[1], source: match[2] as 'todo' | 'checkbox' } : null;
        };

        // 1. 检查复选框格式
        const checkboxMatch = cleanedLine.match(/^-\s+\[([ xX])\]\s+(\d{2}:\d{2})?\s*(.*)$/);
        if (checkboxMatch) {
            const [, checkState, timeStr, content] = checkboxMatch;
            
            if (checkState === ' ') {
                // [ ] → DOING
                const startTime = new Date().toISOString();
                const displayTime = formatStartTime(startTime);
                return `- DOING ${displayTime} <!-- ts:${startTime}|source:checkbox --> ${content}`;
            } else {
                // [x] → 普通列表
                return `- ${timeStr ? timeStr + ' ' : ''}${content}`;
            }
        }

        // 2. 检查关键词任务格式
        const todoMatch = cleanedLine.match(/^-\s+(TODO)\s+(\d{2}:\d{2})?\s*(.*)$/);
        const doingMatch = line.match(/^-\s+(DOING)\s+(\d{2}:\d{2})?\s*(?:<!--[^>]*-->)?\s*(.*)$/);
        const doneMatch = cleanedLine.match(/^-\s+(DONE)\s+(\d{2}:\d{2})?\s*(.*)$/);

        if (todoMatch) {
            // TODO → DOING
            const [, , timeStr, content] = todoMatch;
            const startTime = new Date().toISOString();
            const displayTime = formatStartTime(startTime);
            return `- DOING ${displayTime} <!-- ts:${startTime}|source:todo --> ${content}`;
            
        } else if (doingMatch) {
            // DOING → DONE 或 [x]
            const [, , timeStr, content] = doingMatch;
            const trackingInfo = extractTrackingInfo(line);

            if (trackingInfo) {
                const start = new Date(trackingInfo.startTime);
                const end = new Date();
                let durationSeconds = Math.floor((end.getTime() - start.getTime()) / 1000);

                // 如果有 memoId，检查是否有番茄钟暂停时间需要减去
                if (memoId && this.settings.enablePomodoro) {
                    const pomodoroSessions = this.pomodoroManager.getMemoPomodoros(memoId);
                    const taskStartTime = start.getTime();
                    const taskEndTime = end.getTime();

                    for (const session of pomodoroSessions) {
                        // 检查番茄钟是否与任务时间段有重叠
                        const sessionStart = session.startTime;
                        const sessionEnd = session.endTime || Date.now();

                        // 判断时间区间是否有重叠
                        const hasOverlap = !(sessionEnd < taskStartTime || sessionStart > taskEndTime);

                        if (hasOverlap) {
                            // 累加已记录的暂停时间
                            durationSeconds -= (session.pausedAccumulatedSeconds || 0);

                            // 如果番茄钟还在暂停中，且暂停发生在任务期间
                            if (session.state === 'paused' && session.pauseHistory) {
                                const currentPause = session.pauseHistory.find(p => !p.pauseEndTime);
                                if (currentPause) {
                                    // 计算本次暂停的时长
                                    const pauseDuration = Math.floor(
                                        (Date.now() - currentPause.pauseStartTime) / 1000
                                    );
                                    durationSeconds -= pauseDuration;
                                }
                            }
                        }
                    }

                    // 确保时长不为负
                    if (durationSeconds < 0) durationSeconds = 0;
                }

                const durationStr = formatDuration(durationSeconds);
                const taskText = removeTimeComment(content).trim();

                // 计算番茄统计：已完成数 + 当前正在运行/暂停的会话（即将被停止保存的这一个）
                let pomodoroStr = '';
                if (memoId && this.settings.enablePomodoro) {
                    const completedCount = this.pomodoroManager.getMemoPomodoros(memoId)
                        .filter(s => s.state === 'completed').length;
                    const activeSession = this.pomodoroManager.getSession(memoId);
                    const hasActive = activeSession &&
                        (activeSession.state === 'running' || activeSession.state === 'paused');
                    const totalCount = completedCount + (hasActive ? 1 : 0);
                    if (totalCount > 0) {
                        pomodoroStr = ' ' + '🍅'.repeat(totalCount);
                    }
                }

                if (trackingInfo.source === 'checkbox') {
                    // 返回 [x]，根据配置决定是否追加时长
                    if (this.settings.autoAppendDuration) {
                        return timeStr 
                            ? `- [x] ${timeStr} ${taskText} ${durationStr}${pomodoroStr}`
                            : `- [x] ${taskText} ${durationStr}${pomodoroStr}`;
                    } else {
                        return timeStr 
                            ? `- [x] ${timeStr} ${taskText}${pomodoroStr}`
                            : `- [x] ${taskText}${pomodoroStr}`;
                    }
                } else {
                    // 返回 DONE，根据配置决定是否追加时长
                    if (this.settings.autoAppendDuration) {
                        return timeStr
                            ? `- DONE ${timeStr} ${taskText} ${durationStr}${pomodoroStr}`
                            : `- DONE ${taskText} ${durationStr}${pomodoroStr}`;
                    } else {
                        return timeStr
                            ? `- DONE ${timeStr} ${taskText}${pomodoroStr}`
                            : `- DONE ${taskText}${pomodoroStr}`;
                    }
                }
            } else {
                const taskText = removeTimeComment(content).trim();
                return timeStr ? `- DONE ${timeStr} ${taskText}` : `- DONE ${taskText}`;
            }
            
        } else if (doneMatch) {
            // DONE → 普通列表：同时清除时长和番茄统计后缀
            const [, , timeStr, content] = doneMatch;
            const taskText = content
                .replace(/\s+🍅+$/, '')
                .replace(/\s+\d+(秒|分钟|小时)$/, '')
                .trim();
            return timeStr ? `- ${timeStr} ${taskText}` : `- ${taskText}`;
        }

        return line;
    }

    /**
     * 获取任务状态图标（仅用于关键词任务）
     */
    private getTaskStatusIcon(status: TaskStatus): string {
        const icons: Record<TaskStatus, string> = {
            'CHECKBOX_UNCHECKED': '',
            'CHECKBOX_CHECKED': '',
            'TODO': '📝',
            'DOING': '⚡',
            'DONE': '✅',
            'NOW': '🔥',
            'LATER': '⏰',
            'WAITING': '⏳',
            'CANCELLED': '❌',
        };
        return icons[status] || '';
    }

    /**
     * 显示闪念操作菜单
     */
    private showMemoMenu(memo: MemoItem, element: HTMLElement): void {
        const menu = new Menu();

        menu.addItem((item) => {
            item.setTitle('编辑')
                .setIcon('pencil')
                .onClick(() => this.loadMemoForEdit(memo));
        });

        menu.addItem((item) => {
            item.setTitle('打开源文件')
                .setIcon('file-text')
                .onClick(() => this.openMemoInFile(memo));
        });

        menu.addItem((item) => {
            item.setTitle('复制内容')
                .setIcon('copy')
                .onClick(() => {
                    navigator.clipboard.writeText(memo.content);
                    new Notice('已复制到剪贴板');
                });
        });

        menu.addSeparator();

        menu.addItem((item) => {
            item.setTitle('删除')
                .setIcon('trash')
                .onClick(async () => {
                    const confirmed = await this.confirmDelete();
                    if (confirmed) {
                        const success = await this.storage.deleteMemo(memo);
                        if (success) {
                            new Notice('已删除');
                            this.refresh();
                        } else {
                            new Notice('删除失败');
                        }
                    }
                });
        });

        menu.showAtMouseEvent(new MouseEvent('click', {
            clientX: element.getBoundingClientRect().right,
            clientY: element.getBoundingClientRect().bottom,
        }));
    }


    /**
     * 确认删除对话框
     */
    private confirmDelete(): Promise<boolean> {
        return new Promise((resolve) => {
            // 简单实现，直接返回 true
            // 生产环境可以使用更完善的确认对话框
            resolve(true);
        });
    }

    /**
     * 打开闪念所在的源文件
     * 如果文件已在某个标签页打开，则切换到该标签页，避免重复打开
     */
    private async openMemoInFile(memo: MemoItem): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(memo.filePath);
        if (!file) return;

        // 检查是否已有打开该文件的标签页
        const leaves = this.app.workspace.getLeavesOfType('markdown');
        for (const leaf of leaves) {
            const viewState = leaf.getViewState();
            if (viewState.state?.file === memo.filePath) {
                // 已有打开的标签页，切换到它
                this.app.workspace.setActiveLeaf(leaf, { focus: true });
                return;
            }
        }

        // 没有找到已打开的标签页，打开新的
        const leaf = this.app.workspace.getLeaf(false);
        await leaf.openFile(file as any);
    }

    /**
     * 按标签筛选
     */
    private filterByTag(tag: string): void {
        this.currentFilter.tag = tag;
        this.currentFilter.filterTags = undefined; // 单标签筛选时清除多标签
        this.loadMemos();
        
        // 更新下拉框选中状态
        const select = this.containerEl.querySelector('.memos-tag-select') as HTMLSelectElement;
        if (select) {
            select.value = tag;
        }
    }

    /**
     * 添加加载更多按钮
     */
    private addLoadMoreButton(): void {
        if (!this.contentContainer) return;

        const totalPages = Math.ceil(this.displayedMemos.length / this.settings.itemsPerPage);
        if (this.page >= totalPages) return;

        const loadMore = this.contentContainer.createDiv({ cls: 'memos-load-more' });
        const btn = loadMore.createEl('button', {
            text: '加载更多',
            cls: 'memos-load-more-btn'
        });
        
        btn.addEventListener('click', () => {
            this.page++;
            loadMore.remove();
            this.renderMemos();
            
            if (this.page < totalPages) {
                this.addLoadMoreButton();
            }
        });
    }

    /**
     * 显示空状态
     */
    private showEmptyState(): void {
        if (!this.contentContainer) return;

        const empty = this.contentContainer.createDiv({ cls: 'memos-empty' });
        
        const icon = empty.createDiv({ cls: 'memos-empty-icon' });
        icon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>';
        
        const text = empty.createDiv({ cls: 'memos-empty-text' });
        
        if (this.currentFilter.search) {
            text.setText(`没有找到包含 "${this.currentFilter.search}" 的闪念`);
        } else if (this.currentFilter.tag) {
            text.setText(`没有标签为 #${this.currentFilter.tag} 的闪念`);
        } else {
            text.setText('还没有闪念，点击右上角 + 开始记录');
        }

        const createBtn = empty.createEl('button', {
            text: '记录第一条闪念',
            cls: 'memos-empty-btn'
        });
        createBtn.addEventListener('click', () => this.openInputModal());
    }

    /**
     * 打开输入弹窗
     */
    private openInputModal(): void {
        const modal = new MemoInputModal(
            this.app,
            this.storage,
            this.settings,
            () => this.refresh()
        );
        modal.open();
    }

    /**
     * 刷新视图
     */
    async refresh(): Promise<void> {
        this.storage.invalidateCache();
        await this.loadMemos();
        
        // 更新统计
        const statsEl = this.containerEl.querySelector('.memos-stats');
        if (statsEl) {
            await this.updateStats(statsEl as HTMLElement);
        }
    }

    /**
     * 从命令调用提交（用于快捷键）
     */
    submitFromCommand(): void {
        // 检查输入框是否有内容
        if (this.inputTextArea && this.inputTextArea.value.trim()) {
            this.submitInlineInput();
        }
    }

    /**
     * 更新设置
     */
    updateSettings(settings: MemosPluginSettings): void {
        this.settings = settings;
    }

    // ============ 番茄钟集成 ============
    //
    // 通信模式：PomodoroManager 通过 PomodoroEventListener 回调通知本视图
    // - onSessionChange: 每秒 tick 或状态切换 → 局部更新番茄钟 UI
    // - onSessionComplete/onBreakStart/onBreakEnd: 阶段变化 → 切换 UI 模板
    //
    // stableMemoId 解析约定：`lastIndexOf('-')` 分割 filePath 和 lineNumber
    // （filePath 本身可能含 '-'，所以不能用 split）

    /**
     * 外部编辑导致行号偏移时，修复活跃番茄钟的 stableMemoId
     *
     * 场景：Alfred 往日记文件中间插入一行 → 原来第 5 行的 DOING 变成第 6 行
     * → session.memoId 还是 "path-5" 但实际 memo 已移到 "path-6"
     *
     * 策略：找到同文件中状态为 DOING 且没有关联番茄钟的 memo 作为候选，执行重映射
     * 局限：如果同文件有多个 DOING 任务且都没有番茄钟，只会匹配第一个
     */
    private reconcilePomodoroSessions(): void {
        const activeSessions = this.pomodoroManager.getActivePomodoros();
        for (const session of activeSessions) {
            const lastDash = session.memoId.lastIndexOf('-');
            if (lastDash === -1) continue;

            const filePath = session.memoId.substring(0, lastDash);
            const lineNumber = parseInt(session.memoId.substring(lastDash + 1));

            const memoExists = this.displayedMemos.some(
                m => m.filePath === filePath && m.lineNumber === lineNumber
            );
            if (memoExists) continue;

            const candidate = this.displayedMemos.find(m =>
                m.filePath === filePath &&
                m.taskStatus === 'DOING' &&
                !this.pomodoroManager.getSession(`${m.filePath}-${m.lineNumber}`)
            );

            if (candidate) {
                const newMemoId = `${candidate.filePath}-${candidate.lineNumber}`;
                this.pomodoroManager.remapSessionMemoId(session.memoId, newMemoId);
            }
        }
    }

    /**
     * 在卡片底部渲染番茄钟控制区
     * 根据当前状态选择模板：active（运行/暂停）、break（休息）、completed（空闲+历史）
     */
    private renderPomodoroControl(memo: MemoItem, card: HTMLElement): void {
        const stableMemoId = `${memo.filePath}-${memo.lineNumber}`;

        const session = this.pomodoroManager.getSession(stableMemoId);

        const completedCount = this.pomodoroManager.getMemoPomodoros(stableMemoId)
            .filter(s => s.state === 'completed').length;

        const isDoing = memo.taskStatus === 'DOING';

        // 没有活跃 session、没有完成记录、也不是 DOING 状态 → 不渲染
        if (!session && completedCount === 0 && !isDoing) {
            return;
        }

        const pomodoroContainer = card.createDiv({ cls: 'memos-pomodoro-control' });
        this.pomodoroUIElements.set(stableMemoId, pomodoroContainer);

        if (session && (session.state === 'short_break' || session.state === 'long_break')) {
            this.renderPomodoroBreak(pomodoroContainer, memo, session);
        } else if (session && (session.state === 'running' || session.state === 'paused')) {
            this.renderPomodoroActive(pomodoroContainer, memo, session);
        } else {
            // 无活跃 session：显示已完成的 🍅 + 开始按钮（DOING 时）
            this.renderPomodoroCompleted(pomodoroContainer, memo, completedCount);
        }
    }

    /**
     * 渲染空闲状态（开始按钮）
     */
    private renderPomodoroIdle(container: HTMLElement, memo: MemoItem): void {
        const startBtn = container.createEl('button', {
            cls: 'memos-pomodoro-start',
            text: '🍅 开始专注'
        });
        startBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // 使用稳定的 memoId：filePath-lineNumber
            const stableMemoId = `${memo.filePath}-${memo.lineNumber}`;
            this.pomodoroManager.start(stableMemoId, undefined, memo.content);
        });
    }

    /**
     * 渲染运行中/暂停状态
     */
    private renderPomodoroActive(container: HTMLElement, memo: MemoItem, session: PomodoroSession): void {
        container.addClass('memos-pomodoro-active');

        // 图标
        const icon = container.createSpan({ cls: 'memos-pomodoro-icon' });
        icon.textContent = '🍅';

        // 倒计时
        const timerEl = container.createSpan({ cls: 'memos-pomodoro-timer' });
        this.updateTimerDisplay(timerEl, session);

        // 控制按钮组
        const controls = container.createDiv({ cls: 'memos-pomodoro-controls' });

        if (session.state === 'running') {
            const pauseBtn = controls.createEl('button', {
                cls: 'memos-pomodoro-btn',
                text: '⏸ 暂停'
            });
            pauseBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.pomodoroManager.pause(session.id);
            });
        } else {
            const resumeBtn = controls.createEl('button', {
                cls: 'memos-pomodoro-btn',
                text: '▶ 继续'
            });
            resumeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.pomodoroManager.resume(session.id);
            });
        }

        const stopBtn = controls.createEl('button', {
            cls: 'memos-pomodoro-btn memos-pomodoro-stop',
            text: '⏹ 停止'
        });
        stopBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.pomodoroManager.stop(session.id, false);
        });
    }

    /**
     * 渲染完成状态
     */
    private renderPomodoroCompleted(container: HTMLElement, memo: MemoItem, count: number): void {
        container.addClass('memos-pomodoro-completed');

        // 已完成的番茄图标
        if (count > 0) {
            const tomatoes = container.createSpan({ cls: 'memos-pomodoro-tomatoes' });
            for (let i = 0; i < count; i++) {
                const t = tomatoes.createSpan({ cls: 'memos-pomodoro-tomato', text: '🍅' });
                t.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.plugin.activatePomodoroStats();
                });
            }
        }

        // DOING 状态的任务：显示开始按钮，方便启动下一个番茄
        if (memo.taskStatus === 'DOING') {
            const startBtn = container.createEl('button', {
                cls: 'memos-pomodoro-start',
                text: count > 0 ? '🍅 下一个' : '🍅 开始专注',
            });
            startBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const stableMemoId = `${memo.filePath}-${memo.lineNumber}`;
                this.pomodoroManager.start(stableMemoId, undefined, memo.content);
            });
        }
    }

    /**
     * 渲染休息阶段
     */
    private renderPomodoroBreak(container: HTMLElement, memo: MemoItem, session: PomodoroSession): void {
        const isLong = session.state === 'long_break';
        container.addClass(isLong ? 'memos-pomodoro-long-break' : 'memos-pomodoro-short-break');

        const icon = container.createSpan({ cls: 'memos-pomodoro-icon' });
        icon.textContent = isLong ? '🌿' : '☕';

        const label = container.createSpan({ cls: 'memos-pomodoro-break-label' });
        label.textContent = isLong ? '长休息' : '短休息';

        const timerEl = container.createSpan({ cls: 'memos-pomodoro-timer memos-pomodoro-break-timer' });
        this.updateTimerDisplay(timerEl, session);

        const controls = container.createDiv({ cls: 'memos-pomodoro-controls' });

        const skipBtn = controls.createEl('button', {
            cls: 'memos-pomodoro-btn',
            text: '⏭ 跳过'
        });
        skipBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const stableMemoId = `${memo.filePath}-${memo.lineNumber}`;
            this.pomodoroManager.skipBreak(stableMemoId);
        });

        const startNextBtn = controls.createEl('button', {
            cls: 'memos-pomodoro-btn memos-pomodoro-btn-start-next',
            text: '🍅 开始下一个'
        });
        startNextBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const stableMemoId = `${memo.filePath}-${memo.lineNumber}`;
            this.pomodoroManager.start(stableMemoId, undefined, memo.content);
        });
    }

    /**
     * 更新倒计时显示
     */
    private updateTimerDisplay(el: HTMLElement, session: PomodoroSession): void {
        if (session.remainingSeconds !== undefined) {
            const minutes = Math.floor(session.remainingSeconds / 60);
            const seconds = session.remainingSeconds % 60;
            el.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
    }

    /**
     * 显示番茄钟统计
     */
    private showPomodoroStats(memo: MemoItem): void {
        const stableMemoId = `${memo.filePath}-${memo.lineNumber}`;
        const sessions = this.pomodoroManager.getMemoPomodoros(stableMemoId);
        const completed = sessions.filter(s => s.state === 'completed');
        const totalMinutes = completed.reduce((sum, s) => sum + (s.actualMinutes || 0), 0);

        const content = `
## 番茄钟统计

**Memo**: ${memo.content.substring(0, 50)}${memo.content.length > 50 ? '...' : ''}

- 🍅 总番茄数: ${completed.length}
- ⏱ 总专注时长: ${totalMinutes} 分钟
- ⏰ 平均时长: ${completed.length > 0 ? Math.round(totalMinutes / completed.length) : 0} 分钟
        `.trim();

        new Notice(content, 0);
    }

    /**
     * 更新专注模式 CSS 状态
     * 开启条件：有 running 或休息中的番茄钟
     * paused 不开启：用户暂停说明想查看其他内容，不应遮挡
     * 实现：memosList 加 memos-focus-mode 类 + 对应卡片加 memos-focus-target 类
     */
    private updateFocusMode(): void {
        if (!this.memosList) return;

        const focusSession = Array.from(
            this.pomodoroManager.getActivePomodoros()
        ).find(s =>
            s.state === 'running' || s.state === 'short_break' || s.state === 'long_break'
        );

        if (focusSession) {
            const newFocusId = focusSession.memoId;
            if (this.focusMemoId !== newFocusId) {
                this.memosList.querySelectorAll('.memos-focus-target').forEach(
                    el => el.removeClass('memos-focus-target')
                );
                this.focusMemoId = newFocusId;

                const lastDash = newFocusId.lastIndexOf('-');
                if (lastDash !== -1) {
                    const filePath = newFocusId.substring(0, lastDash);
                    const lineNumber = parseInt(newFocusId.substring(lastDash + 1));
                    const memo = this.displayedMemos.find(
                        m => m.filePath === filePath && m.lineNumber === lineNumber
                    );
                    if (memo) {
                        const card = this.memosList.querySelector(
                            `[data-memo-id="${memo.id}"]`
                        ) as HTMLElement;
                        if (card) {
                            card.addClass('memos-focus-target');
                        }
                    }
                }
            }
            if (!this.memosList.hasClass('memos-focus-mode')) {
                this.memosList.addClass('memos-focus-mode');
            }
        } else {
            if (this.focusMemoId) {
                this.focusMemoId = null;
                this.memosList.removeClass('memos-focus-mode');
                this.memosList.querySelectorAll('.memos-focus-target').forEach(
                    el => el.removeClass('memos-focus-target')
                );
            }
        }
    }

    /**
     * PomodoroManager 每秒 tick 或状态切换时回调
     * 核心职责：找到对应的 DOM 容器 → 清空并按当前状态重新渲染
     * 容器查找优先走 pomodoroUIElements 缓存，未命中则从 DOM 中创建
     */
    private onPomodoroChange(session: PomodoroSession): void {
        if (!session || !session.memoId) return;

        const lastDashIndex = session.memoId.lastIndexOf('-');
        if (lastDashIndex === -1) {
            return;
        }

        const filePath = session.memoId.substring(0, lastDashIndex);
        const lineNumber = parseInt(session.memoId.substring(lastDashIndex + 1));

        // 通过 filePath 和 lineNumber 查找 memo
        const memo = this.displayedMemos.find(m =>
            m.filePath === filePath && m.lineNumber === lineNumber
        );

        if (!memo) {
            return;
        }

        let container = this.pomodoroUIElements.get(session.memoId);

        // 检查缓存的容器是否仍在 DOM 中（refresh 会销毁旧 DOM 树）
        if (container && !container.isConnected) {
            this.pomodoroUIElements.delete(session.memoId);
            container = undefined;
        }

        // 容器不存在则创建并插入到卡片中
        if (!container) {
            const card = this.memosList?.querySelector(`[data-memo-id="${memo.id}"]`) as HTMLElement;
            if (!card) {
                return;
            }

            container = card.createDiv({ cls: 'memos-pomodoro-control' });

            const moreBtn = card.querySelector('.memos-card-more');
            if (moreBtn) {
                card.insertBefore(container, moreBtn);
            }

            this.pomodoroUIElements.set(session.memoId, container);
        }

        // 清空并重新渲染
        container.empty();
        container.removeClass(
            'memos-pomodoro-active', 'memos-pomodoro-completed',
            'memos-pomodoro-short-break', 'memos-pomodoro-long-break'
        );

        const currentSession = this.pomodoroManager.getSession(session.memoId);

        if (currentSession && (currentSession.state === 'short_break' || currentSession.state === 'long_break')) {
            this.renderPomodoroBreak(container, memo, currentSession);
        } else if (currentSession && (currentSession.state === 'running' || currentSession.state === 'paused')) {
            this.renderPomodoroActive(container, memo, currentSession);
        } else {
            const completedCount = this.pomodoroManager.getMemoPomodoros(session.memoId)
                .filter(s => s.state === 'completed').length;
            if (completedCount > 0 || memo.taskStatus === 'DOING') {
                this.renderPomodoroCompleted(container, memo, completedCount);
            } else {
                container.remove();
                this.pomodoroUIElements.delete(session.memoId);
            }
        }

        // 更新专注模式
        this.updateFocusMode();
    }

    /**
     * 番茄钟完成事件
     */
    private onPomodoroComplete(session: PomodoroSession): void {
        if (!session || !session.memoId) return;

        const lastDashIndex = session.memoId.lastIndexOf('-');
        if (lastDashIndex === -1) {
            return;
        }

        const filePath = session.memoId.substring(0, lastDashIndex);
        const lineNumber = parseInt(session.memoId.substring(lastDashIndex + 1));

        // 通过 filePath 和 lineNumber 查找 memo
        const memo = this.displayedMemos.find(m =>
            m.filePath === filePath && m.lineNumber === lineNumber
        );

        if (!memo) return;

        let container = this.pomodoroUIElements.get(session.memoId);

        if (container && !container.isConnected) {
            this.pomodoroUIElements.delete(session.memoId);
            container = undefined;
        }

        if (!container) {
            const card = this.memosList?.querySelector(`[data-memo-id="${memo.id}"]`) as HTMLElement;
            if (!card) return;

            container = card.createDiv({ cls: 'memos-pomodoro-control' });

            const moreBtn = card.querySelector('.memos-card-more');
            if (moreBtn) {
                card.insertBefore(container, moreBtn);
            }

            this.pomodoroUIElements.set(session.memoId, container);
        }

        // 清空并重新渲染
        container.empty();
        container.removeClass('memos-pomodoro-active');
        container.addClass('memos-pomodoro-completed');

        const completedCount = this.pomodoroManager.getMemoPomodoros(session.memoId)
            .filter(s => s.state === 'completed').length;
        this.renderPomodoroCompleted(container, memo, completedCount);
    }
}
