#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Alfred 脚本：向 Obsidian 日记文件追加闪念笔记，支持智能标签识别
"""

import os
import sys
import json
import re
from datetime import datetime
from pathlib import Path

# ========== 配置区域 ==========
# Obsidian vault 路径
VAULT_PATH = "/Users/lizhifeng/Library/Mobile Documents/iCloud~md~obsidian/Documents/漂泊者及其影子"
# 日记文件夹路径（相对于 vault）
JOURNALS_FOLDER = "journals"
# 插件配置路径（相对于 vault）
PLUGIN_CONFIG_PATH = ".obsidian/plugins/obsidian-memos/data.json"

# ========== 默认智能关键词配置（如果无法读取插件配置则使用此配置）==========
DEFAULT_SMART_KEYWORDS = {
    "cy": ["餐", "吃", "饭", "早餐", "午餐", "晚餐", "宵夜", "食", "菜市场", "菜"],
    "gw": ["购", "买", "购物", "商场", "超市"],
    "jf": ["房租", "水电", "停车费", "物业", "燃气", "网费", "话费", "缴费"]
}

DEFAULT_HABIT_KEYWORDS = {
    "sp": ["运动", "深蹲", "哑铃", "散步", "跑步", "健身"],
    "reading": ["阅读", "读了", "看书", "读书"],
    "en": ["学习", "英语", "学了"]
}


def load_plugin_config():
    """加载插件配置"""
    config_file = os.path.join(VAULT_PATH, PLUGIN_CONFIG_PATH)
    
    try:
        if os.path.exists(config_file):
            with open(config_file, "r", encoding="utf-8") as f:
                config = json.load(f)
            
            # 解析智能关键词（记账）
            smart_keywords_str = config.get("smartKeywords", "{}")
            try:
                smart_keywords = json.loads(smart_keywords_str) if isinstance(smart_keywords_str, str) else smart_keywords_str
            except:
                smart_keywords = DEFAULT_SMART_KEYWORDS
            
            # 解析习惯打卡关键词
            habit_keywords_str = config.get("habitKeywords", "{}")
            try:
                habit_keywords = json.loads(habit_keywords_str) if isinstance(habit_keywords_str, str) else habit_keywords_str
            except:
                habit_keywords = DEFAULT_HABIT_KEYWORDS
            
            return smart_keywords, habit_keywords
    except Exception as e:
        print(f"⚠️ 读取插件配置失败: {e}", file=sys.stderr)
    
    return DEFAULT_SMART_KEYWORDS, DEFAULT_HABIT_KEYWORDS


def match_smart_keyword(content, smart_keywords):
    """
    匹配记账关键词（需要数字）
    返回匹配到的标签，如果没有匹配则返回 None
    """
    # 必须包含数字才触发
    if not re.search(r'\d', content):
        return None
    
    for tag, triggers in smart_keywords.items():
        if any(trigger in content for trigger in triggers):
            return tag
    
    return None


def match_habit_keyword(content, habit_keywords):
    """
    匹配习惯打卡关键词（不需要数字）
    返回匹配到的标签，如果没有匹配则返回 None
    """
    for tag, triggers in habit_keywords.items():
        if any(trigger in content for trigger in triggers):
            return tag
    
    return None


def add_smart_tags(content):
    """
    根据内容自动添加智能标签
    返回添加标签后的内容
    """
    # 加载配置
    smart_keywords, habit_keywords = load_plugin_config()
    
    # 检查内容中已有的标签
    existing_tags = set(re.findall(r'#([^\s#]+)', content))
    
    tags_to_add = []
    
    # 1. 检查记账关键词（需要数字）
    smart_tag = match_smart_keyword(content, smart_keywords)
    if smart_tag and smart_tag not in existing_tags:
        tags_to_add.append(smart_tag)
    
    # 2. 检查习惯打卡关键词（不需要数字）
    habit_tag = match_habit_keyword(content, habit_keywords)
    if habit_tag and habit_tag not in existing_tags:
        tags_to_add.append(habit_tag)
    
    # 如果有标签要添加，追加到内容末尾
    if tags_to_add:
        tags_str = " ".join(f"#{tag}" for tag in tags_to_add)
        # 如果内容末尾没有空格，先加一个空格
        if content and not content.endswith(" "):
            content += " "
        content += tags_str
    
    return content


def main():
    if len(sys.argv) < 2:
        print("用法: python alfred_add_memo.py <内容>")
        sys.exit(1)
    
    # 获取输入内容
    original_content = sys.argv[1].strip()
    
    # 应用智能标签
    content = add_smart_tags(original_content)
    
    # ========== 原有逻辑：写入文件 ==========
    current_date = datetime.now().strftime("%Y-%m-%d")
    folder_path = os.path.join(VAULT_PATH, JOURNALS_FOLDER)
    os.makedirs(folder_path, exist_ok=True)
    file_path = os.path.join(folder_path, f"{current_date}.md")
    
    # 确保文件存在
    if not os.path.exists(file_path):
        open(file_path, "w", encoding="utf-8").close()
    
    # 构建要写入的行（自带末尾换行）
    if content.startswith("-"):
        new_line = f"{content}\n"
    elif "#ril" in content:
        new_line = f"- {content}\n"
    else:
        hm_date = datetime.now().strftime("%H:%M")
        new_line = f"- {hm_date} {content}\n"
    
    # 读取所有行，保留行尾换行符
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            lines = f.readlines()
    except:
        lines = []
    
    # 判断最后一行是否为空行或仅含 "-"
    if lines and lines[-1].strip() in ("", "-"):
        # 删除占位行
        lines = lines[:-1]
        # 重写文件，先写现有内容（已包含换行）
        with open(file_path, "w", encoding="utf-8") as f:
            f.writelines(lines)
        # 直接追加新行
        with open(file_path, "a", encoding="utf-8") as f:
            f.write(new_line)
    else:
        # 按原逻辑：如果文件非空且末尾不是换行，需要先写一个换行
        if lines and not lines[-1].endswith("\n"):
            with open(file_path, "a", encoding="utf-8") as f:
                f.write("\n")
        # 追加新行
        with open(file_path, "a", encoding="utf-8") as f:
            f.write(new_line)
    
    # 输出原始内容（Alfred 可能需要）
    print(original_content)


if __name__ == "__main__":
    main()
