import { INotebookTracker, NotebookActions } from '@jupyterlab/notebook';
import { ServerConnection } from '@jupyterlab/services';
import { stripAnsi, truncate } from './utils';
import { CellAction, extractCellActions, extractCodeBlocks } from './cell-actions';
import { chatStream } from './api';
import { AUTO_PREFIX } from './constants';

// When a notebook is bigger than this, getContext switches from "send every
// cell" to a windowed view: the first/last few cells, plus a ±radius window
// around the active cell. Intermediate cells become a single "[… N elided …]"
// marker so the model still understands the shape of the notebook without
// paying the token cost of every cell on every turn.
const FULL_CONTEXT_THRESHOLD = 30;
const CONTEXT_WINDOW_RADIUS = 10;
const CONTEXT_KEEP_HEAD = 2;
const CONTEXT_KEEP_TAIL = 2;

function selectVisibleCells(cells: any[], active: number): Set<number> {
  const total = cells.length;
  const keep = new Set<number>();
  if (total <= FULL_CONTEXT_THRESHOLD) {
    for (let i = 0; i < total; i++) keep.add(i);
    return keep;
  }
  for (let i = 0; i < Math.min(CONTEXT_KEEP_HEAD, total); i++) keep.add(i);
  for (let i = Math.max(0, total - CONTEXT_KEEP_TAIL); i < total; i++) keep.add(i);
  if (active >= 0 && active < total) {
    const lo = Math.max(0, active - CONTEXT_WINDOW_RADIUS);
    const hi = Math.min(total - 1, active + CONTEXT_WINDOW_RADIUS);
    for (let i = lo; i <= hi; i++) keep.add(i);
  }
  // Always include cells whose last execution errored. Otherwise the LLM
  // can't see the failure it's being asked to fix and chases ghosts.
  for (let i = 0; i < total; i++) {
    const outs = cells[i]?.outputs;
    if (Array.isArray(outs) && outs.some((o: any) => o.output_type === 'error')) {
      keep.add(i);
    }
  }
  return keep;
}

export interface RunResult {
  error: string | null;
  cellIdx: number;
}

/**
 * Directory of the currently-active notebook, relative to the Jupyter server
 * root. Empty string means "no active notebook" — the caller should fall
 * back to the server's working directory.
 */
export function getNotebookDir(tracker: INotebookTracker | null): string {
  const w = tracker?.currentWidget;
  if (!w) return '';
  const path = (w.context as any)?.path || '';
  const idx = path.lastIndexOf('/');
  return idx >= 0 ? path.slice(0, idx) : '';
}

export function getContext(
  tracker: INotebookTracker | null,
  recentActions: string[] = []
): string {
  if (!tracker) return '';
  const w = tracker.currentWidget;
  if (!w) return '[No notebook open]';
  const m = w.content.model;
  if (!m) return '';

  const nb = m.toJSON() as any;
  const cells: any[] = nb.cells || [];
  const activeCell = tracker.activeCell;
  let activeIdx = w.content.activeCellIndex;
  if (activeCell) {
    const found = w.content.widgets.indexOf(activeCell as any);
    if (found >= 0) activeIdx = found;
  }
  const totalCells = cells.length;
  const parts: string[] = [];
  if (recentActions.length) {
    parts.push(
      '### RECENT ACTIONS YOU TOOK (most recent last)',
      'These are structural/edit/run actions you emitted on prior turns. The cell list below reflects the notebook AFTER all of them ran. Use this log to anchor your reasoning instead of re-deleting/re-running things.',
      ...recentActions.map(a => `- ${a}`),
      ''
    );
  }
  if (activeIdx >= 0 && activeIdx < totalCells) {
    const ac = cells[activeIdx];
    const acSrc = Array.isArray(ac.source) ? ac.source.join('') : ac.source || '';
    parts.push(
      `### ACTIVE CELL (the cell the user is currently looking at / typing in)`,
      `This is Cell ${activeIdx + 1} of ${totalCells} (type: ${ac.cell_type}).`,
      `When the user says "this cell" / "here" / "what I'm on", they mean THIS one:`,
      '```',
      acSrc,
      '```',
      '',
      `### FULL NOTEBOOK CONTEXT (${totalCells} cells total)`,
      ''
    );
  }

  const visible = selectVisibleCells(cells, activeIdx);
  let i = 0;
  while (i < cells.length) {
    if (!visible.has(i)) {
      let j = i;
      while (j < cells.length && !visible.has(j)) j++;
      const span = j - i;
      parts.push(`[… ${span} cell${span > 1 ? 's' : ''} ${i + 1}–${j} elided …]`, '');
      i = j;
      continue;
    }
    const c = cells[i];
    const src = Array.isArray(c.source) ? c.source.join('') : c.source;
    const marker = i === activeIdx ? ' ← ACTIVE (user is here)' : '';
    parts.push(`[Cell ${i + 1}/${totalCells} – ${c.cell_type}${marker}]`);
    parts.push(src);
    if (c.cell_type === 'code' && c.outputs) {
      for (const o of c.outputs) {
        let t = '';
        if (o.output_type === 'stream')
          t = Array.isArray(o.text) ? o.text.join('') : o.text || '';
        else if (o.data) {
          t = o.data['text/plain'] || '';
          if (Array.isArray(t)) t = t.join('');
        } else if (o.ename) t = `${o.ename}: ${o.evalue}`;
        if (t) parts.push('→ ' + truncate(t));
      }
    }
    parts.push('');
    i++;
  }
  return parts.join('\n');
}

/**
 * Pull the first image output from a notebook cell, returned as a data URI.
 * `oneBasedIdx` matches the numbering used in assistant fenced blocks
 * (`view-image:3` = third cell). Passing `undefined` uses the cell that
 * most recently ran via chat actions — callers wire that in.
 */
export function getCellImageData(
  tracker: INotebookTracker | null,
  oneBasedIdx: number | undefined,
  fallbackZeroIdx?: number
): { dataUri: string; mime: string; cellIdx: number } | null {
  if (!tracker) return null;
  const w = tracker.currentWidget;
  if (!w || !w.content.model) return null;
  const nb = w.content.model.toJSON() as any;
  const cells: any[] = nb.cells || [];

  let zeroIdx: number;
  if (oneBasedIdx !== undefined) {
    zeroIdx = Math.max(0, Math.min(cells.length - 1, oneBasedIdx - 1));
  } else if (fallbackZeroIdx !== undefined) {
    zeroIdx = fallbackZeroIdx;
  } else {
    return null;
  }

  const cell = cells[zeroIdx];
  if (!cell || cell.cell_type !== 'code') return null;

  for (const o of cell.outputs || []) {
    const data = o.data;
    if (!data) continue;
    for (const mime of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) {
      let payload = data[mime];
      if (!payload) continue;
      if (Array.isArray(payload)) payload = payload.join('');
      // notebook outputs store base64 without the data-uri prefix
      const dataUri = payload.startsWith('data:')
        ? payload
        : `data:${mime};base64,${payload}`;
      return { dataUri, mime, cellIdx: zeroIdx };
    }
  }
  return null;
}

/**
 * Pull the full text output of a cell (stream/text/error/traceback) so the
 * model can inspect a cell whose `→` line in context was truncated. Mirrors
 * `getCellImageData` for non-image outputs.
 */
export function getCellTextOutput(
  tracker: INotebookTracker | null,
  oneBasedIdx: number | undefined,
  fallbackZeroIdx?: number
): { text: string; cellIdx: number } | null {
  if (!tracker) return null;
  const w = tracker.currentWidget;
  if (!w || !w.content.model) return null;
  const nb = w.content.model.toJSON() as any;
  const cells: any[] = nb.cells || [];

  let zeroIdx: number;
  if (oneBasedIdx !== undefined) {
    zeroIdx = Math.max(0, Math.min(cells.length - 1, oneBasedIdx - 1));
  } else if (fallbackZeroIdx !== undefined) {
    zeroIdx = fallbackZeroIdx;
  } else {
    return null;
  }

  const cell = cells[zeroIdx];
  if (!cell || cell.cell_type !== 'code') return null;

  const parts: string[] = [];
  for (const o of cell.outputs || []) {
    if (o.output_type === 'stream') {
      const t = Array.isArray(o.text) ? o.text.join('') : o.text || '';
      if (t) parts.push(t);
    } else if (o.output_type === 'error') {
      const tb = Array.isArray(o.traceback) ? stripAnsi(o.traceback.join('\n')) : '';
      parts.push(`${o.ename}: ${o.evalue}\n${tb}`);
    } else if (o.data) {
      let t = o.data['text/plain'] || '';
      if (Array.isArray(t)) t = t.join('');
      if (t) parts.push(t);
    }
  }
  const text = parts.join('\n').trim();
  return { text: text || '(no output)', cellIdx: zeroIdx };
}

export function findLastError(
  tracker: INotebookTracker | null
): { code: string; error: string; idx: number } | null {
  if (!tracker) return null;
  const w = tracker.currentWidget;
  if (!w) return null;
  const m = w.content.model;
  if (!m) return null;
  const nb = m.toJSON() as any;
  const cells: any[] = nb.cells || [];

  for (let i = cells.length - 1; i >= 0; i--) {
    const c = cells[i];
    if (c.cell_type !== 'code') continue;
    for (const o of c.outputs || []) {
      if (o.output_type === 'error') {
        const src = Array.isArray(c.source) ? c.source.join('') : c.source;
        const tb = Array.isArray(o.traceback) ? stripAnsi(o.traceback.join('\n')) : '';
        return { code: src, error: `${o.ename}: ${o.evalue}\n${tb}`, idx: i };
      }
    }
  }
  return null;
}

/**
 * Run a specific cell WITHOUT advancing activeCellIndex.
 *
 * NotebookActions.run advances to the next cell after execution — chaining
 * several of those (e.g. a multi-action response, or the autoFix retry loop)
 * made the scrollbar fight itself: scroll to idx, run, scroll to idx+1,
 * next iteration scrolls back to idx, etc. runCells doesn't advance, and
 * 'smart' alignment skips the scroll entirely when the cell is already in
 * view, so no more back-and-forth.
 */
async function runCellAt(
  w: any,
  idx: number,
  label: string
): Promise<RunResult & { label: string }> {
  const nb = w.content;
  const m = nb.model;
  if (nb.activeCellIndex !== idx) nb.activeCellIndex = idx;
  try { await nb.scrollToItem(idx, 'smart'); } catch (_) { /* best-effort */ }

  const cell = nb.widgets?.[idx];
  const runCells = (NotebookActions as any).runCells;
  if (cell && typeof runCells === 'function') {
    await runCells(nb, [cell], w.sessionContext);
  } else {
    await NotebookActions.run(nb, w.sessionContext);
  }

  const cj = m.cells.get(idx).toJSON() as any;
  for (const o of cj.outputs || []) {
    if (o.output_type === 'error') {
      const tb = Array.isArray(o.traceback) ? stripAnsi(o.traceback.join('\n')) : '';
      return { error: `${o.ename}: ${o.evalue}\n${tb}`, cellIdx: idx, label };
    }
  }
  return { error: null, cellIdx: idx, label };
}

export async function executeAction(
  tracker: INotebookTracker,
  action: CellAction
): Promise<RunResult & { label: string }> {
  const w = tracker.currentWidget;
  if (!w) return { error: 'No notebook', cellIdx: -1, label: action.kind };
  const nb = w.content;
  const m = nb.model;
  if (!m) return { error: 'No model', cellIdx: -1, label: action.kind };
  const sm = m.sharedModel;

  const toZero = (one: number) => Math.max(0, Math.min(sm.cells.length - 1, one - 1));

  if (action.kind === 'delete' && action.index !== undefined) {
    const z = toZero(action.index);
    sm.deleteCell(z);
    return { error: null, cellIdx: z, label: `deleted cell ${action.index}` };
  }

  if (action.kind === 'edit' && action.index !== undefined) {
    const z = toZero(action.index);
    const cell = sm.cells[z];
    const isCode = cell.cell_type === 'code';
    cell.setSource(action.code);
    if (isCode) {
      return runCellAt(w, z, `edited cell ${action.index}`);
    }
    return { error: null, cellIdx: z, label: `edited cell ${action.index} (markdown)` };
  }

  if ((action.kind === 'insert-after' || action.kind === 'insert-before') && action.index !== undefined) {
    const z = toZero(action.index);
    const insertAt = action.kind === 'insert-after' ? z + 1 : z;
    sm.insertCell(insertAt, { cell_type: 'code', source: action.code, metadata: {} });
    return runCellAt(w, insertAt, `inserted cell at ${insertAt + 1}`);
  }

  // default: append + run
  const idx = sm.cells.length;
  sm.insertCell(idx, { cell_type: 'code', source: action.code, metadata: {} });
  return runCellAt(w, idx, `ran new cell ${idx + 1}`);
}

export async function insertAndRun(
  tracker: INotebookTracker,
  code: string,
  replaceIdx?: number
): Promise<RunResult> {
  const w = tracker.currentWidget;
  if (!w) return { error: 'No notebook', cellIdx: -1 };
  const nb = w.content;
  const m = nb.model;
  if (!m) return { error: 'No model', cellIdx: -1 };

  const sm = m.sharedModel;
  let idx: number;
  if (replaceIdx !== undefined && replaceIdx >= 0 && replaceIdx < sm.cells.length) {
    sm.cells[replaceIdx].setSource(code);
    idx = replaceIdx;
  } else {
    idx = sm.cells.length;
    sm.insertCell(idx, { cell_type: 'code', source: code, metadata: {} });
  }
  if (nb.activeCellIndex !== idx) nb.activeCellIndex = idx;
  try { await nb.scrollToItem(idx, 'smart'); } catch (_) { /* best-effort */ }

  const cell = nb.widgets?.[idx];
  const runCells = (NotebookActions as any).runCells;
  if (cell && typeof runCells === 'function') {
    await runCells(nb, [cell], w.sessionContext);
  } else {
    await NotebookActions.run(nb, w.sessionContext);
  }

  const cj = m.cells.get(idx).toJSON() as any;
  for (const o of cj.outputs || []) {
    if (o.output_type === 'error') {
      const tb = Array.isArray(o.traceback) ? stripAnsi(o.traceback.join('\n')) : '';
      return { error: `${o.ename}: ${o.evalue}\n${tb}`, cellIdx: idx };
    }
  }
  return { error: null, cellIdx: idx };
}

export async function autoFix(
  tracker: INotebookTracker,
  code: string,
  model: string,
  s: ServerConnection.ISettings,
  log: (t: string) => void,
  setRunning: (v: boolean) => void,
  signal?: AbortSignal,
  maxRetries = 3
): Promise<void> {
  setRunning(true);
  let cur = code;
  let cellIdx: number | undefined;

  try {
    for (let i = 0; i <= maxRetries; i++) {
      if (signal?.aborted) return;
      const r = await insertAndRun(tracker, cur, cellIdx);
      if (!r.error) return;
      cellIdx = r.cellIdx;
      if (i === maxRetries) {
        log(`⚠ Still failing after ${maxRetries} fixes`);
        return;
      }
      if (signal?.aborted) return;
      log(`⚠ Error — fixing (${i + 1}/${maxRetries})…`);
      const ctx = getContext(tracker);
      let fix = '';
      try {
        fix = await chatStream(
          `${AUTO_PREFIX}Code errored:\n\`\`\`\n${r.error}\n\`\`\`\nProvide ONLY fixed code in one \`\`\`python-run block.`,
          ctx,
          model,
          s,
          signal ?? new AbortController().signal,
          () => { /* discard tokens — autoFix only needs the final text */ }
        );
      } catch (e: any) {
        if (e?.name === 'AbortError') return;
        throw e;
      }
      let blocks = extractCodeBlocks(fix);
      if (!blocks.length) {
        const re = /```(?:python|py)?\n([\s\S]*?)```/g;
        let mm: RegExpExecArray | null;
        while ((mm = re.exec(fix)) !== null) {
          const c = mm[1].trim();
          if (c) blocks.push(c);
        }
      }
      if (!blocks.length) {
        log('⚠ No fixed code returned');
        return;
      }
      cur = blocks[0];
    }
  } finally {
    setRunning(false);
  }
}

export interface Attachment {
  name: string;
  mime: string;
  data: string;
}

// Cap attachment size to keep request bodies sane. Base64 adds ~33% overhead
// so the on-wire payload for an image near the cap is ~13 MB — still enough
// for a large screenshot or plot, and well below typical provider limits.
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export function readFile(f: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    if (f.size > MAX_ATTACHMENT_BYTES) {
      const mb = (f.size / 1024 / 1024).toFixed(1);
      const cap = (MAX_ATTACHMENT_BYTES / 1024 / 1024).toFixed(0);
      reject(new Error(`"${f.name}" is ${mb} MB — max is ${cap} MB.`));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Failed to read "${f.name}"`));
    if (f.type.startsWith('image/')) {
      reader.onload = () =>
        resolve({ name: f.name, mime: f.type, data: reader.result as string });
      reader.readAsDataURL(f);
    } else {
      reader.onload = () =>
        resolve({ name: f.name, mime: f.type || 'text/plain', data: reader.result as string });
      reader.readAsText(f);
    }
  });
}

export function makeContent(text: string, files: Attachment[]): any {
  if (!files.length) return text;
  const parts: any[] = [{ type: 'text', text }];
  for (const f of files) {
    if (f.mime.startsWith('image/')) {
      parts.push({ type: 'image_url', image_url: { url: f.data } });
    } else {
      parts.push({ type: 'text', text: `--- File: ${f.name} ---\n${f.data}` });
    }
  }
  return parts;
}

export function userText(content: any): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return String(content ?? '');
  const texts = content.filter((p: any) => p.type === 'text').map((p: any) => p.text);
  const imgs = content.filter((p: any) => p.type === 'image_url').length;
  return texts.join('\n') + (imgs ? ` [${imgs} image(s)]` : '');
}
