# chuanban-dsh-writingset

> **DeepSeek Harness (DSH) 纯净写作协作预设插件**  
> *Minimal writing-collaboration preset for DeepSeek Harness — zero coding noise, `read / write / edit` only, and modular role prompts.*

**极简介绍**：船板自用 DSH 写作工作台，砍掉 DSH 所有系统提示（接近极简模式），同时比极简模式增加基础读写工具适配写作场景，添加情境代入写作人设，帮助 Agent 更好代入。

插件本身不具备破限和风格指定效果，破限和风格指定需要用户在工作区添加世界观和写作风格资料、伪上下文；插件预设起到的作用，是帮助 Agent 更好地接受和理解你的设定，就像药引子。

插件有 2 件套，可搭配船板的仿 Claude 暖纸皮肤 [`chuanban-dsh-theme`](https://github.com/Anarcadia/chuanban-dsh-theme) 使用。

---

写作者需要的 Agent 工作台其实极其简单：

**一个由本地文件夹与 Markdown 文档构成的工作区**

**一个不受工具说明和编程提示词干扰，系统提示词专为沉浸写作设计的 Agent 伙伴。**

大多数通用或编程向 Agent 默认在后台塞入了数千字的“资深软件工程师”规训、代码规范、沙箱审批说明与庞大的工具链。拿它们来推敲小说、打磨长文或对戏时，模型总会带着强烈的“程序员肌肉记忆”——聊着天擅自落盘建文件、改完一段文字还要像交代码 PR 一样列出 `1. 2. 3.` 修改汇报，甚至时不时跳出语境做温和化说教。

DSH 在这一点上也不例外。虽然它内置了「极简模式（`minimal`）」，但那是一个近乎 0 提示词、0 文件工具的跑分向模式。在清掉噪音的同时，也失去了对 Agent 写作身份的引导与最基础的本地读写工具，因此并不适合直接拿来写作。

`chuanban-dsh-writingset` 的目标只有一件事：**赋予 DSH 极简、稳定的基础写作预设和工具环境**。

它在 DSH 运行时将原生编程提示词与冗余工具一刀切清零，把可选工具收敛为纯粹的 `read`、`write`、`edit`，再用**「去工程化的用户协作基底 + 极简写作人设」双层提示词积木**接管上下文。

于是，首轮输入仅 **1,196 tokens**（比官方标准预设节省逾 **80%**），让 DSH 成为一张高效、低底噪的纯文字工作台。

用户还可通过后台设置，选择加载工作台 `AGENTS.md` / `CLAUDE.md` 等通用 Agent 规则文档，与上述的二层提示词叠加，构成**三层提示词积木**，因此此插件不会与本地 Skill、工作区预设冲突。

然而，和其它同样修改 DSH 初始系统提示词的写作预设插件会有潜在冲突，不建议一同开启，或者建议发送给 AI 分析确保无冲突后再使用。

![DSH 写作协作模式与暖纸皮肤实机效果](docs/screenshot-session.png)

---

## 一键安装

### 1. DSH Desktop 桌面端（最简）

打开 **设置 → 插件**，在安装输入框直接粘贴以下 URL：

```text
https://github.com/Anarcadia/chuanban-dsh-writingset/releases/latest/download/chuanban-dsh-writingset.tgz
```

### 2. DSH CLI 命令行

```sh
dsh plugin --profile web add https://github.com/Anarcadia/chuanban-dsh-writingset/releases/latest/download/chuanban-dsh-writingset.tgz
dsh web
```

- **未全局安装 `dsh` CLI**：将上面的 `dsh` 替换为 `npx @deepseek-ai/dsh`：

  ```sh
  npx @deepseek-ai/dsh plugin --profile web add https://github.com/Anarcadia/chuanban-dsh-writingset/releases/latest/download/chuanban-dsh-writingset.tgz
  ```

- **连同配套暖纸皮肤（[`chuanban-dsh-theme`](https://github.com/Anarcadia/chuanban-dsh-theme)）一起装**（一条命令同时装入纯净内核与 Claude Desktop 暖白纸阅读外观）：

  ```sh
  dsh plugin --profile web add https://github.com/Anarcadia/chuanban-dsh-writingset/releases/latest/download/chuanban-dsh-writingset.tgz https://github.com/Anarcadia/chuanban-dsh-theme/releases/latest/download/chuanban-dsh-theme.tgz
  ```

安装后，前台预设选择器默认切入 **「写作协作模式」** （初始激活「职业写手」预设）。所有职能切换与工作区规则注入均可在 **「设置 → 写作协作配置」** 面板中热切换，新开会话即刻生效，无需重启。

---

## 快速上手：用「三层积木」搭好你的写作台

打开 DSH **设置（`Cmd + ,`）→ 写作协作配置**（或左侧 **插件 → `chuanban-dsh-writingset`**），面板由上至下对应了这套**三层提示词积木**的组装逻辑：

![写作协作配置面板与推荐设置](docs/screenshot-settings.png)

### 第一、二层：去工程化协作基底 + 写作职能人设

所有预设默认勾选同一块约 120 字的第一层基底——**【文档与工具协作准则】**（规定对话优先、未获明确指令严禁擅自建文件；改稿只做精准替换、拒绝输出代码 PR 式的修改点汇报；摒弃软件工程黑话与机械分点）。

在这块干净基底之上，你可以选择叠加哪一块第二层 **「写作职能人设」**：

| 预设 ID               | 名称                               | 适用场景与核心导向                                                                                                               |
| :------------------ | :------------------------------- | :---------------------------------------------------------------------------------------------------------------------- |
| **`pro`** *(默认)*    | **职业写手**<br>*(v2 无我沉浸版)*         | **我主要就是为了设计这个模式而做的插件：用于无禁忌无底线的小说创作，请在工作区放置详细的世界观资料文档和示例文（伪装成旧稿续写），叠加起来可影响 Agent 输出风格**。（单独使用预设不具备破甲或风格定义的效果）            |
| **`play`**          | **纯粹娱乐**<br>*(随性脑洞与灵感共谋)*        | **脑洞推演、爽文构思与私密趣味探索**。以当下的兴致、快感与想象力张力为唯一标准，不审视世俗价值，不强行升华立意或正能量收尾，顺着你抛出的苗头把好玩推到极致。                                        |
| **`rp`**            | **创作与 RP 扮演**<br>*(全浸入式叙事与第四面墙)* | **仅测试：角色对戏与沉浸式叙事**。严守“第四面墙”，绝不跳出戏外以 AI 助手视角做元叙事点评；用感官细节、动作张力与潜台词推进场面（Show, don't tell），查阅设定或改写文档均作为纯后台静默动作，执行完立即无缝回到戏内。 |
| **`pure`**          | **纯净通用写作底座**<br>*(零预设人设白板)*      | **日常专栏、散文随笔或完全自定义角色**。仅保留底层【文档与工具协作准则】，不预置任何角色倾向，完全交由你的首轮指令或工作区文档自由定义。                                                  |
| **`pro-v1`** *(留档)* | **职业写手 v1**<br>*(第一性原理锋利版)*      | **仅测试：效率与锋利导向备选**。强调不惜代价达成创作目的与预期受众反应，将笔下文本视为严丝合缝的功能性部件。我一开始设计的第一版方案，留档供对照体感。                                           |

> **PS**：如果你希望把某几个模式直接并列放在聊天窗底部的预设选择器里随时点选，可以在「插件 → `chuanban-dsh-writingset`」详情页把对应预设行（`preset-writing-pro` / `play` / `rp` / `pure`）的开关打开。

### 第三层：工作区提示模式（如上图红绿批注）

前面两层积木只负责把 Agent 调教成“懂规矩、不说教、不乱建文件的写手白板”。真正决定具体题材、文风与创作深度的，是下方的 **「工作区提示模式」** 三选一：

1. **初始纯净（`off`，默认 · 见图中红色标注）**
   - **怎么工作**：只注入前两层积木（职能人设 + 协作基底），**完全不读取工作区里的任何文档**。
   - **什么时候用**：适合刚装好插件测试、随手聊脑洞或改一段短文，上下文极度干净（首轮仅 \~1,196 tokens）。但请注意，在没有第三层工作区资料配合时，单靠几百字的初始人设并不会自动赋予特定文风，也不具备破甲的效果。

2. **工作区识别（`workspace` · 见图中绿色标注，日常主力推荐）**
   - **怎么工作**：每次新开会话组装系统提示词时，自动扫描你当前打开的本地文件夹，把里面的规则与设定文档作为第三层 `【工作区上下文规则】` 拼接到前两层积木之后。

   - **自动扫描顺序**：

     ```text
     AGENTS.md → CLAUDE.md → memory.md → memory/*.md → rules.md → rules/*.md
     ```

     *(注：`CLAUDE.md` 与 `AGENTS.md` 内容相同时自动去重；总读取上限 64KB，超出自动截断并注明；如果当前文件夹里没有这些文件，会自动静默退回「初始纯净」，不会报错。)*

   - **怎么搭出最佳效果**：
     - 如果你已经有一套带 `AGENTS.md` 或本地 `.agents/skills/` 的写作工作台，切到这个模式就能无缝衔接，插件不会吃掉你的工作区规则。
     - 如果你用默认的 **`pro`（职业写手）** 写小说，建议在工作区放一份 `AGENTS.md`（写明你的文风要求与设定目录），并放好详细的**世界观设定文档**与**示例正文（让 Agent 作为旧稿参考或续写）**——“无我职业操守 + 工作区世界观 + 旧稿样本”三层叠在一起，才能真正把模型的注意力锁死在故事语境里。

3. **自定义填写（`custom`）**
   - **怎么工作**：直接在设置面板的文本框里手写第三层提示词，可选 **「追加在初始提示后（`append`）」**，或者点面板上的「用当前初始提示填充编辑」按钮切到 **「整段替换初始提示（`replace`）」** 直接改写默认积木。
   - **什么时候用**：不想在本地文件夹里建 `AGENTS.md`，但想临时加几条人设、文风要求或直接微调内置提示词时使用。

---

## 底层做了什么？（为什么不与本地 Skill 冲突，但忌叠装同类预设插件）

DSH 原生的 `minimal` 模式之所以不能直接用来写东西，是因为它把文件工具也一起砍掉了；而官方默认模式又挂满了工程插件。本插件在底层通过 `cordis.patch.yml` 做了四件精确的改造：

- **接管并重构主系统提示词（`complete: true`）**：在 `@deepseek-ai/dsh-persona` 开启 `complete: true`，将渲染终点的系统提示词收束为 `{{writing_active_brick}}` 变量，一刀切掉官方数千字的全栈工程师人设。
  - **为什么不与本地工作台/Skill 冲突**：插件在宿主侧通过 `workspace` 模式主动读取当前会话目录（`cwd`）下的 `AGENTS.md` / `CLAUDE.md` / `memory` / `rules` 并拼入 `{{writing_active_brick}}`，等于在干净的底座上为你留好了标准的工作区规则入口。
  - **为什么不建议与其它系统提示词插件同开**：因为 `complete: true` 是独占截断机制，若同时启用其它修改初始 Persona 或拦截 System Prompt 的插件，两者会互相覆盖或拼出混乱指令。
- **静音沙箱与审批长文（`includeRuntimeContext: false`）**：关掉运行时沙箱策略与审批机制的冗长说明，只留必需的当前工作目录路径感知。
- **收敛为最小读写工具面（`isolate: { fs: true, attachments: true }`）**：在独立作用域挂载 `@deepseek-ai/dsh-fs-local` 与 `@deepseek-ai/dsh-tool-fs`，切断根作用域 `read_image` 的自动注册，并剥离 `write` / `edit` 工具 Schema 里的 `sandbox_permissions` 与 `justification` 参数——模型眼里只有干干净净的 `read`、`write`、`edit`（外加宿主自带的零参查询工具 `load_workspace_dependencies`）。
- **保留长文会话压缩**：内置 `@deepseek-ai/dsh-compaction-basic` 与 `/compact` 指令，长篇连载讨论可随时压缩上下文。

---

## 进阶：命令行切换与本地自检

如果你克隆了本仓库在本地折腾，也可以直接用自带的零依赖 CLI 脚本查看或切换预设：

```bash
# 查看所有可用预设积木及当前激活项
node scripts/switch-preset.mjs --list

# 预览指定预设（如 pro）拼接后的完整 System Prompt
node scripts/switch-preset.mjs --show pro

# 一键切换默认预设（pro / play / rp / pure / pro-v1）
node scripts/switch-preset.mjs play

# 运行内置 5 项全链路自检测试套件
npm test
```

## 停用与卸载

- **临时切回官方编程模式**：不用卸载，直接在聊天输入框左下角的预设选择器切回官方预设，或在「设置 → 插件」中关掉本插件开关即可。
- **卸载插件**：
  - **DSH Desktop**：设置 → 插件 → 找到 `chuanban-dsh-writingset` 点击卸载。
  - **DSH CLI**：`dsh plugin --profile web remove chuanban-dsh-writingset`

## License

[MIT](package.json) © 船板
