/**
 * chuanban-dsh-writingset/file-butler - 文件管理积木（受限四动作）
 *
 * 提供 copy_file / move_file / trash_file / stat_file 四个纯路径参数工具：
 * 服务端直接执行复制/移动/入回收站/查元数据，长稿与二进制不经过模型上下文。
 * 安全边界：只接受路径参数、动作内部写死，不存在任意命令通道；路径经
 * ctx.fs.resolve 解析，与 read/write/edit 同等自由度（本地 backend 语义）。
 * trash_file 将文件移入系统回收站（~/.Trash，可恢复），绝不永久删除。
 */

import { cp, mkdir, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { homedir } from 'node:os';

export const name = 'file-butler';
export const inject = ['tools', 'fs'];

async function loadDefineTool(): Promise<(tool: any) => any> {
  try {
    const mod: any = await import('@deepseek-ai/dsh-tools');
    if (typeof mod.defineTool === 'function') return mod.defineTool;
    if (typeof mod.default?.defineTool === 'function') return mod.default.defineTool;
  } catch {
    // 独立 Node 测试环境无宿主解析链：定义透传，由 mock ctx 接收
  }
  return (tool) => tool;
}

const defineTool = await loadDefineTool();

function parsePathArg(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

/** 经 fs 服务解析为 { display, real }：display 供用户阅读，real 供本地动作。 */
async function toRealPath(ctx: any, rawPath: unknown, label: string): Promise<{ display: string; real: string }> {
  const target = await ctx.fs.resolve(parsePathArg(rawPath, label));
  return { display: target.displayPath, real: ctx.fs.processPath(target) };
}

/** 回收站目标路径：~/.Trash/<原名>.<时间戳>，时间戳防同名覆盖。 */
function trashDestination(displayPath: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return join(homedir(), '.Trash', `${basename(displayPath)}.${stamp}`);
}

/** 跨卷 rename 失败时的回退：先复制再删源（删源仅发生在副本完整落盘之后）。 */
async function moveAcrossDevices(srcReal: string, dstReal: string): Promise<void> {
  await cp(srcReal, dstReal, { recursive: true, force: true });
  await rm(srcReal, { recursive: true, force: true });
}

export function apply(ctx: any): void {
  ctx.tools.register(defineTool({
    name: 'copy_file',
    description: 'Copy a file or a whole directory tree to a new path. Runs server-side, so large or binary files bypass the conversation context entirely. Missing parent directories of the destination are created automatically.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'Source path to copy (file or directory).' },
      destination: { type: 'string', required: true, description: 'Destination path.' },
      overwrite: { type: 'boolean', description: 'Whether an existing destination may be overwritten. Defaults to true.' },
    },
    async execute(args: { file_path: string; destination: string; overwrite?: boolean }) {
      const overwrite = args.overwrite !== false;
      const src = await toRealPath(ctx, args.file_path, 'file_path');
      const dst = await toRealPath(ctx, args.destination, 'destination');
      await mkdir(dirname(dst.real), { recursive: true });
      await cp(src.real, dst.real, { recursive: true, force: overwrite, errorOnExist: !overwrite });
      const info = await stat(dst.real);
      return { source: src.display, destination: dst.display, bytes: info.size, is_directory: info.isDirectory() };
    },
  }));

  ctx.tools.register(defineTool({
    name: 'move_file',
    description: 'Move or rename a file or directory to a new path (server-side). Missing parent directories of the destination are created automatically.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'Source path to move (file or directory).' },
      destination: { type: 'string', required: true, description: 'Destination path.' },
    },
    async execute(args: { file_path: string; destination: string }) {
      const src = await toRealPath(ctx, args.file_path, 'file_path');
      const dst = await toRealPath(ctx, args.destination, 'destination');
      await mkdir(dirname(dst.real), { recursive: true });
      try {
        await rename(src.real, dst.real);
      } catch (error: any) {
        if (error?.code === 'EXDEV') await moveAcrossDevices(src.real, dst.real);
        else throw error;
      }
      return { source: src.display, destination: dst.display, moved: true };
    },
  }));

  ctx.tools.register(defineTool({
    name: 'trash_file',
    description: 'Move a file or directory into the system trash (~/.Trash on macOS), from which it can be restored. This never permanently deletes anything.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'Path of the file or directory to trash.' },
    },
    async execute(args: { file_path: string }) {
      const src = await toRealPath(ctx, args.file_path, 'file_path');
      const trashPath = trashDestination(src.display);
      await mkdir(dirname(trashPath), { recursive: true });
      try {
        await rename(src.real, trashPath);
      } catch (error: any) {
        if (error?.code === 'EXDEV') await moveAcrossDevices(src.real, trashPath);
        else throw error;
      }
      return {
        trashed: src.display,
        trash_path: trashPath,
        restore_hint: 'Open the system trash to restore, or move it back manually.',
      };
    },
  }));

  ctx.tools.register(defineTool({
    name: 'stat_file',
    description: 'Show metadata of a file or directory: size in bytes, creation and modification times, and type.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'Path to inspect.' },
    },
    async execute(args: { file_path: string }) {
      const src = await toRealPath(ctx, args.file_path, 'file_path');
      const info = await stat(src.real);
      return {
        path: src.display,
        size_bytes: info.size,
        created: info.birthtime.toISOString(),
        modified: info.mtime.toISOString(),
        is_directory: info.isDirectory(),
      };
    },
  }));
}
