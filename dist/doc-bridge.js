/**
 * chuanban-dsh-writingset/doc-bridge - Word ↔ Markdown 单向文档桥（零依赖）
 *
 * convert_document：docx → md 文件。解包 zip 取 word/document.xml，提取段落、
 *   标题层级（经 styles.xml 的 heading 映射）、列表项，落盘同名 .md。
 * export_document：md → 新建 docx。手写 zip（store 模式）+ 最小 OOXML 模板，
 *   标题/列表/段落映射为 Word 内置样式，产物在 Word/WPS 中为规范排版。
 *
 * 定位与边界：处理「内容」（正文/标题/列表），不复刻「排版」（原字体、表格
 * 单元格结构、加粗斜体等样式不保留）；不修改现有 docx 内部。零外部依赖，
 * 无执行通道，路径经 ctx.fs.resolve 解析，与 read/write/edit 同等自由度。
 */

import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { dirname } from 'node:path';

export const name = 'doc-bridge';
export const inject = ['tools', 'fs'];

function parsePathArg(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

async function toRealPath(ctx, rawPath, label) {
  const target = await ctx.fs.resolve(parsePathArg(rawPath, label));
  return { display: target.displayPath, real: ctx.fs.processPath(target) };
}

/* ───────────────────── 零依赖 zip 读取（central directory 扫描） ───────────────────── */

/** 从 zip 字节中按路径取出解压后的内容；找不到返回 undefined。 */
export function zipRead(buf, wantedPath) {
  if (!buf || buf.length < 22) throw new Error('not a valid zip/docx container (missing EOCD)');
  const EOCD_SIG = 0x06054b50;
  const CEN_SIG = 0x02014b50;
  const LOC_SIG = 0x04034b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i -= 1) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a valid zip/docx container (missing EOCD)');
  const entryCount = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < entryCount; n += 1) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CEN_SIG) throw new Error('corrupt zip central directory');
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const rawName = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const name = rawName.replace(/^\/+/, '').replace(/\\/g, '/');
    if (name === wantedPath) {
      if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== LOC_SIG) {
        throw new Error('corrupt zip local header');
      }
      const lNameLen = buf.readUInt16LE(localOffset + 26);
      const lExtraLen = buf.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + lNameLen + lExtraLen;
      const data = buf.subarray(dataStart, dataStart + compressedSize);
      if (method === 0) return data;
      if (method === 8) return inflateRawSync(data);
      throw new Error(`unsupported zip compression method ${method}`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return undefined;
}

/* ───────────────────── 零依赖 zip 写入（store 模式） ───────────────────── */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 把 { path → utf8 字符串 } 集合打包成最小合法 zip（store，无压缩）。 */
function zipBuild(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.from(text, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);          // version needed
    local.writeUInt16LE(0, 6);           // flags
    local.writeUInt16LE(0, 8);           // method: store
    local.writeUInt16LE(0, 10);          // mod time
    local.writeUInt16LE(0x21, 12);       // mod date (1980-01-01)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);        // version made by
    central.writeUInt16LE(20, 6);        // version needed
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += 30 + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const count = centrals.reduce((acc, b) => acc + (b.length === 46 ? 1 : 0), 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(count, 8);
  eocd.writeUInt16LE(count, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

/* ───────────────────── docx → markdown ───────────────────── */

function safeCodePoint(code) {
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff
    ? String.fromCodePoint(code)
    : '';
}

function xmlUnescape(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

/** 从 styles.xml 建 styleId → heading 级别映射（OOXML 内置样式名 "heading N" 大小写无关，兜底 outlineLvl）。 */
export function headingLevelsFromStyles(stylesXml) {
  const map = new Map();
  if (!stylesXml) return map;
  const re = /<w:style\b[^>]*w:styleId="([^"]+)"[^>]*>([\s\S]*?)<\/w:style>/g;
  let m;
  while ((m = re.exec(stylesXml)) !== null) {
    const name = /<w:name\b[^>]*\bw:val=["']heading\s*([1-6])["']/i.exec(m[2]);
    if (name) {
      map.set(m[1], Number(name[1]));
      continue;
    }
    const outline = /<w:outlineLvl\b[^>]*\bw:val=["']([0-5])["']/.exec(m[2]);
    if (outline && /w:type=["']paragraph["']/.test(m[0])) {
      map.set(m[1], Number(outline[1]) + 1);
    }
  }
  return map;
}

/** 把 word/document.xml 正文提取为 markdown 文本。 */
export function documentXmlToMarkdown(docXml, headingLevels) {
  const paragraphs = docXml.split('</w:p>');
  const out = [];
  for (const p of paragraphs) {
    // 只取 body 内的段落片段：首个 <w:body> 之后的内容天然满足；表格内段落同样被提取（拍平为正文行）
    let text = '';
    const re = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>/g;
    let m;
    while ((m = re.exec(p)) !== null) {
      if (m[1] !== undefined) text += xmlUnescape(m[1]);
      else if (m[0].startsWith('<w:tab')) text += '\t';
      else text += '\n';
    }
    text = text.replace(/\u00a0/g, ' ').trim();
    if (text.length === 0) continue;
    const styleMatch = /<w:pStyle w:val="([^"]+)"/.exec(p);
    const level = styleMatch ? headingLevels.get(styleMatch[1]) : undefined;
    const fallback = styleMatch ? /^(?:Heading|heading)([1-6])$/.exec(styleMatch[1]) : null;
    const heading = level ?? (fallback ? Number(fallback[1]) : undefined);
    const hasActiveNumPr = p.includes('<w:numPr') && !/<w:numId\b[^>]*\bw:val=["']0["']/.test(p);
    const isList = hasActiveNumPr || styleMatch?.[1] === 'ListParagraph';
    if (heading && heading >= 1 && heading <= 6) {
      const singleLineHeading = text.replace(/\s*\n+\s*/g, ' ');
      out.push('', '#'.repeat(heading) + ' ' + singleLineHeading, '');
    } else if (isList) {
      const cleaned = text.replace(/^\u2022\s*/, '').replace(/\n/g, ' ');
      out.push('- ' + cleaned);
    } else {
      out.push('', text, '');
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/* ───────────────────── markdown → docx ───────────────────── */

function xmlEscape(s) {
  return s
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** md 行内清理：剥掉 md 强调标记，导出纯内容文本。 */
function stripInlineMarkdown(s) {
  return s
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*\s][^*]*?)\*/g, '$1')
    .replace(/(^|[\s(])__([^_]+)__(?=[\s).,!?:;]|$)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1');
}

function mdParagraphXml(text) {
  return `<w:p><w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
}

function headingParagraphXml(level, text) {
  return `<w:p><w:pPr><w:pStyle w:val="Heading${level}"/></w:pPr><w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
}

function listParagraphXml(text) {
  return `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/></w:pPr><w:r><w:t xml:space="preserve">\u2022 ${xmlEscape(text)}</w:t></w:r></w:p>`;
}

export function markdownToDocxBuffer(mdText) {
  const bodyParts = [];
  for (const rawLine of mdText.split('\n')) {
    const line = rawLine.trimEnd();
    if (line.trim().length === 0) continue;
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      bodyParts.push(headingParagraphXml(heading[1].length, stripInlineMarkdown(heading[2])));
      continue;
    }
    const item = /^[-*+]\s+(.*)$/.exec(line);
    if (item) {
      bodyParts.push(listParagraphXml(stripInlineMarkdown(item[1])));
      continue;
    }
    bodyParts.push(mdParagraphXml(stripInlineMarkdown(line)));
  }
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${bodyParts.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;

  const headingStyles = [1, 2, 3, 4, 5, 6].map((n) => `
  <w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:outlineLvl w:val="${n - 1}"/><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr>${n <= 2 ? '<w:b/>' : ''}<w:sz w:val="${Math.max(18, 32 - n * 3) * 2}"/></w:rPr></w:style>`).join('');
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="PingFang SC"/><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="160" w:line="320" w:lineRule="auto"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720"/><w:spacing w:after="80" w:line="320" w:lineRule="auto"/></w:pPr></w:style>${headingStyles}</w:styles>`;

  const files = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/_rels/document.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'word/document.xml': documentXml,
    'word/styles.xml': stylesXml,
  };
  return zipBuild(files);
}

/* ───────────────────── 工具注册 ───────────────────── */

const PREVIEW_CHARS = 600;

/**
 * 确保 export_document 绝不覆盖已存在的 .docx 文件：
 * 若目标路径已存在，自动派生 <stem>.exported.docx（或 <stem>.exported-2.docx ...）。
 */
function ensureNonOverwritingDocxTarget(dst, existsFn) {
  if (!existsFn(dst.real)) return dst;
  const stemDisplay = dst.display.replace(/\.docx$/i, '');
  const stemReal = dst.real.replace(/\.docx$/i, '');
  let candidateDisplay = `${stemDisplay}.exported.docx`;
  let candidateReal = `${stemReal}.exported.docx`;
  let seq = 2;
  while (existsFn(candidateReal)) {
    candidateDisplay = `${stemDisplay}.exported-${seq}.docx`;
    candidateReal = `${stemReal}.exported-${seq}.docx`;
    seq += 1;
  }
  return { display: candidateDisplay, real: candidateReal };
}

export function apply(ctx) {
  ctx.tools.register({
    name: 'convert_document',
    description: 'Convert a .docx (Word) file into a Markdown text file (same name with .md by default). Extracts paragraphs, heading levels and list items; tables are flattened and inline formatting is dropped. Optionally returns a preview of the converted text.',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to the .docx source.' },
        destination: { type: 'string', description: 'Destination .md path. Defaults to the source path with the extension replaced by .md.' },
      },
      required: ['file_path'],
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          source: { type: 'string' },
          destination: { type: 'string' },
          characters: { type: 'integer' },
          preview: { type: 'string' },
        },
        required: ['source', 'destination', 'characters', 'preview'],
      },
      render: (_args, v) => [{ type: 'text', text: `Converted ${v.source} \u2192 ${v.destination} (${v.characters} chars)\n\n${v.preview}` }],
    },
    async execute(args) {
      const src = await toRealPath(ctx, args.file_path, 'file_path');
      const dst = args.destination
        ? await toRealPath(ctx, args.destination, 'destination')
        : { display: src.display.replace(/\.docx$/i, '') + '.md', real: src.real.replace(/\.docx$/i, '') + '.md' };
      if (src.real === dst.real) {
        throw new Error(`Destination must differ from source file_path: "${src.display}"`);
      }
      const bytes = await readFile(src.real);
      const docXmlBuf = zipRead(bytes, 'word/document.xml');
      if (docXmlBuf === undefined) throw new Error(`no word/document.xml inside "${src.display}" — is it a valid .docx?`);
      const stylesBuf = zipRead(bytes, 'word/styles.xml');
      const headingLevels = headingLevelsFromStyles(stylesBuf ? stylesBuf.toString('utf8') : undefined);
      const md = documentXmlToMarkdown(docXmlBuf.toString('utf8'), headingLevels);
      await mkdir(dirname(dst.real), { recursive: true });
      await writeFile(dst.real, md, 'utf8');
      const preview = md.length > PREVIEW_CHARS ? md.slice(0, PREVIEW_CHARS) + '\n…（已截断，全文见输出文件）' : md.trimEnd();
      return { source: src.display, destination: dst.display, characters: md.length, preview };
    },
  });

  ctx.tools.register({
    name: 'export_document',
    description: 'Export a Markdown file as a NEW .docx (Word) document. Headings, list items and paragraphs map to proper Word styles; inline markdown emphasis is stripped. The original .docx is never modified — this always creates a new file.',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to the .md source.' },
        destination: { type: 'string', description: 'Destination .docx path. Defaults to the source path with the extension replaced by .docx.' },
      },
      required: ['file_path'],
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          source: { type: 'string' },
          destination: { type: 'string' },
          bytes: { type: 'integer' },
        },
        required: ['source', 'destination', 'bytes'],
      },
      render: (_args, v) => [{ type: 'text', text: `Exported ${v.source} \u2192 ${v.destination} (${v.bytes} bytes, new .docx)` }],
    },
    async execute(args) {
      const src = await toRealPath(ctx, args.file_path, 'file_path');
      const rawDst = args.destination
        ? await toRealPath(ctx, args.destination, 'destination')
        : { display: src.display.replace(/\.md$/i, '') + '.docx', real: src.real.replace(/\.md$/i, '') + '.docx' };
      if (src.real === rawDst.real) {
        throw new Error(`Destination must differ from source file_path: "${src.display}"`);
      }
      const dst = ensureNonOverwritingDocxTarget(rawDst, existsSync);
      const md = await readFile(src.real, 'utf8');
      const docx = markdownToDocxBuffer(md);
      await mkdir(dirname(dst.real), { recursive: true });
      await writeFile(dst.real, docx);
      return { source: src.display, destination: dst.display, bytes: docx.length };
    },
  });
}
