/**
 * 闪念笔记插件类型定义
 */

/** 闪念笔记条目 */
export interface MemoItem {
    /** 唯一标识符 */
    id: string;
    /** 笔记内容 */
    content: string;
    /** 创建时间戳 */
    timestamp: Date;
    /** 格式化的时间 HH:mm */
    timeString: string;
    /** 标签列表 */
    tags: string[];
    /** 来源文件路径 */
    filePath: string;
    /** 在文件中的行号 */
    lineNumber: number;
    /** 原始文本（包含时间戳） */
    rawText: string;
    /** 日期字符串 YYYY-MM-DD */
    dateString: string;
}

/** 按日期分组的闪念笔记 */
export interface MemosByDate {
    [date: string]: MemoItem[];
}

/** 快捷标签配置 */
export interface QuickTag {
    /** 实际写入的标签关键词 */
    keyword: string;
    /** 显示的别名（如果和 keyword 相同则不显示别名） */
    label: string;
}

/** 插件设置 */
export interface MemosPluginSettings {
    /** journals 文件夹路径 */
    journalFolder: string;
    /** 日期格式 */
    dateFormat: string;
    /** 时间格式 */
    timeFormat: string;
    /** 是否显示时间戳 */
    showTimestamp: boolean;
    /** 默认标签 */
    defaultTags: string[];
    /** 快捷标签配置（格式：关键词|显示名，用逗号分隔） */
    quickTags: string;
    /** 快捷键 */
    hotkey: string;
    /** 每页显示数量 */
    itemsPerPage: number;
    /** 输入框占位文本 */
    placeholder: string;
    /** 是否在输入后保持弹窗打开 */
    keepOpenAfterSubmit: boolean;
    /** 启动时打开闪念页面 */
    openOnStartup: boolean;
}

/** 默认设置 */
export const DEFAULT_SETTINGS: MemosPluginSettings = {
    journalFolder: 'journals',
    dateFormat: 'YYYY-MM-DD',
    timeFormat: 'HH:mm',
    showTimestamp: true,
    defaultTags: [],
    quickTags: '今天也要用心过生活,p1|重要且紧急,工作,健身,搞钱,flashcard|闪卡,打卡,变更,idea|灵感,read|读书笔记,ril|稍后读,新技能get,目标管理,小日常,每日复盘,沟通,好词好句,草稿,王者荣耀,小番茄,ai,原则,迭代,英语学习',
    hotkey: 'Mod+Shift+M',
    itemsPerPage: 50,
    placeholder: '记录此刻的想法...',
    keepOpenAfterSubmit: false,
    openOnStartup: false,
};

/** 解析快捷标签配置 */
export function parseQuickTags(quickTagsStr: string): QuickTag[] {
    if (!quickTagsStr.trim()) return [];
    
    return quickTagsStr.split(',').map(item => {
        const trimmed = item.trim();
        if (!trimmed) return null;
        
        const parts = trimmed.split('|');
        const keyword = parts[0].trim();
        const label = parts[1]?.trim() || keyword;
        
        return { keyword, label };
    }).filter((tag): tag is QuickTag => tag !== null && tag.keyword.length > 0);
}

/** 视图类型 */
export const MEMOS_VIEW_TYPE = 'memos-view';

/** 闪念笔记的正则表达式模式 */
export const MEMO_PATTERN = /^-\s*(\d{2}:\d{2})\s+(.+)$/;

/** 任务前缀的正则表达式 */
export const TASK_PREFIX_PATTERN = /^(TODO|DONE|DOING|NOW|LATER|WAITING|CANCELLED)\s+/i;

/** 标签的正则表达式 */
export const TAG_PATTERN = /#([^\s#]+)/g;
