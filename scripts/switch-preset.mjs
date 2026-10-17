#!/usr/bin/env node
/**
 * scripts/switch-preset.mjs
 * 纯净写作协作模式 - 后台预设一键切换与预览 CLI 工具
 *
 * 用法：
 *   node scripts/switch-preset.mjs --list
 *   node scripts/switch-preset.mjs --show [presetId]
 *   node scripts/switch-preset.mjs <pro|play|rp|pure|pro-v1>
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WRITING_PRESET_BRICKS, assembleWritingPrompt } from '../dist/presets.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PATCH_PATH = path.resolve(__dirname, '../cordis.patch.yml');

function readCurrentPreset() {
  if (!fs.existsSync(PATCH_PATH)) {
    return 'pro';
  }
  const content = fs.readFileSync(PATCH_PATH, 'utf-8');
  const match = content.match(/activePreset:\s*([a-zA-Z0-9_-]+)/);
  return match ? match[1] : 'pro';
}

function updatePatchPreset(nextPreset) {
  if (!fs.existsSync(PATCH_PATH)) {
    throw new Error(`找不到补丁文件: ${PATCH_PATH}`);
  }
  const content = fs.readFileSync(PATCH_PATH, 'utf-8');
  if (!/activePreset:\s*([a-zA-Z0-9_-]+)/.test(content)) {
    throw new Error('在 cordis.patch.yml 中未找到 activePreset 配置行');
  }
  const updated = content.replace(/(activePreset:\s*)([a-zA-Z0-9_-]+)/, `$1${nextPreset}`);
  fs.writeFileSync(PATCH_PATH, updated, 'utf-8');
}

function showHelp() {
  console.log(`
DeepSeek Harness (DSH) 纯净写作协作预设切换工具

用法:
  node scripts/switch-preset.mjs --list          列出所有可用预设积木及当前激活项
  node scripts/switch-preset.mjs --show [id]     打印指定预设（默认当前激活项）的组装后 System Prompt
  node scripts/switch-preset.mjs <presetId>      切换后台注入项并更新 cordis.patch.yml

可用预设 ID:
  pro      职业写手（v2 无我沉浸版 · 默认）
  play     纯粹娱乐（随性脑洞与灵感共谋）
  rp       创作与 RP 扮演（全浸入式叙事与第四面墙）
  pure     纯净通用写作底座（零预设人设白板）
  pro-v1   职业写手 v1（第一性原理锋利版 · 留档备选）
`);
}

function run() {
  const args = process.argv.slice(2);
  const current = readCurrentPreset();

  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    showHelp();
    return;
  }

  const firstArg = args[0];

  if (firstArg === '--list' || firstArg === '-l') {
    console.log(`\n【可用预设积木列表】（当前 cordis.patch.yml 激活项: [${current}]）`);
    console.log('='.repeat(70));
    for (const [id, item] of Object.entries(WRITING_PRESET_BRICKS)) {
      const activeMark = id === current ? '  ★ [当前激活]' : '';
      console.log(`- ID: ${id.padEnd(8)} | 名称: ${item.name}${activeMark}`);
      console.log(`  概述: ${item.summary}`);
      console.log('-'.repeat(70));
    }
    return;
  }

  if (firstArg === '--show') {
    const targetId = args[1] || current;
    if (!WRITING_PRESET_BRICKS[targetId]) {
      console.error(`错误：未知预设 ID "${targetId}"。可用选项: ${Object.keys(WRITING_PRESET_BRICKS).join(', ')}`);
      process.exit(1);
    }
    console.log(`\n【预设 [${targetId}] 组装 System Prompt 预览】`);
    console.log('='.repeat(70));
    console.log(assembleWritingPrompt({ activePreset: targetId }));
    console.log('='.repeat(70));
    return;
  }

  // 否则当作要切换的预设 ID
  const targetId = firstArg;
  if (!WRITING_PRESET_BRICKS[targetId]) {
    console.error(`错误：未知预设 ID "${targetId}"。可用选项: ${Object.keys(WRITING_PRESET_BRICKS).join(', ')}`);
    process.exit(1);
  }

  updatePatchPreset(targetId);
  console.log(`\n[OK] 成功更新 cordis.patch.yml 中的后台预设项为: [${targetId}] (${WRITING_PRESET_BRICKS[targetId].name})`);
  console.log('='.repeat(70));
  console.log('【切换后注入的完整 System Prompt 预览】：\n');
  console.log(assembleWritingPrompt({ activePreset: targetId }));
  console.log('='.repeat(70));
}

run();
