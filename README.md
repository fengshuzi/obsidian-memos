# Obsidian 闪念笔记插件

像发微博一样记录灵感 - 支持时间戳、标签分类和历史浏览，类似 Flomo 的轻量笔记体验。

## 功能特性

- 🚀 **快速捕获** - 按下快捷键即可快速记录灵感，无需中断工作流
- ⏰ **自动时间戳** - 每条闪念自动添加时间戳，格式：`- HH:mm 内容`
- 🏷️ **标签分类** - 支持添加标签，方便后续筛选和整理
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

## 设置选项

- **Journal 文件夹** - 闪念存储的文件夹路径，默认 `journals`
- **日期格式** - Journal 文件名的日期格式，默认 `YYYY-MM-DD`
- **时间格式** - 时间戳格式，默认 `HH:mm`
- **默认标签** - 新建闪念时自动添加的标签
- **每页显示数量** - 列表分页显示的条数
- **提交后保持弹窗打开** - 方便连续记录多条闪念

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

## 设计灵感

- [Logseq](https://logseq.com/) - 闪念功能和 Journal 格式
- [Flomo](https://flomoapp.com/) - 卡片式 UI 和轻量记录体验
- [Obsidian Thino](https://github.com/Quorafind/Obsidian-Thino) - 插件交互参考

## 许可证

MIT License
