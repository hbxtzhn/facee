import MarkdownIt from 'markdown-it';

/**
 * Markdown 解析器配置。
 *
 * 关键点：markdown-it 默认的 validateLink 会把 `file:` 判为不安全协议，
 * 于是 `![图](file:///.../assets/x.png)` **不会被解析成图片 token**，
 * 而是原样当文本渲染 —— 本地图片就永远显示不出来（题库规范 §21）。
 * 这里在默认规则之上，只额外放行 `file:`。
 */
const markdownit = MarkdownIt({ typographer: true, linkify: true });
const defaultValidateLink = markdownit.validateLink.bind(markdownit);

markdownit.validateLink = (url: string): boolean =>
  /^file:/i.test(url.trim()) || defaultValidateLink(url);

export default markdownit;

/** 题目内链支持的 scheme：`app://question/<id>` 与题库规范 v1 的 `facee://question/<id>` */
const QUESTION_LINK_SCHEMES = ['app://question/', 'facee://question/'];

/** 从内链里解析题目 ID；不是题目内链时返回 null。 */
export function parseQuestionHref(href: string): string | null {
  for (const scheme of QUESTION_LINK_SCHEMES) {
    if (href.startsWith(scheme)) {
      const id = href.slice(scheme.length).trim();
      return id.length > 0 ? id : null;
    }
  }
  return null;
}

/** 允许交给系统浏览器打开的协议（§11 外部链接）。 */
export function isExternalHref(href: string): boolean {
  return /^(https?|mailto):/i.test(href.trim());
}
