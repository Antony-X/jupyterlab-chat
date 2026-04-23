import * as React from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { cn } from './utils';

const KATEX_CDN = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css';

let katexCssInjected = false;
export function ensureKatexCss(): void {
  if (katexCssInjected) return;
  if (document.querySelector('link[data-jc-katex]')) {
    katexCssInjected = true;
    return;
  }
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = KATEX_CDN;
  link.setAttribute('data-jc-katex', '1');
  document.head.appendChild(link);
  katexCssInjected = true;
}

interface ActionBadgeMeta {
  label: string;
  isDelete: boolean;
}

function badgeForTag(tag: string, idx: string | undefined): ActionBadgeMeta | null {
  if (tag === 'python-run' || tag === 'py-run' || tag === 'run')
    return { label: '▶ executed', isDelete: false };
  if (tag === 'python-edit' || tag === 'py-edit' || tag === 'edit')
    return { label: idx ? `✎ edit cell ${idx}` : '✎ edit', isDelete: false };
  if (tag === 'python-insert-after' || tag === 'py-insert-after' || tag === 'insert-after')
    return { label: idx ? `↳ after cell ${idx}` : '↳ inserted', isDelete: false };
  if (tag === 'python-insert-before' || tag === 'py-insert-before' || tag === 'insert-before')
    return { label: idx ? `↱ before cell ${idx}` : '↱ inserted', isDelete: false };
  if (tag === 'python-delete' || tag === 'py-delete' || tag === 'delete-cell')
    return { label: idx ? `✕ delete cell ${idx}` : '✕ delete', isDelete: true };
  return null;
}

const components: Components = {
  code({ className, children, ...rest }) {
    return (
      <code className={className} {...rest}>
        {children}
      </code>
    );
  },
  pre({ children, ...rest }) {
    const firstChild = React.Children.toArray(children)[0] as React.ReactElement<{
      className?: string;
    }> | undefined;
    const className = firstChild?.props?.className ?? '';
    const match = /language-([\w-]+)(?::(\d+))?/.exec(className);
    const meta = match ? badgeForTag(match[1].toLowerCase(), match[2]) : null;

    const baseClasses =
      'relative my-2.5 overflow-x-auto rounded-md bg-code-bg text-code-fg p-3.5 text-xs leading-relaxed border-l-2 border-muted shadow-[0_2px_10px_-4px_rgba(31,27,22,.3)] font-mono';

    // Delete has no body by design — rendering it as a full code block
    // gives you an empty black rectangle with just a badge on top. Show a
    // single compact line instead so it reads like a log entry, not code.
    if (meta && meta.isDelete) {
      return (
        <div className="my-1.5 text-xs text-muted font-mono">
          {meta.label}
        </div>
      );
    }

    if (!meta) {
      return (
        <pre className={baseClasses} {...rest}>
          {children}
        </pre>
      );
    }
    return (
      <pre
        className={cn(baseClasses, 'jc-action-pre')}
        {...rest}
      >
        {children}
        <span className="jc-action-badge">{meta.label}</span>
      </pre>
    );
  },
  a({ children, href, ...rest }) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-accent underline decoration-1 underline-offset-2 hover:text-brand-ink"
        {...rest}
      >
        {children}
      </a>
    );
  },
  h1: ({ children }) => (
    <h1 className="mt-3.5 mb-1.5 font-serif font-semibold tracking-tight text-[1.32em] text-ink">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-3.5 mb-1.5 font-serif font-semibold tracking-tight text-[1.18em] text-ink">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-3.5 mb-1.5 font-serif font-semibold tracking-tight text-[1.08em] text-ink">
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className="mt-3.5 mb-1.5 font-serif font-semibold tracking-tight text-ink">{children}</h4>
  ),
  h5: ({ children }) => (
    <h5 className="mt-3.5 mb-1.5 font-serif font-semibold tracking-tight text-ink">{children}</h5>
  ),
  h6: ({ children }) => (
    <h6 className="mt-3.5 mb-1.5 font-serif font-semibold tracking-tight text-ink">{children}</h6>
  ),
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  ul: ({ children }) => (
    <ul className="my-1.5 pl-5 list-disc marker:text-brand">{children}</ul>
  ),
  ol: ({ children }) => <ol className="my-1.5 pl-5 list-decimal">{children}</ol>,
  li: ({ children }) => <li className="my-0.5">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 pl-3.5 py-1 border-l-2 border-brand italic font-serif text-ink-soft">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="my-2.5 overflow-x-auto">
      <table className="w-full text-xs border border-line border-collapse">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="px-2.5 py-1.5 text-left border-b border-line bg-paper-2 text-ink-soft text-[10.5px] uppercase tracking-wider font-semibold">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-2.5 py-1.5 border-b border-line">{children}</td>
  ),
  hr: () => <hr className="my-3 border-line" />,
};

const ASSISTANT_PROSE = [
  'font-sans text-sm-plus leading-relaxed text-ink',
  '[&_code:not(pre_code)]:bg-brand-soft',
  '[&_code:not(pre_code)]:text-brand-ink',
  '[&_code:not(pre_code)]:px-1.5',
  '[&_code:not(pre_code)]:py-[1px]',
  '[&_code:not(pre_code)]:rounded',
  '[&_code:not(pre_code)]:text-[0.9em]',
  '[&_code:not(pre_code)]:font-mono',
  '[&_code:not(pre_code)]:font-medium',
].join(' ');

interface MarkdownViewProps {
  text: string;
  className?: string;
}

export function MarkdownView({ text, className }: MarkdownViewProps) {
  // Guard: sanitize against naive script injection. react-markdown doesn't
  // parse raw HTML unless rehype-raw is loaded, which we don't do, but be paranoid.
  return (
    <div className={cn(ASSISTANT_PROSE, className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
