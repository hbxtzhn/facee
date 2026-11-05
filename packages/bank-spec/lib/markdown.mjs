// Markdown 行级工具：代码块识别、图片引用、HTML 检测。
// 只做构建与校验需要的最小解析，不渲染 Markdown。

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/**
 * 逐行扫描并标注代码块。
 * @param {string[]} lines
 * @returns {{inFence: boolean[], blocks: {start: number, end: number, lang: string, lines: number, closed: boolean}[]}}
 *   inFence[i] 为 true 表示第 i 行属于代码块（含围栏行本身）；start/end 为围栏行下标。
 */
export function scanFences(lines) {
  const inFence = new Array(lines.length).fill(false);
  const blocks = [];
  let open = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (open) {
      inFence[i] = true;
      const m = FENCE_RE.exec(line);
      if (m && m[1][0] === open.char && m[1].length >= open.len && m[2].trim() === '') {
        blocks.push({ start: open.start, end: i, lang: open.lang, lines: i - open.start - 1, closed: true });
        open = null;
      }
      continue;
    }
    const m = FENCE_RE.exec(line);
    if (m) {
      // 反引号围栏的 info string 不得含反引号（CommonMark）
      if (m[1][0] === '`' && m[2].includes('`')) continue;
      inFence[i] = true;
      open = { start: i, char: m[1][0], len: m[1].length, lang: m[2].trim().split(/\s+/)[0] ?? '' };
    }
  }
  if (open) {
    blocks.push({ start: open.start, end: lines.length - 1, lang: open.lang, lines: lines.length - open.start - 1, closed: false });
  }
  return { inFence, blocks };
}

/** 去掉行内代码（`…` / ``…``），用于 HTML 与图片检测 */
export function stripInlineCode(line) {
  return line.replace(/(`+)(?:(?!\1)[\s\S])*?\1/g, (s) => ' '.repeat(s.length));
}

// 标签名后必须是空白、`/` 或 `>`，因此 `<https://…>` 自动链接与 `a < b` 不会误判
const HTML_RE = /<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?\/?>|<!--|<!\[CDATA\[|<![A-Za-z]/;

export function findHtml(line) {
  const m = HTML_RE.exec(stripInlineCode(line));
  return m ? m[0] : null;
}

// ![alt](path) / ![alt](<path>) / ![alt](path "title")
export const IMAGE_RE = /!\[([^\]]*)\]\(\s*(<[^>]*>|[^)\s]+)(\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;

/** 列出一行里的图片引用（已排除行内代码） */
export function findImages(line) {
  const out = [];
  const masked = stripInlineCode(line);
  for (const m of masked.matchAll(IMAGE_RE)) {
    let target = m[2];
    if (target.startsWith('<')) target = target.slice(1, -1);
    out.push({ index: m.index, length: m[0].length, alt: m[1], target, title: m[3] ?? '' });
  }
  return out;
}

/**
 * 字数（规范 §2.1 长度限制的计量方式）：非 ASCII 字符（汉字、全角标点等）每个计 1，
 * ASCII 字符（字母、数字、半角标点、空格）每个计 0.5，合计向上取整。
 * 即「两个半角字符算一个字」，避免中英混排的术语（如 maxmemory-policy）被过度计数。
 */
export function charCount(s) {
  let half = 0;
  let full = 0;
  for (const ch of s) {
    if (ch.codePointAt(0) < 0x80) half++;
    else full++;
  }
  return full + Math.ceil(half / 2);
}
