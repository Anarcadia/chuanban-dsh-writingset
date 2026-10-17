/**
 * tests/verify-bundle.mjs
 * 纯净写作协作模式插件（chuanban-dsh-writingset）全链路自检验证套件
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

console.log('='.repeat(70));
console.log('开始执行 chuanban-dsh-writingset 插件自检测试套件...');
console.log('='.repeat(70));

// ============================================================================
// 测试 1：校验核心文件存在性与导出入口
// ============================================================================
console.log('\n[Test 1] 校验核心工程文件与导出入口...');

const requiredFiles = [
  'package.json',
  'cordis.patch.yml',
  'src/presets.ts',
  'src/index.ts',
  'src/client/panel.js',
  'dist/presets.js',
  'dist/index.js',
  'dist/client.js',
  'scripts/switch-preset.mjs',
];

for (const relPath of requiredFiles) {
  const absPath = path.join(ROOT_DIR, relPath);
  assert.ok(fs.existsSync(absPath), `缺少必要文件: ${relPath}`);
}

// 检查 package.json 结构
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf-8'));
assert.equal(pkg.name, 'chuanban-dsh-writingset', 'package.json name 必须为 chuanban-dsh-writingset');
assert.match(pkg.version, /^\d+\.\d+\.\d+$/, 'package.json version 必须为合法 semver');
assert.equal(pkg.type, 'module');
assert.ok(pkg.exports['.'], 'package.json 缺少 . 导出');
assert.ok(pkg.exports['./presets'], 'package.json 缺少 ./presets 导出');
assert.ok(pkg.exports['./client'], 'package.json 缺少 ./client 导出');
assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml', 'dsh.bundle.patch 指向必须为 ./cordis.patch.yml');

// 动态导入 dist 模块
const presetsModule = await import('../dist/presets.js');
const hostModule = await import('../dist/index.js');

assert.ok(presetsModule.BASE_TOOL_PROTOCOL, 'presets.js 必须导出 BASE_TOOL_PROTOCOL');
assert.ok(presetsModule.WRITING_PRESET_BRICKS, 'presets.js 必须导出 WRITING_PRESET_BRICKS');
assert.equal(typeof presetsModule.assembleWritingPrompt, 'function', 'presets.js 必须导出 assembleWritingPrompt 函数');

assert.equal(hostModule.name, 'writing-brick-injector', 'hostModule.name 必须为 writing-brick-injector');
assert.deepEqual(hostModule.inject, ['systemPrompt'], 'hostModule.inject 必须包含 systemPrompt');
assert.equal(typeof hostModule.apply, 'function', 'hostModule.apply 必须为函数');

// 客户端为 DSH lazy-CJS 格式（window.__ModuleLoader__.load），在 vm 沙箱中加载并校验槽位注册
const clientSource = fs.readFileSync(path.join(ROOT_DIR, 'dist/client.js'), 'utf-8');
assert.ok(clientSource.includes('window.__ModuleLoader__.load('), 'client.js 必须使用 window.__ModuleLoader__.load');
let loaded;
const sandbox = {
  window: { __ModuleLoader__: { load: (m) => { loaded = m; } } },
  Symbol,
  Object,
};
sandbox.globalThis = sandbox;
(await import('node:vm')).runInNewContext(clientSource, sandbox);
assert.equal(loaded.id, 'chuanban-dsh-writingset', 'client 模块 id 必须为 chuanban-dsh-writingset');
const fakeReact = { createElement: (...a) => a, useState: (v) => [v, () => {}] };
const clientExports = loaded.factory((id) => {
  if (id === 'react') return fakeReact;
  throw new Error('unexpected require: ' + id);
});
assert.equal(typeof clientExports.apply, 'function', 'client.apply 必须为函数');
assert.ok(clientExports.inject.includes('configForms') && clientExports.inject.includes('slots'), 'client.inject 缺少必需服务');
assert.equal(clientExports.PRESET_OPTIONS.length, 5, 'client 必须暴露 5 个预设选项');

const registered = [];
const effects = [];
const mockClientCtx = {
  configForms: {
    get: () => ({ set: () => Promise.resolve(true) }),
    whileServed: (nss, register) => { assert.equal(JSON.stringify(nss), '["writing-brick-injector"]'); return register(new Set(nss)); },
  },
  slots: {
    inject: (name, fn) => fn(),
    register: (opts) => { registered.push(opts); return () => {}; },
  },
  effect: (fn) => effects.push(fn()),
};
clientExports.apply(mockClientCtx);
const sectionEntry = registered.find((o) => o.name === 'settings.section');
assert.ok(sectionEntry, '必须向 settings.section 注册');
assert.equal(sectionEntry.id, 'writing-preset');
assert.equal(sectionEntry.order, 25);
assert.equal(sectionEntry.label(), '写作协作配置');
assert.ok(registered.find((o) => o.name === 'plugins.item'), '必须向 plugins.item 注册');


console.log('✓ [Test 1 通过] 所有关键文件与 ESM 模块导出接口验证完毕。');

// ============================================================================
// 测试 2：模拟 DSH SystemPrompt 变量插值与五大预设组合测试
// ============================================================================
console.log('\n[Test 2] 模拟 DSH SystemPrompt 模板变量插值与五大预设验证...');

class MockSystemPromptService {
  constructor() {
    this.variables = new Map();
  }

  variable(name, getter) {
    assert.ok(/^[a-z][a-z0-9_]*$/.test(name), `变量名 ${name} 不符合 DSH 小写下划线命名规范`);
    this.variables.set(name, getter);
  }

  // 模拟 DSH 的严格模板插值逻辑
  render(template) {
    return template.replace(/\{\{([a-z][a-z0-9_]*)\}\}/g, (_, varName) => {
      const getter = this.variables.get(varName);
      if (!getter) return '';
      const val = getter();
      return typeof val === 'string' ? val : '';
    });
  }
}

// 模拟 Cordis Context
/** 宿主同款工具定义契约校验：DSH tools.register 在新建会话时执行的 TypeError 条件 + render 冒烟。 */
function assertHostToolContract(registered) {
  for (const tool of registered) {
    const o = tool.output;
    assert.ok(o !== undefined && o !== null && typeof o === 'object', `tool "${tool.name}" 必须声明 output 对象（宿主 register 校验）`);
    assert.equal(typeof o.render, 'function', `tool "${tool.name}" output.render 必须为函数`);
    assert.ok(o.presentationMeta === undefined || typeof o.presentationMeta === 'function', `tool "${tool.name}" presentationMeta 必须为函数`);
    assert.ok(o.schema && typeof o.schema === 'object' && o.schema.type === 'object', `tool "${tool.name}" output.schema 必须为 object JSON Schema`);
    const fake = {};
    for (const [k, spec] of Object.entries(o.schema.properties ?? {})) {
      fake[k] = spec.type === 'integer' || spec.type === 'number' ? 1 : spec.type === 'boolean' ? true : 'x';
    }
    const blocks = o.render({}, fake);
    assert.ok(Array.isArray(blocks) && blocks.length >= 1 && blocks[0].type === 'text' && typeof blocks[0].text === 'string', `tool "${tool.name}" render 必须返回 [{type:'text'}]`);
  }
}

function createMockContext() {
  const events = new Map();
  const sp = new MockSystemPromptService();
  return {
    systemPrompt: sp,
    on(event, handler) {
      if (!events.has(event)) events.set(event, []);
      events.get(event).push(handler);
    },
    emit(event, ...args) {
      const handlers = events.get(event) || [];
      for (const h of handlers) h(...args);
    },
    effect(fn) {
      return fn();
    },
  };
}

// 1. 验证默认配置（pro - v2 无我沉浸版）
{
  const ctx = createMockContext();
  hostModule.apply(ctx, { activePreset: 'pro', includeBaseProtocol: true });
  const rendered = ctx.systemPrompt.render('{{writing_active_brick}}');

  assert.match(rendered, /【当前职能：职业写手】/, 'pro 模式必须包含职业写手标题');
  assert.match(rendered, /以“忘我”为最高职业操守/, 'pro 模式必须是 v2 无我沉浸版');
  assert.match(rendered, /【文档与工具协作准则】/, 'pro 模式必须拼接底座准则');
  assert.match(rendered, /无痕编辑，拒绝汇报/, '底座准则必须包含无痕编辑');
  assert.ok(rendered.includes('`glob`') && rendered.includes('`grep`'), '底座准则应说明 glob/grep 只读查找（fs-search 已挂载）');
}

// 2. 验证 play 预设（纯粹娱乐）
{
  const ctx = createMockContext();
  hostModule.apply(ctx, { activePreset: 'play', includeBaseProtocol: true });
  const rendered = ctx.systemPrompt.render('{{writing_active_brick}}');

  assert.match(rendered, /【当前职能：纯粹娱乐与灵感共谋】/);
  assert.match(rendered, /天马行空时的共谋者/);
  assert.match(rendered, /【文档与工具协作准则】/);
}

// 3. 验证 rp 预设（创作与 RP 扮演）
{
  const ctx = createMockContext();
  hostModule.apply(ctx, { activePreset: 'rp', includeBaseProtocol: true });
  const rendered = ctx.systemPrompt.render('{{writing_active_brick}}');

  assert.match(rendered, /【当前职能：全浸入式叙事与 RP 演绎】/);
  assert.match(rendered, /严守“第四面墙”/);
  assert.match(rendered, /Show, don't tell/);
  assert.match(rendered, /【文档与工具协作准则】/);
}

// 4. 验证 pure 预设（纯净通用写作底座 · 无角色偏见白板）
{
  const ctx = createMockContext();
  hostModule.apply(ctx, { activePreset: 'pure', includeBaseProtocol: true });
  const rendered = ctx.systemPrompt.render('{{writing_active_brick}}');

  assert.ok(!rendered.includes('【当前职能'), 'pure 预设严禁包含任何职能人设');
  assert.match(rendered, /【文档与工具协作准则】/, 'pure 预设必须包含公共底座准则');
}

// 5. 验证 pro-v1 预设（留档备选：第一性原理锋利版）
{
  const ctx = createMockContext();
  hostModule.apply(ctx, { activePreset: 'pro-v1', includeBaseProtocol: true });
  const rendered = ctx.systemPrompt.render('{{writing_active_brick}}');

  assert.match(rendered, /【当前职能：第一性原理职业写手】/);
  assert.match(rendered, /彻底服从创作第一性原理/);
  assert.match(rendered, /【文档与工具协作准则】/);
}

// 6. 验证 Cordis Volatile 响应式对象模拟（.get() 解包）与热更新
{
  const ctx = createMockContext();
  let dynamicPreset = 'pro';
  const volatileConfig = {
    activePreset: {
      get() {
        return dynamicPreset;
      },
    },
    includeBaseProtocol: true,
  };

  hostModule.apply(ctx, volatileConfig);

  // 初始应为 pro
  let rendered = ctx.systemPrompt.render('{{writing_active_brick}}');
  assert.match(rendered, /以“忘我”为最高职业操守/);

  // 动态修改 Volatile 配置并模拟触发 volatile-update
  let promptChangeFired = false;
  ctx.on('system-prompt/change', () => {
    promptChangeFired = true;
  });

  dynamicPreset = 'play';
  ctx.emit('loader/volatile-update');

  assert.ok(promptChangeFired, '监听到 volatile-update 时必须触发 system-prompt/change 事件');
  rendered = ctx.systemPrompt.render('{{writing_active_brick}}');
  assert.match(rendered, /【当前职能：纯粹娱乐与灵感共谋】/, '响应式读取必须自动返回更新后的预设');
}

// 7. 验证 custom 模式（append）与 includeBaseProtocol=false
{
  const customText = '【特别规定】严格遵守三幕剧结构，在第二幕中段设置重大危机。';
  const result = presetsModule.assembleWritingPrompt({
    activePreset: 'pure',
    includeBaseProtocol: false,
    customPromptOverride: customText,
    workspacePromptMode: 'custom',
    customPromptBehavior: 'append',
  });
  assert.equal(result, customText, 'custom(append) 下 pure 且关闭底座时，结果应精准为自定义文本');
}

console.log('✓ [Test 2 通过] SystemPrompt 模板插值、5 种预设切换、Volatile 响应式与自定义覆盖验证通过。');

// ============================================================================
// 测试 3：校验 cordis.patch.yml 声明式补丁合规性
// ============================================================================
console.log('\n[Test 3] 校验 cordis.patch.yml 纯净沙箱与隔离配置...');

const patchYaml = fs.readFileSync(path.join(ROOT_DIR, 'cordis.patch.yml'), 'utf-8');
// 注释行不参与无效配置键扫描（文件头说明会提及这些键名）
const patchYamlEffective = patchYaml
  .split('\n')
  .filter((line) => !line.trim().startsWith('#'))
  .join('\n');

assert.match(patchYaml, /id:\s*agent-preset-registry/, '补丁必须包含 agent-preset-registry 配置');
assert.match(patchYaml, /default:\s*writing/, '默认预设必须设置为 writing');
assert.match(patchYaml, /id:\s*writing-brick-injector/, '必须包含 writing-brick-injector 注入器');
assert.match(patchYaml, /id:\s*preset-writing\b/, '必须包含 preset-writing 主预设');
assert.match(patchYaml, /prefix:\s*['"]\{\{writing_active_brick\}\}['"]/, '主预设必须使用 {{writing_active_brick}} 变量插值');
assert.match(patchYaml, /complete:\s*true/, '预设必须开启 complete: true 以彻底清除原生编程提示词');
assert.match(patchYaml, /includeRuntimeContext:\s*false/, '预设必须开启 includeRuntimeContext: false 以静音沙箱与审批上下文');
assert.match(
  patchYaml,
  /isolate:\s*[\r\n]+\s*fs:\s*true[\r\n]+\s*attachments:\s*true/,
  '文件工具组必须 isolate fs + attachments：剥离沙箱参数，且切断根作用域 attachment-local 使 read_image 不注册',
);
// DSH 0.2.0-rc.2 的 @deepseek-ai/dsh-tool-fs Config 仅接受 readLimit 等数值参数，
// 不存在 per-tool 布尔开关；以下断言防止无效配置键回归。
assert.doesNotMatch(patchYamlEffective, /readImage/, 'tool-fs 无 readImage 开关，不得写入无效配置键');
assert.doesNotMatch(patchYamlEffective, /\bread:\s*true\b/, 'tool-fs 无 read 布尔开关，不得写入无效配置键');
assert.doesNotMatch(patchYamlEffective, /\bwrite:\s*true\b/, 'tool-fs 无 write 布尔开关，不得写入无效配置键');
assert.doesNotMatch(patchYamlEffective, /\bedit:\s*true\b/, 'tool-fs 无 edit 布尔开关，不得写入无效配置键');
// 预设已挂载 tool-fs-search（glob/grep 只读查找），协作准则同步引用，且组内声明必须存在
assert.ok(patchYaml.includes("'@deepseek-ai/dsh-tool-fs-search'"), 'pure-fs 组必须挂载 dsh-tool-fs-search（目录列举/内容检索）');
const fsSearchCount = (patchYaml.match(/dsh-tool-fs-search/g) || []).length;
assert.ok(fsSearchCount >= 5, `五个预设的 pure-fs 组均须挂载 fs-search（实际 ${fsSearchCount} 处）`);
assert.match(patchYamlEffective, /`glob`/, '协作准则应说明 glob 查找（fs-search 已挂载）');

// 校验 4 个直选预设行已声明且默认 disabled: true
const directPresets = ['preset-writing-pro', 'preset-writing-play', 'preset-writing-rp', 'preset-writing-pure'];
for (const pId of directPresets) {
  assert.ok(patchYaml.includes(`id: ${pId}`), `cordis.patch.yml 必须包含直选预设行 ${pId}`);
}
const disabledCount = (patchYaml.match(/disabled:\s*true/g) || []).length;
assert.ok(disabledCount >= 4, '4 个直选预设行必须默认标记 disabled: true');

console.log('✓ [Test 3 通过] cordis.patch.yml 声明式架构、净化隔离参数与直选预设行完整合规。');

// ============================================================================
// 测试 4：CLI 切换工具集成测试
// ============================================================================
console.log('\n[Test 4] 测试 scripts/switch-preset.mjs 命令行工具切换与 YAML 同步...');

// 1. 运行 --list 命令
const listOutput = execSync(`node ${path.join(ROOT_DIR, 'scripts/switch-preset.mjs')} --list`, { encoding: 'utf-8' });
assert.match(listOutput, /职业写手（v2 无我沉浸版 · 默认）/);
assert.match(listOutput, /纯粹娱乐/);
assert.match(listOutput, /创作与 RP 扮演/);

// 2. 切换为 play
execSync(`node ${path.join(ROOT_DIR, 'scripts/switch-preset.mjs')} play`, { encoding: 'utf-8' });
const patchAfterPlay = fs.readFileSync(path.join(ROOT_DIR, 'cordis.patch.yml'), 'utf-8');
assert.match(patchAfterPlay, /activePreset:\s*play/, '切换后 cordis.patch.yml 的 activePreset 必须更新为 play');

// 3. 运行 --show 验证预览输出
const showOutput = execSync(`node ${path.join(ROOT_DIR, 'scripts/switch-preset.mjs')} --show`, { encoding: 'utf-8' });
assert.match(showOutput, /【当前职能：纯粹娱乐与灵感共谋】/);

// 4. 切回默认的 pro
execSync(`node ${path.join(ROOT_DIR, 'scripts/switch-preset.mjs')} pro`, { encoding: 'utf-8' });
const patchAfterPro = fs.readFileSync(path.join(ROOT_DIR, 'cordis.patch.yml'), 'utf-8');
assert.match(patchAfterPro, /activePreset:\s*pro/, '切回后 cordis.patch.yml 的 activePreset 必须恢复为 pro');

console.log('✓ [Test 4 通过] CLI 切换工具无损更新 cordis.patch.yml 测试完成。');

// ============================================================================
// 测试 5：工作区提示三模式矩阵（off / custom / workspace）与工作区文档读取
// ============================================================================
console.log('\n[Test 5] 工作区提示三模式矩阵与 readWorkspaceDocs 真实文件系统验证...');

// 5.1 off 模式：customPromptOverride 不生效（保持初始纯净）
{
  const out = presetsModule.assembleWritingPrompt({
    activePreset: 'pro', includeBaseProtocol: true,
    customPromptOverride: '【不应出现的文本】', workspacePromptMode: 'off',
  });
  assert.ok(!out.includes('【不应出现的文本】'), 'off 模式下自定义文本不得混入');
}

// 5.2 custom 模式：append 追加在后 / replace 整段替换
{
  const base = presetsModule.assembleWritingPrompt({ activePreset: 'pro', includeBaseProtocol: true });
  const appended = presetsModule.assembleWritingPrompt({
    activePreset: 'pro', includeBaseProtocol: true,
    customPromptOverride: '【特别规定】三幕剧', workspacePromptMode: 'custom', customPromptBehavior: 'append',
  });
  assert.ok(appended.startsWith(base), 'append 模式初始提示必须在前');
  assert.ok(appended.endsWith('【特别规定】三幕剧'), 'append 模式自定义文本必须追加在后');
  const replaced = presetsModule.assembleWritingPrompt({
    activePreset: 'pro', includeBaseProtocol: true,
    customPromptOverride: '【整段替换】只有我', workspacePromptMode: 'custom', customPromptBehavior: 'replace',
  });
  assert.equal(replaced, '【整段替换】只有我', 'replace 模式必须整段替换初始提示');
}

// 5.3 workspace 模式：注入【工作区上下文规则】段；空文档静音降级
{
  const out = presetsModule.assembleWritingPrompt({
    activePreset: 'pure', includeBaseProtocol: true,
    workspacePromptMode: 'workspace', workspaceDocs: '## AGENTS.md\n本工作区规则A',
  });
  assert.match(out, /【工作区上下文规则】/, 'workspace 模式必须包含段头');
  assert.match(out, /本工作区规则A/, 'workspace 模式必须包含工作区文档内容');
  const degraded = presetsModule.assembleWritingPrompt({
    activePreset: 'pro', includeBaseProtocol: true, workspacePromptMode: 'workspace', workspaceDocs: '',
  });
  assert.ok(!degraded.includes('【工作区上下文规则】'), '空工作区文档必须静音降级为仅初始积木');
}

// 5.4 readWorkspaceDocs 真实文件系统：顺序、去重、空目录降级、64KB 截断
{
  assert.equal(typeof hostModule.readWorkspaceDocs, 'function', '宿主模块必须导出 readWorkspaceDocs');
  assert.equal(hostModule.resolveWorkspacePromptMode({ workspacePromptMode: 'workspace' }), 'workspace', 'resolveWorkspacePromptMode 解包正常');

  const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-ws-'));
  fs.writeFileSync(path.join(wsDir, 'AGENTS.md'), '# agents\n协作规则', 'utf8');
  fs.writeFileSync(path.join(wsDir, 'CLAUDE.md'), '# agents\n协作规则', 'utf8'); // 与 AGENTS.md 同内容，应去重
  fs.mkdirSync(path.join(wsDir, 'memory'));
  fs.writeFileSync(path.join(wsDir, 'memory', 'b.md'), '记忆B', 'utf8');

  const docs = hostModule.readWorkspaceDocs(wsDir);
  assert.match(docs, /## AGENTS\.md/, '必须包含 AGENTS.md 段');
  assert.ok(!docs.includes('## CLAUDE.md'), '与 AGENTS.md 同内容的 CLAUDE.md 必须去重');
  assert.match(docs, /## memory\/b\.md/, '必须包含 memory 目录文档');

  // 空目录 → 空串（静音降级）
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-ws-empty-'));
  assert.equal(hostModule.readWorkspaceDocs(emptyDir), '', '无文档目录必须返回空串');
  assert.equal(hostModule.readWorkspaceDocs(undefined), '', '无 cwd 必须返回空串');

  // 超限截断：追加 70KB rules.md，总量超 64KB 上限
  fs.writeFileSync(path.join(wsDir, 'rules.md'), 'x'.repeat(70 * 1024), 'utf8');
  const big = hostModule.readWorkspaceDocs(wsDir);
  assert.ok(big.includes('已截断'), '超限必须注明截断');
  assert.ok(Buffer.byteLength(big, 'utf8') <= hostModule.WORKSPACE_DOCS_MAX_BYTES + 100, '截断后总字节不得超上限（含说明）');

  // 5.5 变量 provider 接收 AssembleContext：有 cwd 注入工作区段，无 cwd 降级
  const ctxWs = createMockContext();
  hostModule.apply(ctxWs, { activePreset: 'pro', includeBaseProtocol: true, workspacePromptMode: 'workspace' });
  const provider = ctxWs.systemPrompt.variables.get('writing_active_brick');
  assert.equal(typeof provider, 'function', '变量 provider 必须已注册');
  const withCwd = provider({ agent: { session: { header: { cwd: wsDir } } } });
  assert.match(withCwd, /【工作区上下文规则】/, '有 cwd 时必须注入工作区段');
  assert.match(withCwd, /协作规则/, '有 cwd 时必须含 AGENTS.md 内容');
  const noCwd = provider({});
  assert.ok(!noCwd.includes('【工作区上下文规则】'), '无 cwd 时必须静音降级');
  assert.match(noCwd, /【当前职能：职业写手】/, '降级后初始积木保持完好');

  fs.rmSync(wsDir, { recursive: true, force: true });
  fs.rmSync(emptyDir, { recursive: true, force: true });
}

console.log('✓ [Test 5 通过] 三模式矩阵（off/custom-append/custom-replace/workspace）、静音降级、64KB 截断与 provider 上下文注入验证完成。');

// ═══════════════════════════════════════════════════════════════
// [Test 6] file-butler 文件管理积木：注册、真实文件系统功能与 yml 挂载
// ═══════════════════════════════════════════════════════════════
{
  const butler = await import('../dist/file-butler.js');
  assert.equal(butler.name, 'file-butler', 'file-butler.name 必须为 file-butler');
  assert.deepEqual(butler.inject, ['tools', 'fs'], 'file-butler.inject 必须为 [tools, fs]');

  const registered = [];
  const butlerCtx = {
    tools: { register: (tool) => registered.push(tool) },
    fs: {
      resolve: async (p) => {
        const abs = path.resolve(String(p));
        return { displayPath: abs, targetKey: abs };
      },
      processPath: (t) => t.targetKey,
    },
  };
  butler.apply(butlerCtx);
  const names = registered.map((t) => t.name);
  assert.deepEqual(names.sort(), ['copy_file', 'move_file', 'stat_file', 'trash_file'], `必须注册四工具（实际 ${names}）`);
  const byName = Object.fromEntries(registered.map((t) => [t.name, t]));
  assertHostToolContract(registered);

  // 真实文件系统功能实测（隔离 tmp 目录）
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-butler-test-'));
  const content = '# 测试稿\n中文内容 🖋️ 与 "引号"\n';
  fs.writeFileSync(path.join(dir, 'a.md'), content, 'utf8');
  const exec = (tool, args) => tool.execute(args, { signal: undefined });

  // copy：自动建父目录 + 内容逐字保真
  const copyRes = await exec(byName.copy_file, { file_path: path.join(dir, 'a.md'), destination: path.join(dir, 'sub', 'b.md') });
  assert.equal(fs.readFileSync(path.join(dir, 'sub', 'b.md'), 'utf8'), content, 'copy_file 内容必须逐字一致');
  assert.equal(copyRes.bytes, Buffer.byteLength(content), 'copy_file 必须返回字节数');

  // copy overwrite:false 拒绝覆盖已存在目标
  await assert.rejects(
    () => exec(byName.copy_file, { file_path: path.join(dir, 'a.md'), destination: path.join(dir, 'sub', 'b.md'), overwrite: false }),
    /exist/i, 'overwrite:false 时目标已存在必须报错',
  );

  // move：源消失、目标出现
  await exec(byName.move_file, { file_path: path.join(dir, 'sub', 'b.md'), destination: path.join(dir, 'c.md') });
  assert.ok(!fs.existsSync(path.join(dir, 'sub', 'b.md')), 'move 后源必须消失');
  assert.equal(fs.readFileSync(path.join(dir, 'c.md'), 'utf8'), content, 'move 后内容必须保真');

  // stat：元数据字段
  const statRes = await exec(byName.stat_file, { file_path: path.join(dir, 'c.md') });
  assert.equal(statRes.size_bytes, Buffer.byteLength(content), 'stat size_bytes 必须正确');
  assert.ok(statRes.created && statRes.modified, 'stat 必须返回时间字段');

  // trash：文件进 ~/.Trash 且可恢复（留一个小文件在回收站，手动清理即可）
  const trashRes = await exec(byName.trash_file, { file_path: path.join(dir, 'c.md') });
  assert.ok(!fs.existsSync(path.join(dir, 'c.md')), 'trash 后原路径必须清空');
  assert.ok(fs.existsSync(trashRes.trash_path), 'trash 后回收站路径必须存在（可恢复）');

  // 底座准则同步引用四工具
  {
    const ctx = createMockContext();
    hostModule.apply(ctx, { activePreset: 'pro', includeBaseProtocol: true });
    const rendered = ctx.systemPrompt.render('{{writing_active_brick}}');
    for (const t of ['copy_file', 'move_file', 'trash_file']) {
      assert.ok(rendered.includes(t), `底座准则必须说明 ${t}（file-butler 已挂载）`);
    }
  }

  // yml：五个 pure-fs 组均挂载 file-butler 行
  const patchText = fs.readFileSync(path.join(__dirname, '../cordis.patch.yml'), 'utf8');
  const butlerMounts = (patchText.match(/chuanban-dsh-writingset\/file-butler/g) || []).length;
  assert.ok(butlerMounts >= 5, `五个预设的 pure-fs 组均须挂载 file-butler（实际 ${butlerMounts} 处）`);
  // 内联准则块缩进防回归：字面量块内的准则行必须保持块内缩进，顶格行会终止 YAML 块
  assert.ok(!/^(?:\d)\. [^\n]/m.test(fs.readFileSync(path.join(__dirname, '../cordis.patch.yml'), 'utf8')), 'cordis.patch.yml 字面量块内不得出现顶格准则行（YAML 块提前终止）');

  fs.rmSync(dir, { recursive: true, force: true });
}
console.log('✓ [Test 6 通过] file-butler 四工具注册、真实文件系统往返（复制/防覆盖/移动/元数据/回收站可恢复）与 yml 挂载验证完成。');

// ═══════════════════════════════════════════════════════════════
// [Test 7] doc-bridge Word↔md 单向文档桥：注册、真实往返、第三方校验与挂载
// ═══════════════════════════════════════════════════════════════
{
  const bridge = await import('../dist/doc-bridge.js');
  assert.equal(bridge.name, 'doc-bridge', 'doc-bridge.name 必须为 doc-bridge');
  assert.deepEqual(bridge.inject, ['tools', 'fs'], 'doc-bridge.inject 必须为 [tools, fs]');

  const registered = [];
  const bridgeCtx = {
    tools: { register: (tool) => registered.push(tool) },
    fs: {
      resolve: async (p) => {
        const abs = path.resolve(String(p));
        return { displayPath: abs, targetKey: abs };
      },
      processPath: (t) => t.targetKey,
    },
  };
  bridge.apply(bridgeCtx);
  assert.deepEqual(registered.map((x) => x.name).sort(), ['convert_document', 'export_document'], '必须注册 convert_document 与 export_document');
  const byName = Object.fromEntries(registered.map((x) => [x.name, x]));
  assertHostToolContract(registered);
  const exec = (tool, args) => tool.execute(args, { signal: undefined });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-bridge-test-'));
  const md = '# 第一章 初雪\n\n雪落下来的时候，她正在写信。\n\n- 检查炉火\n- 喂猫\n- **重要**：锁好后门\n\n## 1.1 转折\n\n"你回来了。"她说。\n\n含转义：a < b & c > d。\n';
  const mdPath = path.join(dir, 'story.md');
  fs.writeFileSync(mdPath, md, 'utf8');

  // export：md → 新建 docx
  const exp = await exec(byName.export_document, { file_path: mdPath });
  const docxPath = path.join(dir, 'story.docx');
  assert.ok(fs.existsSync(docxPath), 'export 后 docx 必须存在');
  assert.equal(exp.destination, docxPath, 'export 默认目标应为同名 .docx');

  // 第三方独立校验：macOS textutil 必须能读出标题/列表/转义文本
  const text = execSync(`textutil -convert txt -stdout "${docxPath}"`, { encoding: 'utf8' });
  for (const s of ['第一章 初雪', '• 喂猫', 'a < b & c > d', '1.1 转折']) {
    assert.ok(text.includes(s), `textutil 必须从导出的 docx 读出「${s}」`);
  }

  // convert：docx → md，往返结构等价
  const conv = await exec(byName.convert_document, { file_path: docxPath });
  const backPath = path.join(dir, 'story.md');
  assert.equal(conv.destination, backPath, 'convert 默认目标应为同名 .md（覆盖原 md）');
  const back = fs.readFileSync(backPath, 'utf8');
  const keep = (s) => s.split('\n').filter((l) => l.trim());
  assert.deepEqual(keep(back), keep(md.replace(/\*\*/g, '')), 'md→docx→md 往返后行集合必须等价');
  assert.ok(conv.preview.includes('第一章'), 'convert 必须返回预览');

  // 底座准则引用两工具
  {
    const ctx = createMockContext();
    hostModule.apply(ctx, { activePreset: 'pro', includeBaseProtocol: true });
    const rendered = ctx.systemPrompt.render('{{writing_active_brick}}');
    for (const toolName of ['convert_document', 'export_document']) {
      assert.ok(rendered.includes(toolName), `底座准则必须说明 ${toolName}`);
    }
  }

  // yml：五个 pure-fs 组均挂载 doc-bridge 行
  const patchText = fs.readFileSync(path.join(__dirname, '../cordis.patch.yml'), 'utf8');
  const mounts = (patchText.match(/chuanban-dsh-writingset\/doc-bridge/g) || []).length;
  assert.ok(mounts >= 5, `五个预设的 pure-fs 组均须挂载 doc-bridge（实际 ${mounts} 处）`);

  fs.rmSync(dir, { recursive: true, force: true });
}
console.log('✓ [Test 7 通过] doc-bridge 双工具注册、md→docx（textutil 第三方校验）→md 往返等价、准则引用与 yml 挂载验证完成。');

console.log('\n' + '='.repeat(70));
console.log('🎉 所有自检测试项全部通过 (All tests passed successfully)!');
console.log('='.repeat(70));
