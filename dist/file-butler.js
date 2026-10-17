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

function parsePathArg(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

/** 经 fs 服务解析为 { display, real }：display 供用户阅读，real 供本地动作。 */
async function toRealPath(ctx, rawPath, label) {
  const target = await ctx.fs.resolve(parsePathArg(rawPath, label));
  return { display: target.displayPath, real: ctx.fs.processPath(target) };
}

/** 回收站目标路径：~/.Trash/<原名>.<时间戳>，时间戳防同名覆盖。 */
function trashDestination(displayPath) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return join(homedir(), '.Trash', `${basename(displayPath)}.${stamp}`);
}

/** 跨卷 rename 失败时的回退：先复制再删源（删源仅发生在副本完整落盘之后）。 */
async function moveAcrossDevices(srcReal, dstReal) {
  await cp(srcReal, dstReal, { recursive: true, force: true });
  await rm(srcReal, { recursive: true, force: true });
}

export function apply(ctx) {
  ctx.tools.register({
    name: 'copy_file',
    description: 'Copy a file or a whole directory tree to a new path. Runs server-side, so large or binary files bypass the conversation context entirely. Missing parent directories of the destination are created automatically.',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Source path to copy (file or directory).' },
        destination: { type: 'string', description: 'Destination path.' },
        overwrite: { type: 'boolean', description: 'Whether an existing destination may be overwritten. Defaults to true.' },
      },
      required: ['file_path', 'destination'],
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          source: { type: 'string' },
          destination: { type: 'string' },
          bytes: { type: 'integer' },
          is_directory: { type: 'boolean' },
        },
        required: ['source', 'destination', 'bytes', 'is_directory'],
      },
      render: (_args, v) => [{ type: 'text', text: `Copied ${v.source} \u2192 ${v.destination} (${v.bytes} bytes${v.is_directory ? ', directory tree' : ''})` }],
    },
    async execute(args) {
      const overwrite = args.overwrite !== false;
      const src = await toRealPath(ctx, args.file_path, 'file_path');
      const dst = await toRealPath(ctx, args.destination, 'destination');
      await mkdir(dirname(dst.real), { recursive: true });
      await cp(src.real, dst.real, { recursive: true, force: overwrite, errorOnExist: !overwrite });
      const info = await stat(dst.real);
      return { source: src.display, destination: dst.display, bytes: info.size, is_directory: info.isDirectory() };
    },
  });

  ctx.tools.register({
    name: 'move_file',
    description: 'Move or rename a file or directory to a new path (server-side). Missing parent directories of the destination are created automatically.',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Source path to move (file or directory).' },
        destination: { type: 'string', description: 'Destination path.' },
      },
      required: ['file_path', 'destination'],
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          source: { type: 'string' },
          destination: { type: 'string' },
          moved: { type: 'boolean' },
        },
        required: ['source', 'destination', 'moved'],
      },
      render: (_args, v) => [{ type: 'text', text: `Moved ${v.source} \u2192 ${v.destination}` }],
    },
    async execute(args) {
      const src = await toRealPath(ctx, args.file_path, 'file_path');
      const dst = await toRealPath(ctx, args.destination, 'destination');
      await mkdir(dirname(dst.real), { recursive: true });
      try {
        await rename(src.real, dst.real);
      } catch (error) {
        if (error?.code === 'EXDEV') await moveAcrossDevices(src.real, dst.real);
        else throw error;
      }
      return { source: src.display, destination: dst.display, moved: true };
    },
  });

  ctx.tools.register({
    name: 'trash_file',
    description: 'Move a file or directory into the system trash (~/.Trash on macOS), from which it can be restored. This never permanently deletes anything.',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path of the file or directory to trash.' },
      },
      required: ['file_path'],
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          trashed: { type: 'string' },
          trash_path: { type: 'string' },
          restore_hint: { type: 'string' },
        },
        required: ['trashed', 'trash_path', 'restore_hint'],
      },
      render: (_args, v) => [{ type: 'text', text: `Moved to trash (recoverable): ${v.trashed} \u2192 ${v.trash_path}` }],
    },
    async execute(args) {
      const src = await toRealPath(ctx, args.file_path, 'file_path');
      const trashPath = trashDestination(src.display);
      await mkdir(dirname(trashPath), { recursive: true });
      try {
        await rename(src.real, trashPath);
      } catch (error) {
        if (error?.code === 'EXDEV') await moveAcrossDevices(src.real, trashPath);
        else throw error;
      }
      return {
        trashed: src.display,
        trash_path: trashPath,
        restore_hint: 'Open the system trash to restore, or move it back manually.',
      };
    },
  });

  ctx.tools.register({
    name: 'stat_file',
    description: 'Show metadata of a file or directory: size in bytes, creation and modification times, and type.',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to inspect.' },
      },
      required: ['file_path'],
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          path: { type: 'string' },
          size_bytes: { type: 'integer' },
          created: { type: 'string' },
          modified: { type: 'string' },
          is_directory: { type: 'boolean' },
        },
        required: ['path', 'size_bytes', 'created', 'modified', 'is_directory'],
      },
      render: (_args, v) => [{ type: 'text', text: `${v.path} \u2014 ${v.size_bytes} bytes, created ${v.created}, modified ${v.modified}${v.is_directory ? ' [directory]' : ''}` }],
    },
    async execute(args) {
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
  });
}
