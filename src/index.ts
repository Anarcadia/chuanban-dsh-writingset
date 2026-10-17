/**
 * chuanban-dsh-writingset - 宿主插件
 *
 * 插件名称：writing-brick-injector
 * 职能：
 * 1. 声明后台可热更新（Volatile）的写作预设配置字段；
 * 2. 注册 ctx.systemPrompt.variable('writing_active_brick', (context) => assembleWritingPrompt(...))；
 *    workspace 模式下经 context.agent.session.header.cwd（DSH agent-loop 注册的同源事实）读取工作区文档；
 * 3. 监听 loader/volatile-update 事件，触发 system-prompt/change 实时重绘提示词。
 */

import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  WRITING_PRESET_BRICKS,
  BASE_TOOL_PROTOCOL,
  assembleWritingPrompt,
  resolveWorkspacePromptMode,
  type AssemblePromptOptions,
} from './presets.js';

export const name = 'writing-brick-injector';
export const inject = ['systemPrompt'];

/**
 * 轻量 Schema 构建器，自适应环境是否有 @deepseek-ai/schemastery
 */
function createSchemaBuilder() {
  class FluentSchema {
    meta: Record<string, any>;
    constructor(meta: Record<string, any> = {}) {
      this.meta = meta;
    }
    default(value: any) {
      this.meta.default = value;
      return this;
    }
    description(desc: string) {
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
    object: (shape: Record<string, any>) => new FluentSchema({ type: 'object', shape }),
    union: (items: any[]) => new FluentSchema({ type: 'union', items }),
    string: () => new FluentSchema({ type: 'string' }),
    boolean: () => new FluentSchema({ type: 'boolean' }),
  };
}

let SchemaFactory: any;
try {
  // @ts-ignore
  const schemastery = await import('@deepseek-ai/schemastery');
  SchemaFactory = schemastery.default || schemastery.Schema || schemastery;
} catch {
  SchemaFactory = undefined;
}
if (SchemaFactory === undefined) {
  // 0.2.1+ 宿主 argv[2] 是 host 入口文件、运行时根在 argv[3]，故逐个候选尝试
  for (const runtimeRoot of process.argv.slice(2)) {
    try {
      const anchor = join(runtimeRoot, 'package.json');
      const resolved = createRequire(anchor).resolve('@deepseek-ai/schemastery');
      const mod: any = await import(pathToFileURL(resolved).href);
      SchemaFactory = mod?.default ?? mod?.Schema ?? mod;
      break;
    } catch {
      // 落到下一个候选
    }
  }
}
if (SchemaFactory === undefined) SchemaFactory = createSchemaBuilder();

export interface WritingInjectorConfig {
  activePreset?: 'pro' | 'play' | 'rp' | 'pure' | 'pro-v1';
  includeBaseProtocol?: boolean;
  customPromptOverride?: string;
  workspacePromptMode?: 'off' | 'custom' | 'workspace';
  customPromptBehavior?: 'append' | 'replace';
}

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
const WORKSPACE_DOC_PLAN: Array<[string] | [string, '*.md']> = [
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
export function readWorkspaceDocs(cwd: string | undefined): string {
  if (!cwd || typeof cwd !== 'string') return '';

  const parts: string[] = [];
  const seenContents = new Set<string>();
  let total = 0;
  let truncated = false;

  const pushDoc = (label: string, content: string): void => {
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
      const [dir] = entry;
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

/**
 * Cordis 插件生命周期挂载
 */
export function apply(ctx: any, config: WritingInjectorConfig = {}) {
  // 1. 注册动态系统提示词变量 {{writing_active_brick}}
  if (ctx.systemPrompt?.variable) {
    const registerVariable = () => {
      return ctx.systemPrompt.variable(
        'writing_active_brick',
        (context: any) => {
          // DSH agent-loop 注册 prompt 变量时以 context.agent 携带会话事实
          // （源码原句：variable("cwd", (context) => context.agent?.session.header.cwd)）
          const cwd = context?.agent?.session?.header?.cwd as string | undefined;
          const workspaceDocs
            = resolveWorkspacePromptMode(config as AssemblePromptOptions) === 'workspace'
              ? readWorkspaceDocs(cwd)
              : '';
          return assembleWritingPrompt({ ...(config as AssemblePromptOptions), workspaceDocs });
        },
      );
    };

    if (typeof ctx.effect === 'function') {
      ctx.effect(registerVariable, 'writing-brick-injector.variable()');
    } else {
      registerVariable();
    }
  }

  // 2. 配置 Settings 交互策略（关闭自动表单，交由客户端卡片控制）
  if (ctx.inject && typeof ctx.inject === 'function') {
    ctx.inject(['settings'], (child: any) => {
      child.settings?.configure?.({ auto: false }, ctx.fiber);
    });
  } else if (ctx.settings?.configure) {
    ctx.settings.configure({ auto: false }, ctx.fiber);
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
