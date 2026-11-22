import { Fragment, type ReactNode } from 'react';

/**
 * Tiny, safe markdown renderer (builds React nodes, never sets innerHTML).
 * Supports headings, paragraphs, bullet/numbered lists, task lists, quotes,
 * code fences, horizontal rules and inline bold/italic/strike/code/links.
 */
export function Markdown({ text, onToggleTask }: { text: string; onToggleTask?: (lineIndex: number) => void }) {
  const lines = text.split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(<pre key={key++} className="md-pre"><code>{buf.join('\n')}</code></pre>);
      continue;
    }

    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const content = inline(h[2]);
      out.push(level === 1 ? <h1 key={key++}>{content}</h1> : level === 2 ? <h2 key={key++}>{content}</h2> : <h3 key={key++}>{content}</h3>);
      i++;
      continue;
    }

    if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      out.push(<hr key={key++} />);
      i++;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      out.push(<blockquote key={key++}>{buf.map((b, j) => <Fragment key={j}>{j > 0 && <br />}{inline(b)}</Fragment>)}</blockquote>);
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        const idx = i;
        const l = lines[i];
        const task = /^\s*[-*]\s+\[( |x|X)\]\s?(.*)$/.exec(l);
        if (task) {
          const checked = task[1] !== ' ';
          items.push(
            <li key={idx} className={`md-task ${checked ? 'done' : ''}`}>
              <button
                className={`checkbox ${checked ? 'on' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleTask?.(idx);
                }}
                aria-label={checked ? 'Uncheck' : 'Check'}
              >
                {checked && <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m3.5 8.5 3 3 6-7" /></svg>}
              </button>
              <span>{inline(task[2])}</span>
            </li>,
          );
        } else {
          items.push(<li key={idx}>{inline(l.replace(/^\s*[-*]\s+/, ''))}</li>);
        }
        i++;
      }
      out.push(<ul key={key++}>{items}</ul>);
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(<li key={i}>{inline(lines[i].replace(/^\s*\d+[.)]\s+/, ''))}</li>);
        i++;
      }
      out.push(<ol key={key++}>{items}</ol>);
      continue;
    }

    if (line.trim() === '') {
      i++;
      continue;
    }

    const buf: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,3}\s|```|>|\s*[-*]\s+|\s*\d+[.)]\s+|-{3,}\s*$)/.test(lines[i])
    ) {
      buf.push(lines[i++]);
    }
    out.push(<p key={key++}>{buf.map((b, j) => <Fragment key={j}>{j > 0 && <br />}{inline(b)}</Fragment>)}</p>);
  }

  return <div className="md">{out}</div>;
}

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(~~[^~]+~~)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)|(\[[^\]]+\]\([^)\s]+\))|(https?:\/\/[^\s)]+)/g;

function safeHref(url: string) {
  return /^(https?:|mailto:)/i.test(url) ? url : `https://${url}`;
}

function inline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(INLINE)) {
    const idx = m.index ?? 0;
    if (idx > last) nodes.push(text.slice(last, idx));
    const t = m[0];
    if (m[1]) nodes.push(<code key={k++}>{t.slice(1, -1)}</code>);
    else if (m[2]) nodes.push(<strong key={k++}>{inline(t.slice(2, -2))}</strong>);
    else if (m[3]) nodes.push(<s key={k++}>{inline(t.slice(2, -2))}</s>);
    else if (m[4]) nodes.push(<em key={k++}>{inline(t.slice(1, -1))}</em>);
    else if (m[5]) {
      const lm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(t)!;
      nodes.push(
        <a key={k++} href={safeHref(lm[2])} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
          {lm[1]}
        </a>,
      );
    } else if (m[6]) {
      nodes.push(
        <a key={k++} href={t} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
          {t}
        </a>,
      );
    }
    last = idx + t.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}
