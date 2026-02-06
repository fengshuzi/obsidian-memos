/**
 * 闪念笔记存储和解析模块
 * 参考 Logseq 的闪念格式：在 journal 文件中以 - HH:mm 内容 的格式存储
 */

import { App, TFile, TFolder } from 'obsidian';
import { MemoItem, MemosByDate, MemosPluginSettings, MEMO_PATTERN, parseQuickTags } from './types';
import {
    generateId,
    formatTime,
    formatDate,
    getJournalFileName,
    extractDateFromFileName,
    extractTags,
    isJournalFile,
} from './utils';

export class MemosStorage {
    private app: App;
    private settings: MemosPluginSettings;
    private memosCache: Map<string, MemoItem[]> = new Map();
    private cacheValid: boolean = false;

    constructor(app: App, settings: MemosPluginSettings) {
        this.app = app;
        this.settings = settings;
    }

    /**
     * 更新设置
     */
    updateSettings(settings: MemosPluginSettings): void {
        this.settings = settings;
        this.invalidateCache();
    }

    /**
     * 使缓存失效
     */
    invalidateCache(): void {
        this.cacheValid = false;
        this.memosCache.clear();
    }

    /**
     * 保存闪念笔记
     */
    async saveMemo(content: string, tags: string[] = []): Promise<MemoItem | null> {
        const now = new Date();
        const timeString = formatTime(now);
        const dateString = formatDate(now, this.settings.dateFormat);
        const journalPath = `${this.settings.journalFolder}/${getJournalFileName(now, this.settings.dateFormat)}`;

        // 构建闪念文本
        let memoText = `- ${timeString} ${content}`;
        
        // 添加标签
        const allTags = [...this.settings.defaultTags, ...tags];
        if (allTags.length > 0) {
            const tagsText = allTags.map(t => `#${t}`).join(' ');
            memoText = `- ${timeString} ${tagsText} ${content}`;
        }

        try {
            // 获取或创建 journal 文件
            let file = this.app.vault.getAbstractFileByPath(journalPath);
            
            if (!file) {
                // 确保 journals 文件夹存在
                await this.ensureJournalFolder();
                // 创建新文件
                file = await this.app.vault.create(journalPath, memoText + '\n');
            } else if (file instanceof TFile) {
                // 追加到现有文件
                const existingContent = await this.app.vault.read(file);
                const newContent = existingContent.trim() 
                    ? existingContent.trimEnd() + '\n' + memoText + '\n'
                    : memoText + '\n';
                await this.app.vault.modify(file, newContent);
            }

            // 创建 MemoItem 对象
            const memo: MemoItem = {
                id: generateId(),
                content: content,
                timestamp: now,
                timeString: timeString,
                tags: allTags,
                filePath: journalPath,
                lineNumber: -1, // 新添加的在末尾
                rawText: memoText,
                dateString: dateString,
            };

            // 更新缓存
            this.invalidateCache();

            return memo;
        } catch (error) {
            console.error('保存闪念笔记失败:', error);
            return null;
        }
    }

    /**
     * 确保 journals 文件夹存在
     */
    private async ensureJournalFolder(): Promise<void> {
        const folder = this.app.vault.getAbstractFileByPath(this.settings.journalFolder);
        if (!folder) {
            await this.app.vault.createFolder(this.settings.journalFolder);
        }
    }

    /**
     * 获取所有闪念笔记
     */
    async getAllMemos(): Promise<MemoItem[]> {
        if (this.cacheValid && this.memosCache.size > 0) {
            return this.flattenCache();
        }

        const memos: MemoItem[] = [];
        const journalFolder = this.app.vault.getAbstractFileByPath(this.settings.journalFolder);

        if (!journalFolder || !(journalFolder instanceof TFolder)) {
            return memos;
        }

        // 遍历 journals 文件夹中的所有 markdown 文件
        for (const file of journalFolder.children) {
            if (file instanceof TFile && file.extension === 'md') {
                const fileMemos = await this.parseMemosFromFile(file);
                memos.push(...fileMemos);
                
                const dateStr = extractDateFromFileName(file.name);
                if (dateStr) {
                    this.memosCache.set(dateStr, fileMemos);
                }
            }
        }

        // 按时间倒序排序
        memos.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

        this.cacheValid = true;
        return memos;
    }

    /**
     * 按日期分组获取闪念笔记
     */
    async getMemosByDate(): Promise<MemosByDate> {
        const memos = await this.getAllMemos();
        const grouped: MemosByDate = {};

        for (const memo of memos) {
            if (!grouped[memo.dateString]) {
                grouped[memo.dateString] = [];
            }
            grouped[memo.dateString].push(memo);
        }

        return grouped;
    }

    /**
     * 按标签过滤获取闪念笔记
     */
    async getMemosByTag(tag: string): Promise<MemoItem[]> {
        const allMemos = await this.getAllMemos();
        return allMemos.filter(memo => memo.tags.includes(tag));
    }

    /**
     * 按多个标签过滤获取闪念笔记（匹配任意一个标签即可）
     */
    async getMemosByTags(tags: string[]): Promise<MemoItem[]> {
        if (tags.length === 0) return [];
        if (tags.length === 1) return this.getMemosByTag(tags[0]);
        
        const allMemos = await this.getAllMemos();
        return allMemos.filter(memo => 
            memo.tags.some(memoTag => tags.includes(memoTag))
        );
    }

    /**
     * 搜索闪念笔记
     */
    async searchMemos(query: string): Promise<MemoItem[]> {
        const allMemos = await this.getAllMemos();
        const lowerQuery = query.toLowerCase();
        return allMemos.filter(memo => 
            memo.content.toLowerCase().includes(lowerQuery) ||
            memo.tags.some(tag => tag.toLowerCase().includes(lowerQuery))
        );
    }

    /**
     * 从文件解析闪念笔记
     */
    private async parseMemosFromFile(file: TFile): Promise<MemoItem[]> {
        const memos: MemoItem[] = [];
        const content = await this.app.vault.read(file);
        const lines = content.split('\n');
        
        const dateStr = extractDateFromFileName(file.name);
        if (!dateStr) {
            return memos;
        }

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const memo = this.parseMemoLine(line, file.path, i + 1, dateStr);
            if (memo) {
                memos.push(memo);
            }
        }

        // 按时间倒序排序
        memos.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

        return memos;
    }

    /**
     * 解析单行闪念笔记
     * 支持两种格式:
     * 1. - HH:mm 内容 或 - HH:mm #tag1 #tag2 内容 (有时间戳)
     * 2. - #配置标签 内容 (有配置的快捷标签，无时间戳)
     */
    private parseMemoLine(
        line: string, 
        filePath: string, 
        lineNumber: number,
        dateStr: string
    ): MemoItem | null {
        // 首先尝试匹配有时间戳的格式
        const match = line.match(MEMO_PATTERN);
        if (match) {
            const [, timeString, restContent] = match;
            
            // 提取标签
            const tags = extractTags(restContent);
            
            // 移除标签获取纯内容
            let content = restContent;
            for (const tag of tags) {
                content = content.replace(`#${tag}`, '').trim();
            }
            content = content.replace(/\s+/g, ' ').trim();

            // 构建完整时间戳
            const [hours, minutes] = timeString.split(':').map(Number);
            const timestamp = new Date(dateStr);
            timestamp.setHours(hours, minutes, 0, 0);

            return {
                id: generateId(),
                content: content,
                timestamp: timestamp,
                timeString: timeString,
                tags: tags,
                filePath: filePath,
                lineNumber: lineNumber,
                rawText: line,
                dateString: dateStr,
            };
        }

        // 尝试匹配只有配置标签的格式: - #tag 内容
        const tagOnlyMatch = line.match(/^-\s+(#\S+.*)$/);
        if (tagOnlyMatch) {
            const restContent = tagOnlyMatch[1];
            const tags = extractTags(restContent);
            
            // 检查是否包含配置的快捷标签（聚合标签要检查整组关键词，如 cy+jf+qt+gw|每日记账 里的 jf 也要识别）
            const quickTags = parseQuickTags(this.settings.quickTags);
            const allQuickKeywords = new Set(quickTags.flatMap(t => t.keywords));
            const hasQuickTag = tags.some(tag => allQuickKeywords.has(tag));
            
            if (hasQuickTag) {
                // 移除标签获取纯内容
                let content = restContent;
                for (const tag of tags) {
                    content = content.replace(`#${tag}`, '').trim();
                }
                content = content.replace(/\s+/g, ' ').trim();

                // 没有时间戳，使用当天的 00:00
                const timestamp = new Date(dateStr);
                timestamp.setHours(0, 0, 0, 0);

                return {
                    id: generateId(),
                    content: content,
                    timestamp: timestamp,
                    timeString: '', // 无时间戳
                    tags: tags,
                    filePath: filePath,
                    lineNumber: lineNumber,
                    rawText: line,
                    dateString: dateStr,
                };
            }
        }

        return null;
    }

    /**
     * 删除闪念笔记
     */
    async deleteMemo(memo: MemoItem): Promise<boolean> {
        try {
            const file = this.app.vault.getAbstractFileByPath(memo.filePath);
            if (!(file instanceof TFile)) {
                return false;
            }

            const content = await this.app.vault.read(file);
            const lines = content.split('\n');
            
            // 找到并删除对应行
            const newLines = lines.filter((line, index) => {
                if (index + 1 === memo.lineNumber) {
                    return line.trim() !== memo.rawText.trim();
                }
                return true;
            });

            // 如果行数有变化，说明删除成功
            if (newLines.length < lines.length) {
                await this.app.vault.modify(file, newLines.join('\n'));
                this.invalidateCache();
                return true;
            }

            // 如果行号不匹配，尝试按内容匹配
            const filteredLines = lines.filter(line => line.trim() !== memo.rawText.trim());
            if (filteredLines.length < lines.length) {
                await this.app.vault.modify(file, filteredLines.join('\n'));
                this.invalidateCache();
                return true;
            }

            return false;
        } catch (error) {
            console.error('删除闪念笔记失败:', error);
            return false;
        }
    }

    /**
     * 更新闪念笔记
     */
    async updateMemo(memo: MemoItem, newContent: string, newTags: string[]): Promise<boolean> {
        try {
            const file = this.app.vault.getAbstractFileByPath(memo.filePath);
            if (!(file instanceof TFile)) {
                return false;
            }

            const content = await this.app.vault.read(file);
            const lines = content.split('\n');
            
            // 构建新的闪念文本（保持原有时间戳）
            let newMemoText = `- ${memo.timeString}`;
            if (newTags.length > 0) {
                newMemoText += ' ' + newTags.map(t => `#${t}`).join(' ');
            }
            newMemoText += ' ' + newContent;

            // 尝试通过行号匹配
            let found = false;
            for (let i = 0; i < lines.length; i++) {
                if (i + 1 === memo.lineNumber && lines[i].trim() === memo.rawText.trim()) {
                    lines[i] = newMemoText;
                    found = true;
                    break;
                }
            }

            // 如果行号不匹配，尝试按原始内容匹配
            if (!found) {
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].trim() === memo.rawText.trim()) {
                        lines[i] = newMemoText;
                        found = true;
                        break;
                    }
                }
            }

            if (found) {
                await this.app.vault.modify(file, lines.join('\n'));
                this.invalidateCache();
                return true;
            }

            return false;
        } catch (error) {
            console.error('更新闪念笔记失败:', error);
            return false;
        }
    }

    /**
     * 获取所有标签
     */
    async getAllTags(): Promise<string[]> {
        const memos = await this.getAllMemos();
        const tagSet = new Set<string>();
        
        for (const memo of memos) {
            for (const tag of memo.tags) {
                tagSet.add(tag);
            }
        }

        return Array.from(tagSet).sort();
    }

    /**
     * 获取统计信息
     */
    async getStats(): Promise<{
        totalMemos: number;
        totalTags: number;
        todayMemos: number;
        thisWeekMemos: number;
    }> {
        const memos = await this.getAllMemos();
        const tags = await this.getAllTags();
        
        const today = formatDate(new Date(), this.settings.dateFormat);
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

        const todayMemos = memos.filter(m => m.dateString === today).length;
        const thisWeekMemos = memos.filter(m => m.timestamp >= oneWeekAgo).length;

        return {
            totalMemos: memos.length,
            totalTags: tags.length,
            todayMemos,
            thisWeekMemos,
        };
    }

    /**
     * 将缓存展平为数组
     */
    private flattenCache(): MemoItem[] {
        const memos: MemoItem[] = [];
        for (const items of this.memosCache.values()) {
            memos.push(...items);
        }
        memos.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
        return memos;
    }

    /**
     * 监听文件变化（日记文件修改/新增/删除时失效缓存）
     * @returns 是否为日记文件且已失效缓存（调用方可用于决定是否刷新视图）
     */
    onFileChange(file: TFile): boolean {
        if (isJournalFile(file, this.settings.journalFolder)) {
            this.invalidateCache();
            return true;
        }
        return false;
    }
}
