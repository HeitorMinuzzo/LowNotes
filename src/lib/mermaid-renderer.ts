import type { MermaidConfig } from 'mermaid';

let queue: Promise<unknown> = Promise.resolve();

/** Mermaid has global configuration. Serialize preview and export rendering. */
export function renderMermaidSvg(id: string, source: string, config: MermaidConfig, host?: HTMLElement): Promise<string> {
  const result = queue.then(async () => {
    const { default: mermaid } = await import('mermaid');
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', ...config });
    const { svg } = await mermaid.render(id, source, host);
    return svg;
  });
  queue = result.catch(() => {});
  return result;
}
