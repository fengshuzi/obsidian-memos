import { copyFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// 定义基础路径
const BASE_PATH = join(
    homedir(),
    'Library/Mobile Documents/iCloud~md~obsidian/Documents/漂泊者及其影子'
);

const NOTE_DEMO_PATH = join(
    homedir(),
    'Library/Mobile Documents/iCloud~md~obsidian/Documents/note-demo'
);

// 定义目标 vault 配置目录
const VAULTS = [
    {
        name: 'Pro',
        path: join(BASE_PATH, '.obsidian-pro/plugins/obsidian-memos')
    },
    {
        name: '2017',
        path: join(BASE_PATH, '.obsidian-2017/plugins/obsidian-memos')
    },
    {
        name: 'Zhang',
        path: join(BASE_PATH, '.obsidian-zhang/plugins/obsidian-memos')
    },
    {
        name: 'Note-Demo',
        path: join(NOTE_DEMO_PATH, '.obsidian/plugins/obsidian-memos')
    }
];

// 需要复制的文件（都从 dist 目录）
const FILES_TO_COPY = [
    { src: 'dist/main.js', dest: 'main.js' },
    { src: 'dist/manifest.json', dest: 'manifest.json' },
    { src: 'dist/styles.css', dest: 'styles.css' }
];

console.log('📦 开始部署 Obsidian Memos 插件到所有 vaults...\n');

let successCount = 0;
let failCount = 0;

// 复制文件到每个 vault
VAULTS.forEach(vault => {
    console.log(`📁 部署到 ${vault.name} vault...`);
    
    try {
        // 创建目录（如果不存在）
        if (!existsSync(vault.path)) {
            mkdirSync(vault.path, { recursive: true });
            console.log(`  ✓ 创建目录: ${vault.path}`);
        }
        
        // 复制文件
        let allFilesExist = true;
        FILES_TO_COPY.forEach(({ src, dest }) => {
            if (existsSync(src)) {
                copyFileSync(src, join(vault.path, dest));
                console.log(`  ✓ 已复制 ${src} → ${dest}`);
            } else {
                console.log(`  ⚠️  警告: ${src} 不存在`);
                allFilesExist = false;
            }
        });
        
        if (allFilesExist) {
            successCount++;
        } else {
            failCount++;
        }
    } catch (error) {
        console.error(`  ❌ 部署到 ${vault.name} 失败:`, error.message);
        failCount++;
    }
    
    console.log('');
});

console.log(`🎉 部署完成！成功: ${successCount}, 失败: ${failCount}`);
console.log('\n💡 提示: 在 Obsidian 中重新加载插件以查看更改');
console.log('   - 打开命令面板 (Cmd/Ctrl + P)');
console.log('   - 搜索 "Reload app without saving"');
console.log('   - 或者禁用再启用插件\n');

// 清理 dist 文件夹
try {
    rmSync('dist', { recursive: true, force: true });
    console.log('🧹 已清理 dist 文件夹\n');
} catch (error) {
    console.log('⚠️  清理 dist 文件夹失败:', error.message, '\n');
}
