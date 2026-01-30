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
    /** 实际写入的标签关键词（第一个关键词） */
    keyword: string;
    /** 所有关联的关键词（用于筛选时匹配多个标签） */
    keywords: string[];
    /** 显示的别名（如果和 keyword 相同则不显示别名） */
    label: string;
}

/** 智能关键词配置 */
export interface SmartKeywords {
    [tag: string]: string[];
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
    /** 智能关键词配置（JSON格式，内容包含数字+关键词时自动添加标签，用于记账） */
    smartKeywords: string;
    /** 习惯打卡关键词配置（JSON格式，内容包含关键词时自动添加标签，不需要数字） */
    habitKeywords: string;
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
    quickTags: '今天也要用心过生活,p1+p2+p3+p4|四象限,工作,健身,搞钱,sp+reading|习惯打卡,变更,idea|灵感,read|读书笔记,ril|稍后读,新技能get,目标管理,小日常,沟通,好词好句,草稿,王者荣耀,小番茄,ai,原则,迭代,英语学习,cy+jf+qt+gw|每日记账',
    smartKeywords: JSON.stringify({
        "cy": ["餐", "吃", "饭", "早餐", "午餐", "晚餐", "宵夜", "食", "菜市场", "菜"],
        "gw": ["购", "买", "购物", "商场", "超市"],
        "jf": ["房租", "水电", "停车费", "物业", "燃气", "网费", "话费", "缴费"]
    }, null, 2),
    habitKeywords: JSON.stringify({
        "sp": ["运动", "深蹲", "哑铃", "散步", "跑步", "健身"],
        "reading": ["阅读", "读了", "看书", "读书"],
        "en": ["学习", "英语", "学了"]
    }, null, 2),
    hotkey: 'Mod+Shift+M',
    itemsPerPage: 50,
    placeholder: '记录此刻的想法...',
    keepOpenAfterSubmit: false,
    openOnStartup: false,
};

/** 解析智能关键词配置 */
export function parseSmartKeywords(jsonStr: string): SmartKeywords {
    try {
        return JSON.parse(jsonStr) || {};
    } catch {
        return {};
    }
}

/** 根据内容匹配智能关键词（记账），返回应添加的标签 */
export function matchSmartKeyword(content: string, smartKeywords: SmartKeywords): string | null {
    // 必须包含数字才触发
    if (!/\d/.test(content)) {
        return null;
    }
    
    for (const [tag, triggers] of Object.entries(smartKeywords)) {
        const hasTrigger = triggers.some(trigger => content.includes(trigger));
        if (hasTrigger) {
            return tag;
        }
    }
    
    return null;
}

/** 根据内容匹配习惯打卡关键词，返回应添加的标签（不需要数字） */
export function matchHabitKeyword(content: string, habitKeywords: SmartKeywords): string | null {
    for (const [tag, triggers] of Object.entries(habitKeywords)) {
        const hasTrigger = triggers.some(trigger => content.includes(trigger));
        if (hasTrigger) {
            return tag;
        }
    }
    
    return null;
}

/** 
 * 解析快捷标签配置
 * 格式支持：
 * - 单关键词：关键词 或 关键词|显示名
 * - 多关键词（分组）：关键词1+关键词2+关键词3|显示名
 * 例如：记账+每日记账+消费+支出|记账
 */
export function parseQuickTags(quickTagsStr: string): QuickTag[] {
    if (!quickTagsStr.trim()) return [];
    
    return quickTagsStr.split(',').map(item => {
        const trimmed = item.trim();
        if (!trimmed) return null;
        
        const parts = trimmed.split('|');
        const keywordsPart = parts[0].trim();
        const label = parts[1]?.trim() || keywordsPart.split('+')[0].trim();
        
        // 解析多关键词（用 + 分隔）
        const keywords = keywordsPart.split('+').map(k => k.trim()).filter(k => k.length > 0);
        if (keywords.length === 0) return null;
        
        // 第一个关键词作为主关键词（用于写入）
        const keyword = keywords[0];
        
        return { keyword, keywords, label };
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
