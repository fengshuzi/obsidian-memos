/**
 * 闪念笔记插件设置页面
 */

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

        containerEl.createEl('h2', { text: '闪念笔记设置' });

        // 存储设置
        containerEl.createEl('h3', { text: '📁 存储' });

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
        containerEl.createEl('h3', { text: '⚙️ 行为' });

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

        // 标签设置
        containerEl.createEl('h3', { text: '🏷️ 标签' });

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
            .setDesc('输入框下方显示的常用标签按钮。格式：关键词|显示名，用逗号分隔。例如：idea|灵感,read|读书笔记,工作')
            .addTextArea(text => text
                .setPlaceholder('今天也要用心过生活,p1|重要且紧急,工作,健身')
                .setValue(this.plugin.settings.quickTags)
                .onChange(async (value) => {
                    this.plugin.settings.quickTags = value;
                    await this.plugin.saveSettings();
                }));

        // 界面设置
        containerEl.createEl('h3', { text: '🎨 界面' });

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

        // 快捷键提示
        containerEl.createEl('h3', { text: '⌨️ 快捷键' });
        
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
        containerEl.createEl('h3', { text: '📖 关于' });
        
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
    }
}
