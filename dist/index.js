/**
 * chuanban-dsh-writingset - dist/index.js
 * 宿主插件 ESM 产物，免构建直接运行。
 *
 * Config 必须是真正的 @deepseek-ai/schemastery 节点，DSH 的 SettingsForms 才会识别并
 * 暴露 `writing-brick-injector` 设置命名空间。schemastery 的解析顺序：
 *   1. 常规 import（插件目录或 profile 能解析到时）；
 *   2. DSH 宿主进程 argv[2]（运行时根目录，如 app.asar/dsh）为锚点解析；
 *   3. 独立 Node 测试环境的轻量兼容 fallback（仅用于 tests/verify-bundle.mjs）。
 */

import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  WRITING_PRESET_BRICKS,
  BASE_TOOL_PROTOCOL,
  assembleWritingPrompt,
  resolveWorkspacePromptMode,
} from './presets.js';

export const name = 'writing-brick-injector';
export const inject = ['systemPrompt'];

function createSchemaBuilder() {
  class FluentSchema {
    constructor(meta = {}) {
      this.meta = meta;
    }
    default(value) {
      this.meta.default = value;
      return this;
    }
    description(desc) {
      this.meta.description = desc;
      return this;
    }
    volatile() {
      this.meta.volatile = true;
      return this;
    }
    toJSON() {
      return this.meta;
    }
  }

  return {
    object: (shape) => new FluentSchema({ type: 'object', shape }),
    union: (items) => new FluentSchema({ type: 'union', items }),
    string: () => new FluentSchema({ type: 'string' }),
    boolean: () => new FluentSchema({ type: 'boolean' }),
  };
}

function pickFactory(mod) {
  return mod?.default ?? mod?.Schema ?? mod;
}

async function loadSchemaFactory() {
  try {
    return pickFactory(await import('@deepseek-ai/schemastery'));
  } catch {
    // 继续尝试以 DSH 运行时根目录为锚点解析
  }
  // 0.2.1+ 宿主 argv[2] 是 host 入口文件、运行时根在 argv[3]，故逐个候选尝试
  for (const runtimeRoot of process.argv.slice(2)) {
    try {
      const anchor = join(runtimeRoot, 'package.json');
      const resolved = createRequire(anchor).resolve('@deepseek-ai/schemastery');
      return pickFactory(await import(pathToFileURL(resolved).href));
    } catch {
      // 落到下一个候选
    }
  }
  return createSchemaBuilder();
}

const SchemaFactory = await loadSchemaFactory();

export const Config = SchemaFactory.object({
  activePreset: SchemaFactory.union([
    'pro',
    'play',
    'rp',
    'pure',
    'pro-v1',
  ])
    .default('pro')
    .description('当前激活的写作人设积木：pro(职业写手v2) / play(纯粹娱乐) / rp(创作与RP) / pure(纯净底座) / pro-v1(v1锋利版留档)')
    .volatile(),

  includeBaseProtocol: SchemaFactory.boolean()
    .default(true)
    .description('是否拼接第一层文档与工具协作准则（去工程化底座）')
    .volatile(),

  customPromptOverride: SchemaFactory.string()
    .default('')
    .description('自定义工作区提示（workspacePromptMode=custom 时生效：append 追加在初始提示后 / replace 整段替换）')
    .volatile(),

  workspacePromptMode: SchemaFactory.union(['off', 'custom', 'workspace'])
    .default('off')
    .description('工作区提示三模式：off(仅初始积木) / custom(使用自定义填写) / workspace(会话组装时读取工作区 AGENTS.md、memory、rules 等标准文档)')
    .volatile(),

  customPromptBehavior: SchemaFactory.union(['append', 'replace'])
    .default('append')
    .description('custom 模式行为：append(追加在初始提示之后) / replace(整段替换初始提示)')
    .volatile(),
});

/**
 * 工作区基础设施文档扫描清单（按序拼接）：
 * AGENTS.md → CLAUDE.md（兼容别名，与 AGENTS.md 同内容时去重）→ memory.md → memory/*.md → rules.md → rules/*.md
 */
const WORKSPACE_DOC_PLAN = [
  ['AGENTS.md'],
  ['CLAUDE.md'],
  ['memory.md'],
  ['memory', '*.md'],
  ['rules.md'],
  ['rules', '*.md'],
];

/** 工作区文档总字节上限，超出截断并在段首注明 */
export const WORKSPACE_DOCS_MAX_BYTES = 64 * 1024;

/**
 * 读取并拼接工作区基础设施文档（宿主侧，render 期同步执行）。
 * 任一文件缺失静默跳过；全部缺失返回空串（workspace 模式静音降级为仅初始积木）。
 */
export function readWorkspaceDocs(cwd) {
  if (!cwd || typeof cwd !== 'string') return '';

  const parts = [];
  const seenContents = new Set();
  let total = 0;
  let truncated = false;

  const pushDoc = (label, content) => {
    const trimmed = content.trim();
    if (!trimmed || seenContents.has(trimmed)) return;
    const text = `## ${label}\n${trimmed}`;

    let bytes = Buffer.byteLength(text, 'utf8');
    if (total + bytes > WORKSPACE_DOCS_MAX_BYTES) {
      const remain = WORKSPACE_DOCS_MAX_BYTES - total;
      if (remain <= 0) {
        truncated = true;
        return;
      }
      let cut = text.length;
      while (cut > 0 && Buffer.byteLength(text.slice(0, cut), 'utf8') > remain) cut--;
      parts.push(text.slice(0, cut));
      truncated = true;
      return;
    }

    seenContents.add(trimmed);
    total += bytes;
    parts.push(text);
  };

  for (const entry of WORKSPACE_DOC_PLAN) {
    if (entry.length === 1) {
      try {
        pushDoc(entry[0], readFileSync(join(cwd, entry[0]), 'utf8'));
      } catch {
        // 文件不存在，跳过
      }
    } else {
      const dir = entry[0];
      try {
        const files = readdirSync(join(cwd, dir)).filter((f) => f.endsWith('.md')).sort();
        for (const f of files) {
          try {
            pushDoc(`${dir}/${f}`, readFileSync(join(cwd, dir, f), 'utf8'));
          } catch {
            // 单文件不可读，跳过
          }
        }
      } catch {
        // 目录不存在，跳过
      }
    }
  }

  if (parts.length === 0) return '';
  const note = truncated ? '（工作区文档合计超出 64KB 上限，已截断）\n' : '';
  return note + parts.join('\n\n');
}

export function apply(ctx, config = {}) {
  // 1. 注册动态系统提示词变量 {{writing_active_brick}}
  if (ctx.systemPrompt?.variable) {
    const registerVariable = () => {
      return ctx.systemPrompt.variable(
        'writing_active_brick',
        (context) => {
          // DSH agent-loop 注册 prompt 变量时以 context.agent 携带会话事实
          // （源码原句：variable("cwd", (context) => context.agent?.session.header.cwd)）
          const cwd = context?.agent?.session?.header?.cwd;
          const workspaceDocs
            = resolveWorkspacePromptMode(config) === 'workspace'
              ? readWorkspaceDocs(cwd)
              : '';
          return assembleWritingPrompt({ ...config, workspaceDocs });
        },
      );
    };

    if (typeof ctx.effect === 'function') {
      ctx.effect(registerVariable, 'writing-brick-injector.variable()');
    } else {
      registerVariable();
    }
  }

  // 2. 配置 Settings 交互策略：交由客户端卡片控制，不使用自动表单
  try {
    if (ctx.inject && typeof ctx.inject === 'function') {
      ctx.inject(['settings'], (child) => {
        child.settings?.configure?.({ auto: false }, ctx.fiber);
      });
    } else if (ctx.settings?.configure) {
      ctx.settings.configure({ auto: false }, ctx.fiber);
    }
  } catch {
    // settings 服务不可用时忽略
  }

  // 3. 监听热更新事件 loader/volatile-update，实时触发提示词重新计算
  if (typeof ctx.on === 'function') {
    ctx.on('loader/volatile-update', () => {
      ctx.emit?.('system-prompt/change');
    });
  }
}

export {
  WRITING_PRESET_BRICKS,
  BASE_TOOL_PROTOCOL,
  assembleWritingPrompt,
  resolveWorkspacePromptMode,
};
