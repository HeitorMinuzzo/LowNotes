import MarkdownIt from 'markdown-it';
import abbr from 'markdown-it-abbr';
import container from 'markdown-it-container';
import deflist from 'markdown-it-deflist';
import { full as emoji } from 'markdown-it-emoji';
import footnote from 'markdown-it-footnote';
import ins from 'markdown-it-ins';
import mark from 'markdown-it-mark';
import sub from 'markdown-it-sub';
import sup from 'markdown-it-sup';
import taskLists from 'markdown-it-task-lists';

export const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
})
  .use(abbr)
  .use(deflist)
  .use(emoji)
  .use(footnote)
  .use(ins)
  .use(mark)
  .use(sub)
  .use(sup)
  .use(taskLists, { enabled: false, label: true });

for (const name of ['warning', 'info', 'tip', 'danger']) {
  markdown.use(container, name);
}

const renderFence = markdown.renderer.rules.fence;
markdown.renderer.rules.fence = (tokens, index, options, env, renderer) => {
  const token = tokens[index];
  if (token.info.trim().split(/\s+/, 1)[0] === 'mermaid') {
    const encoded = encodeURIComponent(token.content);
    return `<div class="mermaid-block" data-mermaid="${encoded}"><div class="mermaid-svg"></div></div>`;
  }
  return renderFence
    ? renderFence(tokens, index, options, env, renderer)
    : renderer.renderToken(tokens, index, options);
};

export function renderMarkdown(source: string): string {
  return markdown.render(source);
}
