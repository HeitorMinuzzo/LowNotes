import { expect, test } from 'bun:test';
import { renderMarkdown } from '../src/lib/markdown';

test('renderiza listas de definição com marcação e vários blocos', () => {
  const html = renderMarkdown(`Term 1
: Definition 1 with lazy continuation.

Term 2 with *inline markup*
: Definition 2

    { some code, part of Definition 2 }

    Third paragraph of definition 2.
`);

  expect(html).toContain('<dl>');
  expect(html).toContain('<dt>Term 1</dt>');
  expect(html).toContain('<dt>Term 2 with <em>inline markup</em></dt>');
  expect(html).toContain('<dd>');
  expect(html).toContain('Third paragraph of definition 2.');

  const compact = renderMarkdown('Term 1\n~ Definition 1\n\nTerm 2\n~ Definition 2a\n~ Definition 2b');
  expect(compact).toContain('<dt>Term 1</dt>');
  expect(compact).toContain('<dd>Definition 2a</dd>');
  expect(compact).toContain('<dd>Definition 2b</dd>');
});

test('renderiza extensões demonstradas pelo markdown-it', () => {
  const html = renderMarkdown(`Footnote[^note] and HTML.

[^note]: Footnote **with markup**.

*[HTML]: Hyper Text Markup Language

::: warning
here be dragons
:::

++Inserted++ ==marked== H~2~O 19^th^ :smile:

https://example.com
`);

  expect(html).toContain('class="footnote-ref"');
  expect(html).toContain('class="footnotes"');
  expect(html).toContain('<abbr title="Hyper Text Markup Language">HTML</abbr>');
  expect(html).toContain('class="warning"');
  expect(html).toContain('<ins>Inserted</ins>');
  expect(html).toContain('<mark>marked</mark>');
  expect(html).toContain('<sub>2</sub>');
  expect(html).toContain('<sup>th</sup>');
  expect(html).toContain('😄');
  expect(html).toContain('<a href="https://example.com">');
});

test('preserva tarefas e diagramas sem aceitar HTML bruto', () => {
  const html = renderMarkdown('- [x] Ready\n\n```mermaid\ngraph TD\nA-->B\n```\n\n<script>alert(1)</script>');

  expect(html).toContain('type="checkbox"');
  expect(html).toContain('data-mermaid="');
  expect(html).not.toContain('<script>');
  expect(html).toContain('&lt;script&gt;');
});

test('renderiza wikilinks com data-wikilink', () => {
  const html = renderMarkdown('# x\n\n[[Minha Nota]]');
  expect(html).toContain('data-wikilink="Minha Nota"');
  expect(html).toContain('class="wikilink"');
  expect(html).toContain('>Minha Nota</a>');
});

test('não renderiza wikilinks dentro de code fence', () => {
  const html = renderMarkdown('```\n[[Não]]\n```');
  expect(html).not.toContain('data-wikilink');
  expect(html).toContain('[[Não]]');
});

test('wikilink com alias mostra o rótulo e preserva o destino', () => {
  const html = renderMarkdown('Veja [[Python/Plano|Plano de estudos]].');
  expect(html).toContain('data-wikilink="Python/Plano"');
  expect(html).toContain('>Plano de estudos</a>');
});
