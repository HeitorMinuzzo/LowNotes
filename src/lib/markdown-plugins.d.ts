declare module 'markdown-it-abbr' {
  export default function plugin(md: import('markdown-it').MarkdownIt): void;
}
declare module 'markdown-it-container' {
  export default function plugin(md: import('markdown-it').MarkdownIt, name: string): void;
}
declare module 'markdown-it-deflist' {
  export default function plugin(md: import('markdown-it').MarkdownIt): void;
}
declare module 'markdown-it-emoji' {
  export function full(md: import('markdown-it').MarkdownIt): void;
}
declare module 'markdown-it-footnote' {
  export default function plugin(md: import('markdown-it').MarkdownIt): void;
}
declare module 'markdown-it-ins' {
  export default function plugin(md: import('markdown-it').MarkdownIt): void;
}
declare module 'markdown-it-mark' {
  export default function plugin(md: import('markdown-it').MarkdownIt): void;
}
declare module 'markdown-it-sub' {
  export default function plugin(md: import('markdown-it').MarkdownIt): void;
}
declare module 'markdown-it-sup' {
  export default function plugin(md: import('markdown-it').MarkdownIt): void;
}
declare module 'markdown-it-task-lists' {
  export default function plugin(
    md: import('markdown-it').MarkdownIt,
    options?: { enabled?: boolean; label?: boolean; labelAfter?: boolean }
  ): void;
}
