/**
 * 闪念笔记插件类型定义
 *
 * ## 关键标识符约定
 * - **MemoItem.id**: 随机 UUID，仅用于 DOM data-memo-id 定位卡片，每次解析都会重新生成
 * - **stableMemoId**: `${filePath}-${lineNumber}` 格式，用于番茄钟关联和缓存键
 *   注意：外部编辑文件可能导致行号偏移，需要 reconcilePomodoroSessions() 修复
 */

/**
 * 闪念笔记条目
 * 每条 memo 对应日记文件中的一行列表项（`- HH:mm 内容` 或 `- TODO 内容`）
 */
export interface MemoItem {
    /** 随机 UUID，仅用于 DOM 查询，不适合作为跨刷新的稳定标识 */
    id: string;
    /** 去掉时间戳和标签后的纯文本内容 */
    content: string;
    /** 创建时间戳 */
    timestamp: Date;
    /** 格式化的时间 HH:mm */
    timeString: string;
    /** 从内容中提取的标签列表（不含 # 前缀） */
    tags: string[];
    /** 来源文件路径（Obsidian vault 内的相对路径） */
    filePath: string;
    /** 在文件中的行号（1-based），与 stableMemoId 直接相关 */
    lineNumber: number;
    /** 原始行文本（包含时间戳、标签、任务关键词等） */
    rawText: string;
    /** 日期字符串 YYYY-MM-DD（从文件名推导） */
    dateString: string;
    /** 任务状态（仅任务型 memo 有值） */
    taskStatus?: TaskStatus;
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
    /** 启用任务时间追踪 */
    enableTimeTracking: boolean;
    /** 完成任务时自动追加时长 */
    autoAppendDuration: boolean;
    /** 启用特殊任务列表标签 */
    enableTaskListTags: boolean;
    /** 所有任务列表标签名称 */
    allTasksTagName: string;
    /** 待办任务列表标签名称 */
    todoListTagName: string;
    /** 已完成任务列表标签名称 */
    doneListTagName: string;
    /** 番茄钟时长（分钟） */
    pomodoroDuration: number;
    /** 短休息时长（分钟） */
    pomodoroShortBreak: number;
    /** 长休息时长（分钟） */
    pomodoroLongBreak: number;
    /** 每多少个番茄后进入长休息 */
    pomodoroLongBreakInterval: number;
    /** 番茄钟完成时播放提示音 */
    pomodoroSoundEnabled: boolean;
    /** 启用番茄钟功能 */
    enablePomodoro: boolean;
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
    enableTimeTracking: true,
    autoAppendDuration: true,
    enableTaskListTags: true,
    allTasksTagName: 'ALL TASKS',
    todoListTagName: 'TODO LIST',
    doneListTagName: 'DONE LIST',
    pomodoroDuration: 25,
    pomodoroShortBreak: 5,
    pomodoroLongBreak: 15,
    pomodoroLongBreakInterval: 4,
    pomodoroSoundEnabled: true,
    enablePomodoro: true,
};

/** 解析智能关键词配置 */
export function parseSmartKeywords(jsonStr: string): SmartKeywords {
    try {
        return (JSON.parse(jsonStr) as SmartKeywords) || {};
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
export const POMODORO_STATS_VIEW_TYPE = 'pomodoro-stats-view';

// ============ 行解析正则（storage.ts 的 parseMemoLine 使用） ============

/** 普通 memo：`- 13:33 内容` → [时间, 内容] */
export const MEMO_PATTERN = /^-\s*(\d{2}:\d{2})\s+(.+)$/;

/** 复选框任务：`- [ ] 13:33 内容` 或 `- [x] 内容` → [勾选状态, 时间?, 内容] */
export const TASK_CHECKBOX_PATTERN = /^-\s*\[([ xX])\]\s*(\d{2}:\d{2})?\s*(.+)$/;

/** 关键词任务：`- TODO 13:33 内容` → [关键词, 时间?, 内容] */
export const TASK_KEYWORD_PATTERN = /^-\s*(TODO|DONE|DOING|NOW|LATER|WAITING|CANCELLED)\s+(\d{2}:\d{2})?\s*(.+)$/i;

/** 从内容中提取所有标签：`#tag1 #tag2` → ['tag1', 'tag2'] */
export const TAG_PATTERN = /#([^\s#]+)/g;

/**
 * 任务状态类型
 * - CHECKBOX_*: Markdown 复选框格式 `- [ ]` / `- [x]`
 * - 其他: 关键词格式 `- TODO` / `- DOING` 等，支持时间追踪的完整生命周期
 * 状态流转：TODO → DOING（开始计时）→ DONE（记录时长）; CHECKBOX_UNCHECKED → DOING → CHECKBOX_CHECKED
 */
export type TaskStatus = 'TODO' | 'DONE' | 'DOING' | 'NOW' | 'LATER' | 'WAITING' | 'CANCELLED' | 'CHECKBOX_UNCHECKED' | 'CHECKBOX_CHECKED';

// ============ 番茄钟相关类型 ============
// 详细架构说明见 pomodoro.ts 文件头注释

/**
 * 番茄钟状态机
 * idle → running ⇄ paused → completed → short_break/long_break → idle
 */
export type PomodoroState = 'idle' | 'running' | 'paused' | 'completed' | 'short_break' | 'long_break';

/** 单次暂停的起止记录，用于精确扣除暂停时间 */
export interface PomodoroPauseRecord {
    /** 暂停开始时间戳 (Date.now()) */
    pauseStartTime: number;
    /** 恢复时回填，未恢复时为 undefined */
    pauseEndTime?: number;
    /** 本次暂停时长（秒），恢复时计算并回填 */
    duration?: number;
}

/**
 * 单个番茄钟会话
 * 专注阶段和休息阶段使用同一结构，通过 state 区分
 */
export interface PomodoroSession {
    /** 随机唯一 ID（`pomodoro-${timestamp}-${random}`） */
    id: string;
    /** stableMemoId 格式：`${filePath}-${lineNumber}`，关联到具体 memo */
    memoId: string;
    /** 关联任务的内容摘要，启动时传入，用于统计面板展示 */
    memoContent?: string;
    /** 会话类型：focus=专注，break=休息（short/long 用 state 区分） */
    sessionType?: 'focus' | 'break';
    /** 休息是否被手动跳过/提前结束 */
    skipped?: boolean;
    /** 专注/休息开始的时间戳 (Date.now()) */
    startTime: number;
    /** 专注完成时回填 */
    endTime?: number;
    /** 计划时长（分钟），专注阶段=设置值，休息阶段=breakMinutes */
    plannedMinutes: number;
    /** 实际专注时长（分钟），完成时计算（排除暂停） */
    actualMinutes?: number;
    state: PomodoroState;
    /** 每秒更新的倒计时（UI 直接读取） */
    remainingSeconds?: number;
    /** 已结算的暂停累计秒数（不含当前未关闭的暂停） */
    pausedAccumulatedSeconds?: number;
    /** 暂停历史，每次 pause/resume 追加一条 */
    pauseHistory?: PomodoroPauseRecord[];
    /** 连续完成计数，longBreakInterval 取模判断是否进入长休息 */
    consecutiveCount?: number;
    /** 仅休息阶段使用：休息时长（分钟） */
    breakMinutes?: number;
}

/** 番茄钟统计数据 */
export interface PomodoroStats {
    /** 总番茄数 */
    totalPomodoros: number;
    /** 总专注时长（分钟） */
    totalFocusMinutes: number;
    /** 今日番茄数 */
    todayPomodoros: number;
    /** 今日专注时长（分钟） */
    todayFocusMinutes: number;
    /** 今日休息次数 */
    todayBreaks: number;
    /** 今日休息时长（分钟） */
    todayBreakMinutes: number;
    /** 总休息次数 */
    totalBreaks: number;
    /** 总休息时长（分钟） */
    totalBreakMinutes: number;
    /** 按标签分组的统计 */
    byTag: { [tag: string]: { count: number; minutes: number } };
}
