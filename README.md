# Obsidian 闪念笔记插件

像发微博一样记录灵感 - 支持时间戳、标签分类和历史浏览，类似 Flomo 的轻量笔记体验。

## 功能特性

- 🚀 **快速捕获** - 按下快捷键即可快速记录灵感，无需中断工作流
- ⏰ **自动时间戳** - 每条闪念自动添加时间戳，格式：`- HH:mm 内容`
- 🏷️ **标签分类** - 支持添加标签，方便后续筛选和整理
- ✅ **任务支持** - 支持复选框和任务关键词格式，自动识别并显示任务状态
- ⏱️ **时间追踪** - 点击任务可切换状态并自动追踪耗时，参考 obsidian-time-tracking
- 📋 **任务列表** - 特殊标签快速查看所有任务、待办任务、已完成任务
- 📅 **Journal 存储** - 闪念存储在 journals 文件夹，与 Logseq 格式兼容
- 📋 **卡片式浏览** - 类似 Flomo 的卡片列表，支持按日期分组
- 🔍 **搜索筛选** - 支持关键词搜索和标签筛选

## 安装

### 手动安装

1. 下载最新版本的 `main.js`、`manifest.json` 和 `styles.css`
2. 在 Obsidian vault 的 `.obsidian/plugins/` 目录下创建 `obsidian-memos` 文件夹
3. 将下载的文件复制到该文件夹
4. 重启 Obsidian 或重新加载插件
5. 在设置 → 第三方插件中启用「闪念笔记」

## 使用方法

### 快捷键

- `Cmd/Ctrl + Shift + M` - 打开闪念输入弹窗
- 在输入弹窗内：
  - `Cmd/Ctrl + Enter` - 发送闪念
  - `Cmd/Ctrl + Shift + Enter` - 发送并继续输入
  - `Escape` - 关闭弹窗

### 命令面板

- `闪念笔记: 打开闪念视图` - 打开侧边栏视图
- `闪念笔记: 新建闪念` - 打开输入弹窗
- `闪念笔记: 刷新闪念列表` - 刷新列表

### 闪念格式

闪念以列表项的形式存储在 journal 文件中：

```markdown
- 14:30 这是一条闪念笔记
- 14:35 #想法 #灵感 这是带标签的闪念
- 15:00 支持 **Markdown** 格式
```

### 任务格式支持

插件支持多种任务格式，所有任务都会被识别为闪念笔记并显示对应的状态图标：

#### 1. 复选框格式
```markdown
- [ ] 13:33 未完成的任务
- [x] 14:00 已完成的任务
- [ ] 未完成的任务（无时间戳）
```

#### 2. 任务关键词格式
```markdown
- TODO 15:00 待办事项
- DOING 15:30 正在进行
- DONE 16:00 已完成
- NOW 16:30 立即执行
- LATER 17:00 稍后处理
- WAITING 17:30 等待中
- CANCELLED 18:00 已取消
```

#### 3. 任务状态显示和时间追踪

在闪念视图中，任务会显示对应的状态图标和彩色边框，并支持点击切换状态和时间追踪：

**状态图标：**
- ☐ 未完成复选框（灰色边框）
- ☑ 已完成复选框（绿色边框，半透明）
- 📝 TODO（蓝色边框）
- ⚡ DOING（橙色边框）
- ✅ DONE（绿色边框，半透明）
- 🔥 NOW（红色边框）
- ⏰ LATER（紫色边框）
- ⏳ WAITING（青色边框）
- ❌ CANCELLED（灰色边框，半透明，删除线）

**时间追踪功能：**
- 点击复选框或状态图标可以切换任务状态
- 切换到 DOING 状态时自动记录开始时间
- 完成任务时自动计算并显示耗时
- 状态切换流程：
  - `[ ]` → `DOING` → `[x]` （带时长）
  - `TODO` → `DOING` → `DONE` （带时长）
  - `DONE` → 普通列表项

**示例：**
```markdown
- [ ] 13:33 完成报告
# 点击复选框后变为：
- DOING 14:00 <!-- ts:2024-02-09T14:00:00.000Z|source:checkbox --> 完成报告
# 再次点击后变为：
- [x] 13:33 完成报告 25分钟
```

## 设置选项

- **Journal 文件夹** - 闪念存储的文件夹路径，默认 `journals`
- **日期格式** - Journal 文件名的日期格式，默认 `YYYY-MM-DD`
- **时间格式** - 时间戳格式，默认 `HH:mm`
- **默认标签** - 新建闪念时自动添加的标签
- **每页显示数量** - 列表分页显示的条数
- **提交后保持弹窗打开** - 方便连续记录多条闪念
- **启用任务时间追踪** - 点击任务复选框时自动切换状态并追踪耗时（默认开启）
- **自动追加时长** - 完成任务时自动在任务末尾追加耗时（默认开启）
- **启用任务列表标签** - 显示特殊的任务列表标签（默认开启）
- **任务列表标签名称** - 自定义 ALL TASKS、TODO LIST、DONE LIST 的显示名称

### 任务列表标签

点击快捷标签区域的特殊标签可以快速筛选任务：

- **ALL TASKS**：显示所有任务（包括 `[ ]`、`[x]`、`TODO`、`DOING`、`DONE` 等）
- **TODO LIST**：显示未完成任务（`[ ]`、`TODO`、`DOING`、`NOW`、`LATER`、`WAITING`）
- **DONE LIST**：显示已完成任务（`[x]`、`DONE`、`CANCELLED`）

## 开发

```bash
# 安装依赖
npm install

# 开发模式（监听文件变化）
npm run dev

# 生产构建
npm run build

# 构建并部署到本地 vault
npm run build-deploy

# 发布到 GitHub
npm run release
```

## 插件开发参考：监听文件变化并自动刷新视图

当插件依赖 vault 内某些文件（如本插件的 journals 日记）时，若文件被**外部工具**修改（如 Alfred、Python 脚本、Quick Add 等），Obsidian 的 `vault.on('modify')` 有时不会触发，视图不会自动刷新。可采用「vault 事件 + metadataCache 事件」双监听，无需定时轮询。

### 思路

- **vault.on('modify' | 'create' | 'delete')**：Obsidian 自身或部分外部写入会触发，先监听并刷新。
- **metadataCache.on('changed')**：外部修改文件后，Obsidian 重新解析该文件时会触发，用于兜底外部写入（如 Alfred/Python 写盘）。

仅当变更的是「你关心的路径」时再失效缓存并刷新视图，避免无关文件变更导致多余刷新。

### 示例（main.ts / 插件入口）

```ts
// 1. 存储层：文件变化时失效缓存，并告知「是否生效」
// storage.ts
onFileChange(file: TFile): boolean {
    if (isMyTargetFile(file)) {  // 仅关心某路径/扩展名
        this.invalidateCache();
        return true;
    }
    return false;
}

// 2. 插件层：vault 三事件 + metadataCache.changed，生效时刷新视图
// main.ts
this.registerEvent(this.app.vault.on('modify', (file) => {
    if (file instanceof TFile && this.storage?.onFileChange(file)) {
        this.getActiveMyView()?.refresh();
    }
}));
this.registerEvent(this.app.vault.on('create', (file) => {
    if (file instanceof TFile && this.storage?.onFileChange(file)) {
        this.getActiveMyView()?.refresh();
    }
}));
this.registerEvent(this.app.vault.on('delete', (file) => {
    if (file instanceof TFile && this.storage?.onFileChange(file)) {
        this.getActiveMyView()?.refresh();
    }
}));
// 外部修改（如 Alfred/Python 写文件）时，vault.modify 可能不触发；
// metadataCache 在重新解析文件后会触发 changed
this.registerEvent(this.app.metadataCache.on('changed', (file) => {
    if (file instanceof TFile && this.storage?.onFileChange(file)) {
        this.getActiveMyView()?.refresh();
    }
}));
```

其他插件只需：实现自己的 `isMyTargetFile` 与 `invalidateCache`，并在 `onFileChange` 里返回是否生效；在 main 里用上述四段 `registerEvent` 即可复用该方案。

## 设计灵感

- [Logseq](https://logseq.com/) - 闪念功能和 Journal 格式
- [Flomo](https://flomoapp.com/) - 卡片式 UI 和轻量记录体验
- [Obsidian Thino](https://github.com/Quorafind/Obsidian-Thino) - 插件交互参考

## 许可证

MIT License
