/**
 * 闪念笔记插件设置页面
 */

/* eslint-disable obsidianmd/ui/sentence-case */
import { App, PluginSettingTab, Setting } from 'obsidian';
import type MemosPlugin from './main';

export class MemosSettingTab extends PluginSettingTab {
    plugin: MemosPlugin;

    constructor(app: App, plugin: MemosPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl).setName('闪念笔记设置').setHeading();

        // 存储设置
        new Setting(containerEl).setName('📁 存储').setHeading();

        new Setting(containerEl)
            .setName('Journal 文件夹')
            .setDesc('闪念笔记存储的文件夹路径')
            .addText(text => text
                .setPlaceholder('journals')
                .setValue(this.plugin.settings.journalFolder)
                .onChange(async (value) => {
                    this.plugin.settings.journalFolder = value || 'journals';
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('日期格式')
            .setDesc('Journal 文件名的日期格式')
            .addText(text => text
                .setPlaceholder('YYYY-MM-DD')
                .setValue(this.plugin.settings.dateFormat)
                .onChange(async (value) => {
                    this.plugin.settings.dateFormat = value || 'YYYY-MM-DD';
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('时间格式')
            .setDesc('闪念笔记的时间戳格式')
            .addText(text => text
                .setPlaceholder('HH:mm')
                .setValue(this.plugin.settings.timeFormat)
                .onChange(async (value) => {
                    this.plugin.settings.timeFormat = value || 'HH:mm';
                    await this.plugin.saveSettings();
                }));

        // 行为设置
        new Setting(containerEl).setName('⚙️ 行为').setHeading();

        new Setting(containerEl)
            .setName('显示时间戳')
            .setDesc('在闪念笔记前添加时间戳')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showTimestamp)
                .onChange(async (value) => {
                    this.plugin.settings.showTimestamp = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('提交后保持弹窗打开')
            .setDesc('发送闪念后继续保持输入弹窗打开，方便连续记录')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.keepOpenAfterSubmit)
                .onChange(async (value) => {
                    this.plugin.settings.keepOpenAfterSubmit = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('启动时打开闪念')
            .setDesc('Obsidian 启动时自动打开闪念页面作为默认页面')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.openOnStartup)
                .onChange(async (value) => {
                    this.plugin.settings.openOnStartup = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('每页显示数量')
            .setDesc('闪念列表每页显示的条目数')
            .addSlider(slider => slider
                .setLimits(10, 100, 10)
                .setValue(this.plugin.settings.itemsPerPage)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.itemsPerPage = value;
                    await this.plugin.saveSettings();
                }));

        // 任务时间追踪设置
        new Setting(containerEl).setName('⏱️ 任务时间追踪').setHeading();

        new Setting(containerEl)
            .setName('启用任务时间追踪')
            .setDesc('点击任务复选框时自动切换状态并追踪耗时（参考 obsidian-time-tracking）')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableTimeTracking)
                .onChange(async (value) => {
                    this.plugin.settings.enableTimeTracking = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('自动追加时长')
            .setDesc('完成任务时自动在任务末尾追加耗时（如：25分钟）')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoAppendDuration)
                .onChange(async (value) => {
                    this.plugin.settings.autoAppendDuration = value;
                    await this.plugin.saveSettings();
                }));

        const trackingInfo = containerEl.createDiv({ cls: 'setting-item' });
        trackingInfo.createEl('p', { 
            text: '时间追踪说明：',
            cls: 'setting-item-description'
        });
        const trackingList = trackingInfo.createEl('ul');
        trackingList.createEl('li', { text: '点击复选框：[ ] → DOING → [x]（带时长）' });
        trackingList.createEl('li', { text: '点击复选框：TODO → DOING → DONE（带时长）' });
        trackingList.createEl('li', { text: 'DOING 状态会记录开始时间并显示在任务前' });
        trackingList.createEl('li', { text: '完成任务时自动计算并显示耗时' });

        // 任务列表标签设置
        new Setting(containerEl).setName('📋 任务列表标签').setHeading();

        new Setting(containerEl)
            .setName('启用任务列表标签')
            .setDesc('在快捷标签区域显示特殊的任务列表标签（ALL TASKS、TODO LIST、DONE LIST）')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableTaskListTags)
                .onChange(async (value) => {
                    this.plugin.settings.enableTaskListTags = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('所有任务标签名称')
            .setDesc('显示所有任务（包括 markdown 复选框和关键词任务）的标签名称')
            .addText(text => text
                .setPlaceholder('ALL TASKS')
                .setValue(this.plugin.settings.allTasksTagName)
                .onChange(async (value) => {
                    this.plugin.settings.allTasksTagName = value || 'ALL TASKS';
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('待办任务标签名称')
            .setDesc('显示未完成任务的标签名称')
            .addText(text => text
                .setPlaceholder('TODO LIST')
                .setValue(this.plugin.settings.todoListTagName)
                .onChange(async (value) => {
                    this.plugin.settings.todoListTagName = value || 'TODO LIST';
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('已完成任务标签名称')
            .setDesc('显示已完成任务的标签名称')
            .addText(text => text
                .setPlaceholder('DONE LIST')
                .setValue(this.plugin.settings.doneListTagName)
                .onChange(async (value) => {
                    this.plugin.settings.doneListTagName = value || 'DONE LIST';
                    await this.plugin.saveSettings();
                }));

        const taskListInfo = containerEl.createDiv({ cls: 'setting-item' });
        taskListInfo.createEl('p', { 
            text: '任务列表说明：',
            cls: 'setting-item-description'
        });
        const taskListList = taskListInfo.createEl('ul');
        taskListList.createEl('li', { text: 'ALL TASKS：显示所有任务（[ ]、[x]、TODO、DOING、DONE 等）' });
        taskListList.createEl('li', { text: 'TODO LIST：显示未完成任务（[ ]、TODO、DOING、NOW、LATER、WAITING）' });
        taskListList.createEl('li', { text: 'DONE LIST：显示已完成任务（[x]、DONE、CANCELLED）' });

        // 标签设置
        new Setting(containerEl).setName('🏷️ 标签').setHeading();

        new Setting(containerEl)
            .setName('默认标签')
            .setDesc('新建闪念时自动添加的标签，用逗号分隔')
            .addText(text => text
                .setPlaceholder('memo, fleeting')
                .setValue(this.plugin.settings.defaultTags.join(', '))
                .onChange(async (value) => {
                    this.plugin.settings.defaultTags = value
                        .split(',')
                        .map(t => t.trim())
                        .filter(t => t.length > 0);
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('快捷标签')
            .setDesc('输入框下方显示的常用标签按钮。格式：关键词|显示名。多关键词分组用 + 连接：记账+消费+支出|记账（点击时筛选所有相关标签）')
            .addTextArea(text => text
                .setPlaceholder('今天也要用心过生活,p1|重要且紧急,记账+消费+支出|记账,工作')
                .setValue(this.plugin.settings.quickTags)
                .onChange(async (value) => {
                    this.plugin.settings.quickTags = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('智能关键词（记账识别）')
            .setDesc('内容包含数字+关键词时自动添加标签。JSON格式：{"标签": ["关键词1", "关键词2"]}。例如输入「午餐10元」自动加 #cy')
            .addTextArea(text => {
                text.inputEl.setCssProps({ 'width': '100%', 'height': '120px', 'font-family': 'monospace' });
                text
                    .setPlaceholder('{"cy": ["餐", "吃", "午餐"], "gw": ["购", "买"]}')
                    .setValue(this.plugin.settings.smartKeywords)
                    .onChange(async (value) => {
                        this.plugin.settings.smartKeywords = value;
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName('习惯打卡关键词')
            .setDesc('内容包含关键词时自动添加标签（不需要数字）。JSON格式：{"标签": ["关键词1", "关键词2"]}。例如输入「深蹲50个」自动加 #sp')
            .addTextArea(text => {
                text.inputEl.setCssProps({ 'width': '100%', 'height': '120px', 'font-family': 'monospace' });
                text
                    .setPlaceholder('{"sp": ["运动", "深蹲", "哑铃"], "reading": ["阅读", "读书"]}')
                    .setValue(this.plugin.settings.habitKeywords)
                    .onChange(async (value) => {
                        this.plugin.settings.habitKeywords = value;
                        await this.plugin.saveSettings();
                    });
            });

        // 界面设置
        new Setting(containerEl).setName('🎨 界面').setHeading();

        new Setting(containerEl)
            .setName('输入框占位文本')
            .setDesc('输入弹窗的占位提示文字')
            .addText(text => text
                .setPlaceholder('记录此刻的想法...')
                .setValue(this.plugin.settings.placeholder)
                .onChange(async (value) => {
                    this.plugin.settings.placeholder = value || '记录此刻的想法...';
                    await this.plugin.saveSettings();
                }));

        // 番茄钟设置
        new Setting(containerEl).setName('🍅 番茄钟').setHeading();

        new Setting(containerEl)
            .setName('启用番茄钟')
            .setDesc('在任务卡片上显示番茄钟功能')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enablePomodoro)
                .onChange(async (value) => {
                    this.plugin.settings.enablePomodoro = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('专注时长')
            .setDesc('每个番茄钟的专注时间（分钟）')
            .addSlider(slider => slider
                .setLimits(1, 60, 1)
                .setValue(this.plugin.settings.pomodoroDuration)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.pomodoroDuration = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('短休息时长')
            .setDesc('每个番茄钟完成后的短休息时间（分钟）')
            .addSlider(slider => slider
                .setLimits(1, 30, 1)
                .setValue(this.plugin.settings.pomodoroShortBreak)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.pomodoroShortBreak = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('长休息时长')
            .setDesc('连续完成多个番茄钟后的长休息时间（分钟）')
            .addSlider(slider => slider
                .setLimits(5, 60, 5)
                .setValue(this.plugin.settings.pomodoroLongBreak)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.pomodoroLongBreak = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('长休息间隔')
            .setDesc('每完成多少个番茄后进入长休息')
            .addSlider(slider => slider
                .setLimits(2, 8, 1)
                .setValue(this.plugin.settings.pomodoroLongBreakInterval)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.pomodoroLongBreakInterval = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('完成提示音')
            .setDesc('番茄钟和休息完成时播放提示音')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.pomodoroSoundEnabled)
                .onChange(async (value) => {
                    this.plugin.settings.pomodoroSoundEnabled = value;
                    await this.plugin.saveSettings();
                }));

        // 快捷键提示
        new Setting(containerEl).setName('⌨️ 快捷键').setHeading();
        
        const hotkeyInfo = containerEl.createDiv({ cls: 'setting-item' });
        hotkeyInfo.createEl('p', { 
            text: '以下快捷键可在 Obsidian 设置 → 快捷键 中自定义：',
            cls: 'setting-item-description'
        });
        
        const hotkeyList = hotkeyInfo.createEl('ul');
        hotkeyList.createEl('li', { text: '打开闪念视图：闪念笔记: 打开闪念视图' });
        hotkeyList.createEl('li', { text: '新建闪念：闪念笔记: 新建闪念 (默认 Cmd/Ctrl + Shift + M)' });
        hotkeyList.createEl('li', { text: '刷新闪念列表：闪念笔记: 刷新闪念列表' });

        // 输入弹窗快捷键
        const modalHotkeys = hotkeyInfo.createDiv();
        modalHotkeys.createEl('p', { 
            text: '输入弹窗内快捷键：',
            cls: 'setting-item-description'
        });
        const modalHotkeyList = modalHotkeys.createEl('ul');
        modalHotkeyList.createEl('li', { text: 'Cmd/Ctrl + Enter：发送闪念' });
        modalHotkeyList.createEl('li', { text: 'Cmd/Ctrl + Shift + Enter：发送并继续输入' });
        modalHotkeyList.createEl('li', { text: 'Escape：关闭弹窗' });

        // 关于
        new Setting(containerEl).setName('📖 关于').setHeading();
        
        const aboutInfo = containerEl.createDiv({ cls: 'setting-item' });
        aboutInfo.createEl('p', { 
            text: '闪念笔记插件灵感来自 Logseq 的闪念功能和 Flomo 笔记应用。',
            cls: 'setting-item-description'
        });
        aboutInfo.createEl('p', { 
            text: '闪念格式：- HH:mm #标签 内容',
            cls: 'setting-item-description'
        });
        aboutInfo.createEl('p', { 
            text: '所有闪念都存储在 journals 文件夹的日期文件中，与 Logseq 格式兼容。',
            cls: 'setting-item-description'
        });

        const donateSection = containerEl.createDiv({ cls: 'plugin-donate-section' });
        new Setting(donateSection).setName('☕ 请作者喝杯咖啡').setHeading();
        donateSection.createEl('p', { text: '如果这个插件帮助了你，欢迎请作者喝杯咖啡 ☕', cls: 'plugin-donate-desc' });
        const imgWrap = donateSection.createDiv({ cls: 'plugin-donate-qr' });
        imgWrap.createEl('img', { attr: { src: this.plugin.app.vault.adapter.getResourcePath(`${this.plugin.manifest.dir}/assets/wechat-donate.jpg`), alt: '微信打赏', width: '160' } });
        imgWrap.createEl('p', { text: '微信扫码', cls: 'plugin-donate-label' });
    }
}
