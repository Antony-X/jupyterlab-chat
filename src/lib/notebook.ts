import { INotebookTracker, NotebookActions } from '@jupyterlab/notebook';
import { ServerConnection } from '@jupyterlab/services';
import { stripAnsi, truncate } from './utils';
import { CellAction, extractCellActions, extractCodeBlocks } from './cell-actions';
import { chatSync } from './api';

export interface RunResult {
  error: string | null;
  cellIdx: number;
}

export function getContext(tracker: INotebookTracker | null): string {
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

  for (let i = 0; i < cells.length; i++) {
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
  }
  return parts.join('\n');
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
  maxRetries = 3
): Promise<void> {
  setRunning(true);
  let cur = code;
  let cellIdx: number | undefined;

  try {
    for (let i = 0; i <= maxRetries; i++) {
      const r = await insertAndRun(tracker, cur, cellIdx);
      if (!r.error) return;
      cellIdx = r.cellIdx;
      if (i === maxRetries) {
        log(`⚠ Still failing after ${maxRetries} fixes`);
        return;
      }
      log(`⚠ Error — fixing (${i + 1}/${maxRetries})…`);
      const ctx = getContext(tracker);
      const fix = await chatSync(
        `Code errored:\n\`\`\`\n${r.error}\n\`\`\`\nProvide ONLY fixed code in one \`\`\`python-run block.`,
        ctx,
        model,
        s
      );
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

export function readFile(f: File): Promise<Attachment> {
  return new Promise(resolve => {
    const reader = new FileReader();
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
