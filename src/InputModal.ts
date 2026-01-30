/**
 * 闪念输入弹窗
 * 参考 Logseq 的快速输入设计，提供类似微博/Flomo 的输入体验
 * 支持新增和编辑两种模式
 */

import { App, Modal, Notice, Setting } from 'obsidian';
import { MemosStorage } from './storage';
import { MemoItem, MemosPluginSettings, parseQuickTags } from './types';
import { formatTime } from './utils';

export class MemoInputModal extends Modal {
    private storage: MemosStorage;
    private settings: MemosPluginSettings;
    private textArea: HTMLTextAreaElement | null = null;
    private tagInput: HTMLInputElement | null = null;
    private onSubmitCallback: (() => void) | null = null;
    private isSubmitting: boolean = false;
    private editingMemo: MemoItem | null = null; // 编辑模式下的原始闪念
    private isEditMode: boolean = false;

    constructor(
        app: App, 
        storage: MemosStorage, 
        settings: MemosPluginSettings,
        onSubmit?: () => void,
        editMemo?: MemoItem // 可选：要编辑的闪念
    ) {
        super(app);
        this.storage = storage;
        this.settings = settings;
        this.onSubmitCallback = onSubmit || null;
        this.editingMemo = editMemo || null;
        this.isEditMode = !!editMemo;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('memos-input-modal');

        // 标题区域
        const header = contentEl.createDiv({ cls: 'memos-input-header' });
        const timeDisplay = header.createSpan({ cls: 'memos-input-time' });
        
        // 编辑模式显示原始时间，新建模式显示当前时间
        if (this.isEditMode && this.editingMemo) {
            timeDisplay.setText(this.editingMemo.timeString);
            // 添加编辑标识
            const editBadge = header.createSpan({ cls: 'memos-edit-badge' });
            editBadge.setText('编辑中');
        } else {
            timeDisplay.setText(formatTime(new Date()));
            // 每分钟更新时间（仅新建模式）
            const timeInterval = window.setInterval(() => {
                timeDisplay.setText(formatTime(new Date()));
            }, 60000);
            // 清理定时器
            this.scope.register([], 'Escape', () => {
                window.clearInterval(timeInterval);
            });
        }

        // 输入区域容器
        const inputContainer = contentEl.createDiv({ cls: 'memos-input-container' });

        // 文本输入框
        this.textArea = inputContainer.createEl('textarea', {
            cls: 'memos-input-textarea',
            attr: {
                placeholder: this.settings.placeholder,
                rows: '4',
            }
        });

        // 编辑模式下加载已有内容
        if (this.isEditMode && this.editingMemo) {
            this.textArea.value = this.editingMemo.content;
            // 自动调整高度
            setTimeout(() => {
                if (this.textArea) {
                    this.textArea.style.height = 'auto';
                    this.textArea.style.height = Math.min(this.textArea.scrollHeight, 300) + 'px';
                }
            }, 10);
        }

        // 自动调整高度
        this.textArea.addEventListener('input', () => {
            if (this.textArea) {
                this.textArea.style.height = 'auto';
                this.textArea.style.height = Math.min(this.textArea.scrollHeight, 300) + 'px';
            }
        });

        // 快捷键处理
        this.textArea.addEventListener('keydown', (e: KeyboardEvent) => {
            // Cmd/Ctrl + Enter 提交
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                this.submitMemo(false);
            }
            // Cmd/Ctrl + Shift + Enter 提交并继续（仅新建模式）
            else if (!this.isEditMode && (e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'Enter') {
                e.preventDefault();
                this.submitMemo(true);
            }
        });

        // 标签输入区域
        const tagContainer = contentEl.createDiv({ cls: 'memos-input-tags' });
        const tagLabel = tagContainer.createSpan({ cls: 'memos-tag-label' });
        tagLabel.setText('标签:');
        
        this.tagInput = tagContainer.createEl('input', {
            cls: 'memos-tag-input',
            attr: {
                type: 'text',
                placeholder: '输入标签，空格分隔',
            }
        });

        // 编辑模式下加载已有标签
        if (this.isEditMode && this.editingMemo && this.editingMemo.tags.length > 0) {
            this.tagInput.value = this.editingMemo.tags.join(' ');
        }

        // 快捷标签按钮区域
        const quickTags = parseQuickTags(this.settings.quickTags);
        if (quickTags.length > 0) {
            const quickTagsContainer = contentEl.createDiv({ cls: 'memos-quick-tags' });
            
            // "全部"按钮（清除标签筛选）
            const allBtn = quickTagsContainer.createEl('button', {
                cls: 'memos-quick-tag memos-quick-tag-all',
                text: '全部'
            });
            allBtn.addEventListener('click', () => {
                if (this.tagInput) {
                    this.tagInput.value = '';
                    this.tagInput.focus();
                }
                // 更新按钮状态
                quickTagsContainer.querySelectorAll('.memos-quick-tag').forEach(btn => {
                    btn.removeClass('is-active');
                });
                allBtn.addClass('is-active');
            });
            allBtn.addClass('is-active'); // 默认选中

            // 快捷标签按钮
            for (const tag of quickTags) {
                const tagBtn = quickTagsContainer.createEl('button', {
                    cls: 'memos-quick-tag',
                    text: tag.label
                });
                tagBtn.setAttribute('data-keyword', tag.keyword);
                
                tagBtn.addEventListener('click', () => {
                    if (this.tagInput) {
                        // 设置标签（替换而非追加）
                        this.tagInput.value = tag.keyword;
                        this.textArea?.focus();
                    }
                    // 更新按钮状态
                    quickTagsContainer.querySelectorAll('.memos-quick-tag').forEach(btn => {
                        btn.removeClass('is-active');
                    });
                    tagBtn.addClass('is-active');
                });
            }
        }

        // 底部按钮区域
        const footer = contentEl.createDiv({ cls: 'memos-input-footer' });
        
        // 提示信息
        const hints = footer.createDiv({ cls: 'memos-input-hints' });
        if (this.isEditMode) {
            hints.createSpan({ text: '⌘/Ctrl + Enter 保存' });
        } else {
            hints.createSpan({ text: '⌘/Ctrl + Enter 发送' });
            hints.createSpan({ text: '  |  ' });
            hints.createSpan({ text: '⌘/Ctrl + Shift + Enter 发送并继续' });
        }

        // 按钮组
        const buttonGroup = footer.createDiv({ cls: 'memos-button-group' });

        // 取消按钮
        const cancelBtn = buttonGroup.createEl('button', {
            text: '取消',
            cls: 'memos-btn memos-btn-cancel'
        });
        cancelBtn.addEventListener('click', () => {
            this.close();
        });

        // 提交按钮
        const submitBtn = buttonGroup.createEl('button', {
            text: this.isEditMode ? '保存' : '记录',
            cls: 'memos-btn memos-btn-submit'
        });
        submitBtn.addEventListener('click', () => {
            this.submitMemo(this.isEditMode ? false : this.settings.keepOpenAfterSubmit);
        });

        // 聚焦输入框，光标移到末尾
        setTimeout(() => {
            if (this.textArea) {
                this.textArea.focus();
                // 光标移到末尾
                this.textArea.selectionStart = this.textArea.value.length;
                this.textArea.selectionEnd = this.textArea.value.length;
            }
        }, 50);
    }

    /**
     * 提交闪念笔记
     */
    private async submitMemo(keepOpen: boolean): Promise<void> {
        if (this.isSubmitting) return;
        
        const content = this.textArea?.value?.trim();
        if (!content) {
            new Notice('请输入内容');
            return;
        }

        this.isSubmitting = true;

        // 解析标签
        const tagInputValue = this.tagInput?.value?.trim() || '';
        const tags = tagInputValue
            .split(/[\s,]+/)
            .filter(t => t.length > 0)
            .map(t => t.replace(/^#/, ''));

        try {
            let success: boolean;
            
            if (this.isEditMode && this.editingMemo) {
                // 编辑模式：更新现有闪念
                success = await this.storage.updateMemo(this.editingMemo, content, tags);
                if (success) {
                    new Notice('✅ 闪念已更新');
                }
            } else {
                // 新建模式：创建新闪念
                const memo = await this.storage.saveMemo(content, tags);
                success = !!memo;
                if (success) {
                    new Notice('✨ 闪念已记录');
                }
            }
            
            if (success) {
                // 触发回调
                if (this.onSubmitCallback) {
                    this.onSubmitCallback();
                }

                if (keepOpen && !this.isEditMode) {
                    // 清空输入框，准备下一条（仅新建模式）
                    if (this.textArea) {
                        this.textArea.value = '';
                        this.textArea.style.height = 'auto';
                        this.textArea.focus();
                    }
                    if (this.tagInput) {
                        this.tagInput.value = '';
                    }
                } else {
                    this.close();
                }
            } else {
                new Notice('保存失败，请重试');
            }
        } catch (error) {
            console.error('保存闪念失败:', error);
            new Notice('保存失败: ' + (error as Error).message);
        } finally {
            this.isSubmitting = false;
        }
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}

/**
 * 快速输入命令
 * 无需打开弹窗，直接在当前位置输入
 */
export class QuickMemoCommand {
    private app: App;
    private storage: MemosStorage;
    private settings: MemosPluginSettings;

    constructor(app: App, storage: MemosStorage, settings: MemosPluginSettings) {
        this.app = app;
        this.storage = storage;
        this.settings = settings;
    }

    /**
     * 执行快速记录
     */
    async execute(content: string, tags: string[] = []): Promise<boolean> {
        if (!content.trim()) {
            new Notice('内容不能为空');
            return false;
        }

        try {
            const memo = await this.storage.saveMemo(content.trim(), tags);
            if (memo) {
                new Notice('✨ 闪念已记录');
                return true;
            }
            return false;
        } catch (error) {
            console.error('快速记录失败:', error);
            new Notice('记录失败: ' + (error as Error).message);
            return false;
        }
    }
}
