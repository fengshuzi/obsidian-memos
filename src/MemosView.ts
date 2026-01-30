/**
 * 闪念笔记列表视图
 * 类似 Flomo/微博的卡片式展示，支持按日期分组、标签筛选和搜索
 * 在主内容区域显示（和普通文档一样的标签页）
 */

import { ItemView, WorkspaceLeaf, Menu, Notice, MarkdownRenderer } from 'obsidian';
import { MemosStorage } from './storage';
import { MemoItem, MemosPluginSettings, MEMOS_VIEW_TYPE, parseQuickTags, QuickTag, parseSmartKeywords, matchSmartKeyword, matchHabitKeyword } from './types';
import { getFriendlyDateDisplay, debounce, truncateText } from './utils';
import { MemoInputModal } from './InputModal';
import type MemosPlugin from './main';

export class MemosView extends ItemView {
    private plugin: MemosPlugin;
    private storage: MemosStorage;
    private settings: MemosPluginSettings;
    private contentContainer: HTMLElement | null = null;
    private memosList: HTMLElement | null = null;
    private currentFilter: { tag?: string; filterTags?: string[]; search?: string } = {};
    private displayedMemos: MemoItem[] = [];
    private page: number = 1;
    private inputTextArea: HTMLTextAreaElement | null = null;
    private currentTag: string = '';
    private currentQuickTag: QuickTag | null = null; // 当前选中的快捷标签（含多关键词）
    private editingMemo: MemoItem | null = null; // 正在编辑的闪念
    /** 手机端快捷标签下拉（小屏时显示，与按钮二选一） */
    private quickTagsSelect: HTMLSelectElement | null = null;

    constructor(
        leaf: WorkspaceLeaf, 
        plugin: MemosPlugin,
        storage: MemosStorage, 
        settings: MemosPluginSettings
    ) {
        super(leaf);
        this.plugin = plugin;
        this.storage = storage;
        this.settings = settings;
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
                    quickTagsContainer.querySelectorAll('.memos-quick-tag').forEach(btn => {
                        btn.removeClass('is-active');
                    });
                    tagBtn.addClass('is-active');
                    syncQuickTagsSelect();
                    await this.loadMemos();
                });
            }

            // 手机端：标签下拉（小屏时 CSS 显示、按钮隐藏，不包含"全部"选项）
            const dropdownWrap = inputArea.createDiv({ cls: 'memos-quick-tags-dropdown' });
            const select = dropdownWrap.createEl('select', { cls: 'memos-quick-tags-select' });
            this.quickTagsSelect = select;
            // 添加占位符选项（value=''，disabled，仅用于初始显示，下拉列表中不显示）
            const placeholderOption = select.createEl('option', { value: '', text: '选择标签' });
            placeholderOption.setAttribute('disabled', 'true');
            placeholderOption.setAttribute('selected', 'true');
            // 只添加配置的标签（下拉列表中只显示这些）
            for (const tag of quickTags) {
                select.createEl('option', { value: tag.keyword, text: tag.label });
            }
            select.addEventListener('change', async () => {
                const value = select.value;
                if (!value) {
                    // 占位符选项被选中（理论上不会发生，因为 disabled），显示全部
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

        this.contentContainer.empty();
        this.page = 1;

        // 显示加载状态
        const loading = this.contentContainer.createDiv({ cls: 'memos-loading' });
        loading.setText('加载中...');

        try {
            let memos: MemoItem[];
            
            // 根据筛选条件获取数据
            if (this.currentFilter.filterTags && this.currentFilter.filterTags.length > 0) {
                // 多关键词筛选（支持标签分组）
                memos = await this.storage.getMemosByTags(this.currentFilter.filterTags);
            } else if (this.currentFilter.tag) {
                memos = await this.storage.getMemosByTag(this.currentFilter.tag);
            } else if (this.currentFilter.search) {
                memos = await this.storage.searchMemos(this.currentFilter.search);
            } else {
                memos = await this.storage.getAllMemos();
            }

            this.displayedMemos = memos;
            
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
            loading.setText('加载失败，请重试');
        }
    }

    /**
     * 渲染闪念列表
     */
    private renderMemos(): void {
        if (!this.memosList) return;

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
    }

    /**
     * 渲染单条闪念卡片
     * 简洁风格：直接显示完整内容，和笔记格式一致
     */
    private renderMemoCard(memo: MemoItem): void {
        if (!this.memosList) return;

        const card = this.memosList.createDiv({ cls: 'memos-card' });
        card.setAttribute('data-memo-id', memo.id);

        // 构建完整的显示内容：时间 + 标签 + 内容
        let displayContent = '';
        if (memo.timeString) {
            displayContent = memo.timeString + ' ';
        }
        if (memo.tags.length > 0) {
            displayContent += memo.tags.map(t => `#${t}`).join(' ') + ' ';
        }
        displayContent += memo.content;

        // 卡片内容
        const cardContent = card.createDiv({ cls: 'memos-card-content' });
        
        // 使用 Markdown 渲染完整内容
        MarkdownRenderer.render(
            this.app,
            displayContent,
            cardContent,
            memo.filePath,
            this
        );

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

        // 点击卡片跳转到源文件
        card.addEventListener('click', () => {
            this.openMemoInFile(memo);
        });
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
}
