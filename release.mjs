import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';

// 读取 manifest.json 获取版本号
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const version = manifest.version;
const tagName = `obsidian-memos-v${version}`;

console.log(`📦 准备发布 Obsidian Memos v${version}...\n`);

// 检查是否安装了 gh CLI
try {
    execSync('gh --version', { stdio: 'ignore' });
} catch {
    console.error('❌ 错误: 需要安装 GitHub CLI (gh)');
    console.log('   请访问 https://cli.github.com/ 安装');
    process.exit(1);
}

// 构建项目
console.log('🔨 构建项目...');
try {
    execSync('npm run build', { stdio: 'inherit' });
} catch {
    console.error('❌ 构建失败');
    process.exit(1);
}

// 检查构建产物位置
let mainJsPath = 'dist/main.js';
if (!existsSync(mainJsPath)) {
    mainJsPath = 'main.js';
    if (!existsSync(mainJsPath)) {
        console.error('❌ 找不到 main.js');
        process.exit(1);
    }
}

const manifestPath = existsSync('dist/manifest.json') ? 'dist/manifest.json' : 'manifest.json';
const stylesPath = existsSync('dist/styles.css') ? 'dist/styles.css' : 'styles.css';

// 默认覆盖：若 tag/Release 已存在则先删除再创建
console.log(`\n🏷️  创建 tag: ${tagName}`);
try {
    try {
        execSync(`git tag -d ${tagName}`, { stdio: 'ignore' });
        console.log(`   已删除本地 tag ${tagName}`);
    } catch { /* ignore */ }
    try {
        execSync(`git push origin :refs/tags/${tagName}`, { stdio: 'ignore' });
        console.log(`   已删除远程 tag ${tagName}`);
    } catch { /* ignore */ }
    try {
        execSync(`gh release delete ${tagName} --yes`, { stdio: 'ignore' });
        console.log(`   已删除 GitHub Release ${tagName}`);
    } catch { /* ignore */ }

    execSync(`git tag -a ${tagName} -m "Release ${version}"`, { stdio: 'inherit' });
} catch (error) {
    throw error;
}

// 推送 tag
console.log('\n📤 推送 tag 到远程...');
try {
    execSync(`git push origin ${tagName}`, { stdio: 'inherit' });
} catch {
    console.error('❌ 推送 tag 失败');
    process.exit(1);
}

// 创建 GitHub Release
console.log('\n🚀 创建 GitHub Release...');
try {
    const releaseNotes = `## Obsidian Memos v${version}

### 功能特性
- 🚀 快速捕获灵感，像发微博一样记录笔记
- ⏰ 自动添加时间戳
- 🏷️ 支持标签分类
- 📅 存储在 journals 文件夹
- 📋 卡片式历史浏览

### 安装
1. 下载 \`main.js\`、\`manifest.json\` 和 \`styles.css\`
2. 复制到 \`.obsidian/plugins/obsidian-memos/\` 目录
3. 在 Obsidian 设置中启用插件
`;
    
    execSync(`gh release create ${tagName} ${mainJsPath} ${manifestPath} ${stylesPath} --title "v${version}" --notes "${releaseNotes.replace(/"/g, '\\"')}"`, { stdio: 'inherit' });
    console.log(`\n✅ 发布成功! Release: ${tagName}`);
} catch {
    console.error('❌ 创建 Release 失败');
    process.exit(1);
}
