/*
 * chuanban-dsh-writingset - 客户端源（浏览器侧）
 * 由 scripts/build-client.mjs 内联 dist/presets.js 的数据后包装成 DSH lazy-CJS 模块，输出 dist/client.js。
 * 本文件是 `factory: (require) => { ... }` 的函数体，可使用 require / module / exports。
 */
const react = require('react');
const h = react.createElement;

/*__PRESETS__*/

const NS = 'writing-brick-injector';
const PRESET_ORDER = ['pro', 'play', 'rp', 'pure', 'pro-v1'];
const OPTIONS = PRESET_ORDER.map((id) => WRITING_PRESET_BRICKS[id]);
const MODE_ORDER = ['off', 'custom', 'workspace'];
const MODES = {
  off: { id: 'off', name: '初始纯净', summary: '仅双层积木（职能 + 协作准则），不读取工作区任何文档' },
  custom: { id: 'custom', name: '自定义填写', summary: '在下方填写工作区提示，追加在初始提示后，或整段替换初始提示' },
  workspace: { id: 'workspace', name: '工作区识别', summary: '会话组装时自动读取工作区 AGENTS.md / CLAUDE.md / memory / rules 并追加' },
};

const S = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 760, color: 'var(--dsw-alias-label-primary)' },
  title: { margin: 0, fontSize: 18, fontWeight: 600 },
  hint: { margin: 0, fontSize: 13, lineHeight: '20px', color: 'var(--dsw-alias-label-tertiary)' },
  card: (active) => ({
    display: 'flex', flexDirection: 'column', gap: 2, textAlign: 'left', cursor: 'pointer', font: 'inherit',
    padding: '10px 14px', borderRadius: 12, color: 'inherit',
    border: '.5px solid ' + (active ? 'var(--dsw-alias-state-business-primary)' : 'var(--dsw-alias-border-l3)'),
    background: active ? 'var(--dsw-alias-interactive-bg-hover)' : 'var(--dsw-alias-settings-card-fill)',
  }),
  cardName: { fontSize: 14, fontWeight: 500 },
  cardSummary: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' },
  row: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 },
  textarea: {
    width: '100%', minHeight: 72, boxSizing: 'border-box', font: 'inherit', fontSize: 13, padding: 8, borderRadius: 8,
    border: '.5px solid var(--dsw-alias-border-l4)', background: 'var(--dsw-alias-bg-layer-1)', color: 'inherit',
  },
  pre: {
    margin: 0, padding: 10, borderRadius: 8, whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: '18px',
    background: 'var(--dsw-alias-bg-module-platform)', maxHeight: 240, overflow: 'auto',
  },
};

function WritingPanel(props) {
  const state = props.useWritingForm((snapshot) => snapshot);
  const value = state.value || {};
  const cfg = {
    activePreset: PRESET_ORDER.includes(value.activePreset) ? value.activePreset : 'pro',
    includeBaseProtocol: value.includeBaseProtocol !== false,
    customPromptOverride: typeof value.customPromptOverride === 'string' ? value.customPromptOverride : '',
    workspacePromptMode: MODE_ORDER.includes(value.workspacePromptMode) ? value.workspacePromptMode : 'off',
    customPromptBehavior: value.customPromptBehavior === 'replace' ? 'replace' : 'append',
  };
  const disabled = !state.writable || state.status !== 'ready';
  const [draft, setDraft] = react.useState(null);
  const text = draft === null ? cfg.customPromptOverride : draft;
  const modeName = { off: '初始纯净', custom: '自定义填写', workspace: '工作区识别' }[cfg.workspacePromptMode];

  if (props.view === 'summary') {
    return '写作协作模式的初始预设（当前：' + WRITING_PRESET_BRICKS[cfg.activePreset].name + ' · 工作区提示：' + modeName + '）';
  }

  const currentBase = () => assembleWritingPrompt({
    activePreset: cfg.activePreset,
    includeBaseProtocol: cfg.includeBaseProtocol,
    workspacePromptMode: 'off',
    customPromptOverride: '',
  });

  const preview = assembleWritingPrompt({
    ...cfg,
    customPromptOverride: text,
    workspaceDocs: cfg.workspacePromptMode === 'workspace'
      ? '（工作区文档由宿主在会话组装时按 AGENTS.md / CLAUDE.md / memory / rules 读取注入，此处以占位符预览）'
      : undefined,
  });

  return h('div', { style: S.wrap }, [
    h('h2', { key: 'h', style: S.title }, '写作协作配置'),
    h('p', { key: 'p', style: S.hint },
      '选择前台「写作协作模式」实际注入的写作职能积木。修改后即时生效，新开会话使用新的预设。'),
    disabled ? h('p', { key: 'd', style: S.hint }, '配置服务暂不可用（只读或未就绪）。') : null,
    h('div', { key: 'opts', style: { display: 'grid', gap: 8 } }, OPTIONS.map((opt) =>
      h('button', {
        key: opt.id, type: 'button', disabled, style: S.card(opt.id === cfg.activePreset),
        onClick: () => props.set('activePreset', opt.id),
      }, [
        h('span', { key: 'n', style: S.cardName }, opt.name + (opt.id === cfg.activePreset ? '  ✓' : '')),
        h('span', { key: 's', style: S.cardSummary }, opt.summary),
      ]))),
    h('label', { key: 'base', style: S.row }, [
      h('input', {
        key: 'i', type: 'checkbox', disabled, checked: cfg.includeBaseProtocol,
        onChange: (e) => props.set('includeBaseProtocol', e.target.checked),
      }),
      '附加「文档与工具协作准则」（去工程化底座）',
    ]),
    h('div', { key: 'ws' }, [
      h('p', { key: 'wt', style: Object.assign({}, S.hint, { fontWeight: 600 }) }, '工作区提示模式'),
      h('div', { key: 'wm', style: { display: 'grid', gap: 8 } }, MODE_ORDER.map((id) =>
        h('button', {
          key: id, type: 'button', disabled, style: S.card(id === cfg.workspacePromptMode),
          onClick: () => props.set('workspacePromptMode', id),
        }, [
          h('span', { key: 'n', style: S.cardName }, MODES[id].name + (id === cfg.workspacePromptMode ? '  ✓' : '')),
          h('span', { key: 's', style: S.cardSummary }, MODES[id].summary),
        ]))),
    ]),
    cfg.workspacePromptMode === 'custom' ? h('div', { key: 'custom' }, [
      h('p', { key: 'l', style: S.hint },
        '自定义工作区提示（追加在初始提示后，或切为替换；失焦时保存）'),
      h('div', { key: 'bar', style: S.row }, [
        h('button', {
          key: 'a', type: 'button', disabled, style: S.card(cfg.customPromptBehavior === 'append'),
          onClick: () => {
            if (draft !== null && draft !== cfg.customPromptOverride) props.set('customPromptOverride', draft);
            setDraft(null);
            props.set('customPromptBehavior', 'append');
          },
        }, h('span', { style: S.cardName }, '追加')),
        h('button', {
          key: 'r', type: 'button', disabled, style: S.card(cfg.customPromptBehavior === 'replace'),
          onClick: () => {
            if (draft !== null && draft !== cfg.customPromptOverride) props.set('customPromptOverride', draft);
            setDraft(null);
            props.set('customPromptBehavior', 'replace');
          },
        }, h('span', { style: S.cardName }, '替换初始提示')),
        h('button', {
          key: 'f', type: 'button', disabled,
          onClick: () => {
            const base = currentBase();
            props.set('customPromptBehavior', 'replace');
            props.set('customPromptOverride', base);
            setDraft(null);
          },
        }, h('span', { style: S.cardName }, '用当前初始提示填充编辑')),
      ]),
      h('textarea', {
        key: 't', style: S.textarea, disabled, value: text,
        onChange: (e) => setDraft(e.target.value),
        onBlur: () => {
          if (draft !== null && draft !== cfg.customPromptOverride) props.set('customPromptOverride', draft);
          setDraft(null);
        },
      }),
    ]) : null,
    h('div', { key: 'prev' }, [
      h('p', { key: 'l', style: S.hint }, '当前组合出的 System Prompt 预览'),
      h('pre', { key: 'p', style: S.pre }, preview),
    ]),
  ]);
}

const inject = ['slots', 'locale', 'configForms'];

function apply(ctx) {
  const form = ctx.configForms.get(NS);
  const injected = () => ({
    hooks: { writingForm: form },
    set: (field, v) => form.set(field, v),
  });

  ctx.effect(() => ctx.configForms.whileServed([NS], () => {
    const offs = [
      // 设置弹窗（Cmd+,）左侧一级菜单
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'writing-preset',
        order: 25,
        label: () => '写作协作配置',
        inject: injected,
      }, WritingPanel)),
      // 插件页卡片
      ctx.slots.inject('plugins.item', () => ctx.slots.register({
        name: 'plugins.item',
        id: 'writing-preset',
        order: 50,
        label: () => '写作协作配置',
        inject: injected,
      }, WritingPanel)),
    ];
    return () => { for (const off of offs) off(); };
  }), 'chuanban-dsh-writingset: settings page');
}

exports.apply = apply;
exports.inject = inject;
exports.PRESET_OPTIONS = OPTIONS;
