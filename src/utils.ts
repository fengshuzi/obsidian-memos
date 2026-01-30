/**
 * 工具函数
 */

import { moment, TFile } from 'obsidian';

/**
 * 生成唯一 ID
 */
export function generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

/**
 * 格式化时间为 HH:mm
 */
export function formatTime(date: Date = new Date()): string {
    return moment(date).format('HH:mm');
}

/**
 * 格式化日期
 */
export function formatDate(date: Date = new Date(), format: string = 'YYYY-MM-DD'): string {
    return moment(date).format(format);
}

/**
 * 获取今天的日期字符串
 */
export function getTodayDateString(format: string = 'YYYY-MM-DD'): string {
    return moment().format(format);
}

/**
 * 解析日期字符串
 */
export function parseDate(dateStr: string, format: string = 'YYYY-MM-DD'): Date {
    return moment(dateStr, format).toDate();
}

/**
 * 获取 journal 文件名
 */
export function getJournalFileName(date: Date = new Date(), format: string = 'YYYY-MM-DD'): string {
    return moment(date).format(format) + '.md';
}

/**
 * 从文件名提取日期
 */
export function extractDateFromFileName(fileName: string): string | null {
    // 支持多种日期格式
    const patterns = [
        /^(\d{4}-\d{2}-\d{2})\.md$/,           // YYYY-MM-DD.md
        /^(\d{4}_\d{2}_\d{2})\.md$/,           // YYYY_MM_DD.md
        /^(\d{8})\.md$/,                        // YYYYMMDD.md
    ];
    
    for (const pattern of patterns) {
        const match = fileName.match(pattern);
        if (match) {
            let dateStr = match[1];
            // 统一转换为 YYYY-MM-DD 格式
            if (dateStr.includes('_')) {
                dateStr = dateStr.replace(/_/g, '-');
            } else if (dateStr.length === 8) {
                dateStr = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
            }
            return dateStr;
        }
    }
    return null;
}

/**
 * 提取文本中的标签
 */
export function extractTags(text: string): string[] {
    const tags: string[] = [];
    const regex = /#([^\s#]+)/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
        tags.push(match[1]);
    }
    return tags;
}

/**
 * 移除文本中的标签
 */
export function removeTagsFromText(text: string): string {
    return text.replace(/#([^\s#]+)/g, '').trim();
}

/**
 * 判断文件是否是 journal 文件
 */
export function isJournalFile(file: TFile, journalFolder: string): boolean {
    return file.path.startsWith(journalFolder + '/') && file.extension === 'md';
}

/**
 * 相对时间描述
 */
export function getRelativeTime(date: Date): string {
    return moment(date).fromNow();
}

/**
 * 判断是否是今天
 */
export function isToday(dateStr: string): boolean {
    return dateStr === getTodayDateString();
}

/**
 * 判断是否是昨天
 */
export function isYesterday(dateStr: string): boolean {
    return dateStr === moment().subtract(1, 'day').format('YYYY-MM-DD');
}

/**
 * 获取友好的日期显示
 */
export function getFriendlyDateDisplay(dateStr: string): string {
    if (isToday(dateStr)) {
        return '今天';
    }
    if (isYesterday(dateStr)) {
        return '昨天';
    }
    const date = parseDate(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    
    if (diffDays < 7) {
        const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
        return weekdays[date.getDay()];
    }
    
    if (date.getFullYear() === now.getFullYear()) {
        return moment(date).format('M月D日');
    }
    
    return moment(date).format('YYYY年M月D日');
}

/**
 * 防抖函数
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
    func: T,
    wait: number
): (...args: Parameters<T>) => void {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    
    return function (this: unknown, ...args: Parameters<T>) {
        if (timeout) {
            clearTimeout(timeout);
        }
        timeout = setTimeout(() => {
            func.apply(this, args);
        }, wait);
    };
}

/**
 * 截断文本
 */
export function truncateText(text: string, maxLength: number = 100): string {
    if (text.length <= maxLength) {
        return text;
    }
    return text.slice(0, maxLength) + '...';
}

/**
 * HTML 转义
 */
export function escapeHtml(text: string): string {
    const map: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;',
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
}
