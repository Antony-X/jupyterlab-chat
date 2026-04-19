import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { URLExt } from '@jupyterlab/coreutils';
import { ServerConnection } from '@jupyterlab/services';
import { INotebookTracker, NotebookActions } from '@jupyterlab/notebook';
import { marked } from 'marked';

/* ═══════════════════════════════════════════════════════════
   Types & Constants
   ═══════════════════════════════════════════════════════════ */

interface Attachment {
  name: string;
  mime: string;
  data: string;
}
interface RunResult {
  error: string | null;
  cellIdx: number;
}

type CellActionKind = 'run' | 'edit' | 'insert-after' | 'insert-before' | 'delete';
interface CellAction {
  kind: CellActionKind;
  index?: number; // 1-based, as used by the model
  code: string;
}

const MODELS = [
  { id: 'anthropic/claude-sonnet-4.6', label: 'Claude Sonnet 4.6' },
  { id: 'anthropic/claude-haiku-4.5-20251001', label: 'Claude Haiku 4.5' },
  { id: 'openai/gpt-4o', label: 'GPT-4o' },
  { id: 'openai/gpt-4o-mini', label: 'GPT-4o Mini' },
  { id: 'google/gemini-2.5-flash-preview', label: 'Gemini 2.5 Flash' },
  { id: 'google/gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash Lite' },
  { id: 'deepseek/deepseek-chat', label: 'DeepSeek V3' },
];

let autoFixRunning = false;

/* ═══════════════════════════════════════════════════════════
   Utilities
   ═══════════════════════════════════════════════════════════ */

function truncate(s: string, n = 500): string {
  if (s.length <= n) return s;
  const h = Math.floor(n / 2);
  return s.slice(0, h) + '\n…[truncated]…\n' + s.slice(-h);
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

function xsrf(): string {
  const m = document.cookie.match(/(?:^|;\s*)_xsrf=([^;]*)/);
  return m ? decodeURIComponent(m[1]) : '';
}


/* ═══════════════════════════════════════════════════════════
   Notebook helpers
   ═══════════════════════════════════════════════════════════ */

function getContext(tracker: INotebookTracker | null): string {
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

function findLastError(
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

async function executeAction(
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

async function runCellAt(
  w: any,
  idx: number,
  label: string
): Promise<RunResult & { label: string }> {
  const nb = w.content;
  const m = nb.model;
  nb.activeCellIndex = idx;
  try { await nb.scrollToItem(idx); } catch (_) {}
  await NotebookActions.run(nb, w.sessionContext);
  const cj = m.cells.get(idx).toJSON() as any;
  for (const o of cj.outputs || []) {
    if (o.output_type === 'error') {
      const tb = Array.isArray(o.traceback) ? stripAnsi(o.traceback.join('\n')) : '';
      return { error: `${o.ename}: ${o.evalue}\n${tb}`, cellIdx: idx, label };
    }
  }
  return { error: null, cellIdx: idx, label };
}

async function insertAndRun(
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
  nb.activeCellIndex = idx;
  try {
    await nb.scrollToItem(idx);
  } catch (_) {}

  await NotebookActions.run(nb, w.sessionContext);

  const cj = m.cells.get(idx).toJSON() as any;
  for (const o of cj.outputs || []) {
    if (o.output_type === 'error') {
      const tb = Array.isArray(o.traceback) ? stripAnsi(o.traceback.join('\n')) : '';
      return { error: `${o.ename}: ${o.evalue}\n${tb}`, cellIdx: idx };
    }
  }
  return { error: null, cellIdx: idx };
}

function extractCellActions(text: string): CellAction[] {
  const out: CellAction[] = [];
  const re = /```([a-zA-Z-]+)(?::(\d+))?\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const tag = m[1].toLowerCase();
    const idx = m[2] ? parseInt(m[2], 10) : undefined;
    const code = m[3];
    const action = tagToAction(tag);
    if (!action) continue;
    if ((action === 'edit' || action === 'insert-after' || action === 'insert-before' || action === 'delete') && idx === undefined) continue;
    const trimmed = action === 'delete' ? '' : code.trim();
    if (action !== 'delete' && !trimmed) continue;
    out.push({ kind: action, index: idx, code: trimmed });
  }
  return out;
}

function tagToAction(tag: string): CellActionKind | null {
  if (tag === 'python-run' || tag === 'py-run' || tag === 'run') return 'run';
  if (tag === 'python-edit' || tag === 'py-edit' || tag === 'edit') return 'edit';
  if (tag === 'python-insert-after' || tag === 'py-insert-after' || tag === 'insert-after') return 'insert-after';
  if (tag === 'python-insert-before' || tag === 'py-insert-before' || tag === 'insert-before') return 'insert-before';
  if (tag === 'python-delete' || tag === 'py-delete' || tag === 'delete-cell') return 'delete';
  return null;
}

function extractCodeBlocks(text: string): string[] {
  return extractCellActions(text).filter(a => a.kind === 'run').map(a => a.code);
}

/* ═══════════════════════════════════════════════════════════
   API
   ═══════════════════════════════════════════════════════════ */

async function chatSync(
  content: any,
  ctx: string,
  model: string,
  s: ServerConnection.ISettings
): Promise<string> {
  const url = URLExt.join(s.baseUrl, 'api/chat/message');
  const r = await ServerConnection.makeRequest(
    url,
    { method: 'POST', body: JSON.stringify({ content, context: ctx, model }) },
    s
  );
  const d = await r.json();
  if (d.error) throw new Error(d.error);
  return d.response;
}

async function chatStream(
  content: any,
  ctx: string,
  model: string,
  s: ServerConnection.ISettings,
  signal: AbortSignal,
  onToken: (full: string) => void
): Promise<string> {
  const url = URLExt.join(s.baseUrl, 'api/chat/stream');
  const hdrs: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-XSRFToken': xsrf(),
  };
  if (s.token) hdrs['Authorization'] = `token ${s.token}`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: hdrs,
    credentials: 'same-origin',
    body: JSON.stringify({ content, context: ctx, model }),
    signal,
  });
  if (!resp.ok) {
    const e = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
    throw new Error(e.error || `HTTP ${resp.status}`);
  }

  const reader = resp.body!.getReader();
  const dec = new TextDecoder();
  let full = '';
  let sseBuf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    sseBuf += dec.decode(value, { stream: true });
    const lines = sseBuf.split('\n');
    sseBuf = lines.pop()!;
    for (const ln of lines) {
      const t = ln.trim();
      if (!t.startsWith('data:')) continue;
      const p = t.slice(5).trim();
      if (p === '[DONE]') continue;
      try {
        const obj = JSON.parse(p);
        if (obj.error) throw new Error(obj.error);
        if (obj.token) {
          full += obj.token;
          onToken(full);
        }
      } catch (e) {
        if (e instanceof SyntaxError) continue;
        throw e;
      }
    }
  }
  return full;
}

/* ═══════════════════════════════════════════════════════════
   Auto-fix
   ═══════════════════════════════════════════════════════════ */

async function autoFix(
  tracker: INotebookTracker,
  code: string,
  model: string,
  s: ServerConnection.ISettings,
  log: (t: string) => void,
  maxRetries = 3
): Promise<void> {
  autoFixRunning = true;
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
        let mm;
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
    autoFixRunning = false;
  }
}

/* ═══════════════════════════════════════════════════════════
   Markdown rendering
   ═══════════════════════════════════════════════════════════ */

const KATEX_VER = '0.16.11';
let katexReady: Promise<void> | null = null;
function ensureKatex(): Promise<void> {
  if (katexReady) return katexReady;
  katexReady = new Promise<void>((resolve) => {
    const loadScript = (src: string) =>
      new Promise<void>((r) => {
        const s = document.createElement('script');
        s.src = src;
        s.async = true;
        s.onload = () => r();
        s.onerror = () => r();
        document.head.appendChild(s);
      });
    if (!document.querySelector('link[data-jc-katex]')) {
      const l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = `https://cdn.jsdelivr.net/npm/katex@${KATEX_VER}/dist/katex.min.css`;
      l.setAttribute('data-jc-katex', '1');
      document.head.appendChild(l);
    }
    (async () => {
      await loadScript(`https://cdn.jsdelivr.net/npm/katex@${KATEX_VER}/dist/katex.min.js`);
      await loadScript(`https://cdn.jsdelivr.net/npm/katex@${KATEX_VER}/dist/contrib/auto-render.min.js`);
      resolve();
    })();
  });
  return katexReady;
}

function typesetMath(el: HTMLElement) {
  const W = window as any;
  if (W.renderMathInElement) {
    try {
      W.renderMathInElement(el, {
        delimiters: [
          { left: '$$',  right: '$$',  display: true  },
          { left: '\\[', right: '\\]', display: true  },
          { left: '\\(', right: '\\)', display: false },
          { left: '$',   right: '$',   display: false },
        ],
        throwOnError: false,
        ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
        strict: false,
      });
      return;
    } catch { /* fall through */ }
  }
  // Fallback to MathJax if present
  const MJ = W.MathJax;
  if (MJ && MJ.typesetPromise) MJ.typesetPromise([el]).catch(() => {});
  else if (MJ && MJ.Hub) MJ.Hub.Queue(['Typeset', MJ.Hub, el]);
}

function renderMd(text: string, el: HTMLElement) {
  // Stash math blocks so marked doesn't mangle backslashes/underscores inside them.
  const saved: string[] = [];
  const stash = (raw: string) => {
    saved.push(raw);
    return `\u0001MATH${saved.length - 1}\u0001`;
  };
  let p = text;
  p = p.replace(/\\\[([\s\S]*?)\\\]/g, (m) => stash(m));
  p = p.replace(/\\\(([\s\S]*?)\\\)/g, (m) => stash(m));
  p = p.replace(/\$\$([\s\S]*?)\$\$/g, (m) => stash(m));
  p = p.replace(/(^|[^\\])\$([^\$\n]+?)\$/g, (_m, pre, inner) => pre + stash(`$${inner}$`));

  let html = marked.parse(p, { breaks: true }) as string;
  html = html.replace(/\u0001MATH(\d+)\u0001/g, (_, i) => {
    const raw = saved[parseInt(i)];
    return raw
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  });
  html = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  html = html.replace(/\son\w+\s*=\s*["'][^"']*["']/gi, '');
  el.innerHTML = html;

  el.querySelectorAll('pre > code').forEach((code) => {
    const cls = (code as HTMLElement).className;
    const m = /language-(python-run|py-run|run|python-edit|py-edit|edit|python-insert-after|py-insert-after|insert-after|python-insert-before|py-insert-before|insert-before|python-delete|py-delete|delete-cell)(?::(\d+))?/.exec(cls);
    if (!m) return;
    const tag = m[1];
    const idx = m[2];
    const pre = code.parentElement!;
    pre.classList.add('jc-run');
    const badge = document.createElement('span');
    badge.className = 'jc-ran-badge';
    let label = '▶ executed';
    if (tag.includes('edit')) label = idx ? `✎ edit cell ${idx}` : '✎ edit';
    else if (tag.includes('insert-after')) label = idx ? `↳ after cell ${idx}` : '↳ inserted';
    else if (tag.includes('insert-before')) label = idx ? `↱ before cell ${idx}` : '↱ inserted';
    else if (tag.includes('delete')) { label = idx ? `✕ delete cell ${idx}` : '✕ delete'; pre.classList.add('jc-del'); }
    badge.textContent = label;
    pre.appendChild(badge);
  });

  ensureKatex().then(() => typesetMath(el));
}

/* ═══════════════════════════════════════════════════════════
   File handling
   ═══════════════════════════════════════════════════════════ */

function readFile(f: File): Promise<Attachment> {
  return new Promise((resolve) => {
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

function makeContent(text: string, files: Attachment[]): any {
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

/* ═══════════════════════════════════════════════════════════
   Plugin
   ═══════════════════════════════════════════════════════════ */

const plugin: JupyterFrontEndPlugin<void> = {
  id: 'jupyterlab-chat:plugin',
  autoStart: true,
  optional: [INotebookTracker],
  activate: (app: JupyterFrontEnd, tracker: INotebookTracker | null) => {
    const settings = ServerConnection.makeSettings();
    ensureKatex();
    let selectedModel = MODELS[0].id;
    let isOpen = false;
    let sending = false;
    let abortCtrl: AbortController | null = null;
    let attachments: Attachment[] = [];
    let currentSessionId: string | null = null;

    /* ── Toggle button ─────────────────────────────── */
    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'jc-toggle';
    toggleBtn.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
    toggleBtn.title = 'Chat with LLM (Ctrl+Shift+L)';
    document.body.appendChild(toggleBtn);

    /* ── Panel ─────────────────────────────────────── */
    const panel = document.createElement('div');
    panel.id = 'jc-panel';

    // Build model options
    const opts = MODELS.map(
      (m) => `<option value="${m.id}">${m.label}</option>`
    ).join('');

    panel.innerHTML =
      '<div id="jc-header">' +
        '<select id="jc-model">' + opts + '</select>' +
        '<span id="jc-title">Chat</span>' +
        '<div class="jc-hbtns">' +
          '<button id="jc-new-btn" title="New chat">+</button>' +
          '<button id="jc-sess-btn" title="Past chats">\u2630</button>' +
          '<button id="jc-theme-btn" title="Toggle theme">\u263D</button>' +
          '<button id="jc-menu-btn" title="Menu">\u22EE</button>' +
          '<button id="jc-close" title="Close">\u00D7</button>' +
        '</div>' +
      '</div>' +
      '<div id="jc-menu">' +
        '<div class="jc-mi" id="jc-save">Save chat</div>' +
        '<div class="jc-mi" id="jc-load-btn">Load chat</div>' +
        '<div class="jc-mi" id="jc-export">Export .md</div>' +
        '<div class="jc-mi jc-mi-danger" id="jc-clear">Clear history</div>' +
      '</div>' +
      '<div id="jc-sessions"></div>' +
      '<div id="jc-messages"></div>' +
      '<div id="jc-attach-bar"></div>' +
      '<div id="jc-input-area">' +
        '<input type="file" id="jc-file" multiple style="display:none"/>' +
        '<div id="jc-input-row">' +
          '<textarea id="jc-input" placeholder="Ask anything\u2026 (Enter to send)" rows="2"></textarea>' +
        '</div>' +
        '<div id="jc-btn-row">' +
          '<button id="jc-fix" title="Fix last notebook error">Fix</button>' +
          '<button id="jc-attach-btn" title="Attach file">Attach</button>' +
          '<button id="jc-send">Send</button>' +
        '</div>' +
      '</div>' +
      '<div id="jc-resize"></div>';
    document.body.appendChild(panel);

    // Refs
    const headerEl = document.getElementById('jc-header')!;
    const modelSel = document.getElementById('jc-model') as HTMLSelectElement;
    const menuBtn = document.getElementById('jc-menu-btn')!;
    const menuEl = document.getElementById('jc-menu')!;
    const sessionsEl = document.getElementById('jc-sessions')!;
    const messagesEl = document.getElementById('jc-messages')!;
    const attachBar = document.getElementById('jc-attach-bar')!;
    const inputEl = document.getElementById('jc-input') as HTMLTextAreaElement;
    const sendBtn = document.getElementById('jc-send')!;
    const closeBtn = document.getElementById('jc-close')!;
    const fixBtn = document.getElementById('jc-fix')!;
    const attachBtn = document.getElementById('jc-attach-btn')!;
    const fileInput = document.getElementById('jc-file') as HTMLInputElement;
    const resizeEl = document.getElementById('jc-resize')!;

    /* ── Theme ─────────────────────────────────────── */
    const themeBtn = document.getElementById('jc-theme-btn')!;
    const savedTheme = localStorage.getItem('jc-theme') || 'light';
    if (savedTheme === 'dark') panel.classList.add('jc-dark');
    themeBtn.textContent = savedTheme === 'dark' ? '\u2600' : '\u263D';
    themeBtn.addEventListener('click', () => {
      const nowDark = !panel.classList.contains('jc-dark');
      panel.classList.toggle('jc-dark', nowDark);
      themeBtn.textContent = nowDark ? '\u2600' : '\u263D';
      localStorage.setItem('jc-theme', nowDark ? 'dark' : 'light');
    });

    /* ── Initial position (left/top) ───────────────── */
    const initW = 480, initH = 560;
    panel.style.width = initW + 'px';
    panel.style.height = initH + 'px';
    panel.style.left = Math.max(20, window.innerWidth - initW - 20) + 'px';
    panel.style.top = Math.max(20, window.innerHeight - initH - 80) + 'px';

    /* ── Model picker ──────────────────────────────── */
    modelSel.addEventListener('change', () => {
      selectedModel = modelSel.value;
    });

    /* ── Toggle / close ────────────────────────────── */
    let firstOpen = true;
    let animating = false;

    function setAnimOrigin() {
      const br = toggleBtn.getBoundingClientRect();
      const pr = panel.getBoundingClientRect();
      const btnCx = br.left + br.width / 2;
      const btnCy = br.top + br.height / 2;
      const ox = Math.max(0, Math.min(pr.width, btnCx - pr.left));
      const oy = Math.max(0, Math.min(pr.height, btnCy - pr.top));
      panel.style.transformOrigin = `${ox}px ${oy}px`;
    }

    async function openPanel() {
      panel.style.display = 'flex';
      // force reflow so transform-origin applies before class change
      setAnimOrigin();
      panel.offsetHeight;
      panel.classList.remove('jc-closing');
      panel.classList.add('jc-opening');
      animating = true;
      setTimeout(() => {
        panel.classList.remove('jc-opening');
        animating = false;
      }, 320);
      toggleBtn.classList.add('jc-open');

      if (firstOpen) {
        firstOpen = false;
        await refreshFromServer();
        if (!messagesEl.querySelector('.jc-user, .jc-assistant')) {
          await showSessions();
        } else {
          sessionsEl.style.display = 'none';
        }
      }
      inputEl.focus();
    }

    function closePanel() {
      setAnimOrigin();
      panel.classList.remove('jc-opening');
      panel.classList.add('jc-closing');
      toggleBtn.classList.remove('jc-open');
      animating = true;
      setTimeout(() => {
        panel.classList.remove('jc-closing');
        panel.style.display = 'none';
        sessionsEl.style.display = 'none';
        menuEl.style.display = 'none';
        animating = false;
      }, 260);
    }

    async function toggleChat() {
      if (animating) return;
      isOpen = !isOpen;
      if (isOpen) await openPanel();
      else closePanel();
    }
    toggleBtn.addEventListener('click', toggleChat);
    closeBtn.addEventListener('click', () => {
      if (animating) return;
      isOpen = false;
      closePanel();
    });

    /* ── Drag ──────────────────────────────────────── */
    let dragging = false, dragX = 0, dragY = 0;
    headerEl.addEventListener('mousedown', (e: MouseEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'BUTTON' || tag === 'SELECT' || tag === 'OPTION') return;
      dragging = true;
      dragX = e.clientX - panel.offsetLeft;
      dragY = e.clientY - panel.offsetTop;
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e: MouseEvent) => {
      if (dragging) {
        panel.style.left = (e.clientX - dragX) + 'px';
        panel.style.top = (e.clientY - dragY) + 'px';
      }
      if (resizing) {
        panel.style.width = Math.max(320, resizeStartW + e.clientX - resizeStartX) + 'px';
        panel.style.height = Math.max(300, resizeStartH + e.clientY - resizeStartY) + 'px';
      }
    });
    document.addEventListener('mouseup', () => {
      dragging = false;
      resizing = false;
    });

    /* ── Resize ────────────────────────────────────── */
    let resizing = false, resizeStartX = 0, resizeStartY = 0, resizeStartW = 0, resizeStartH = 0;
    resizeEl.addEventListener('mousedown', (e: MouseEvent) => {
      resizing = true;
      resizeStartX = e.clientX;
      resizeStartY = e.clientY;
      resizeStartW = panel.offsetWidth;
      resizeStartH = panel.offsetHeight;
      e.preventDefault();
      e.stopPropagation();
    });

    /* ── Menu ──────────────────────────────────────── */
    menuBtn.addEventListener('click', () => {
      sessionsEl.style.display = 'none';
      menuEl.style.display = menuEl.style.display === 'none' ? 'block' : 'none';
    });

    async function showSessions() {
      menuEl.style.display = 'none';
      const url = URLExt.join(settings.baseUrl, 'api/chat/sessions');
      const r = await ServerConnection.makeRequest(url, {}, settings);
      const data = await r.json();
      sessionsEl.innerHTML = '<div class="jc-sess-head"><span>Past Chats</span><button id="jc-sess-close">\u00D7</button></div>';
      const list = document.createElement('div');
      list.className = 'jc-sess-list';
      if (!data.sessions?.length) {
        list.innerHTML = '<div class="jc-sess-empty">No past chats yet.<br/>Start typing to begin.</div>';
      } else {
        for (const s of data.sessions) {
          const row = document.createElement('div');
          row.className = 'jc-sess-row' + (s.id === currentSessionId ? ' jc-sess-active' : '');
          const title = (s.title || s.id).replace(/[<>&]/g, '');
          row.innerHTML = `<div><b>${title}</b><br/><small>${s.date?.slice(0, 10) || ''} \u00B7 ${s.count} msgs</small></div><button class="jc-sess-del" title="Delete">\u2715</button>`;
          row.addEventListener('click', async (ev) => {
            if ((ev.target as HTMLElement).classList.contains('jc-sess-del')) return;
            const u = URLExt.join(settings.baseUrl, 'api/chat/sessions');
            const resp = await ServerConnection.makeRequest(u, {
              method: 'PUT', body: JSON.stringify({ id: s.id })
            }, settings);
            const d = await resp.json();
            currentSessionId = s.id;
            renderHistory(d.messages || []);
            sessionsEl.style.display = 'none';
          });
          row.querySelector('.jc-sess-del')!.addEventListener('click', async (ev) => {
            ev.stopPropagation();
            const u = URLExt.join(settings.baseUrl, 'api/chat/sessions') + `?id=${s.id}`;
            await ServerConnection.makeRequest(u, { method: 'DELETE' }, settings);
            if (s.id === currentSessionId) currentSessionId = null;
            row.remove();
          });
          list.appendChild(row);
        }
      }
      sessionsEl.appendChild(list);
      sessionsEl.style.display = 'block';
      document.getElementById('jc-sess-close')!.addEventListener('click', () => {
        sessionsEl.style.display = 'none';
      });
    }

    async function autosave() {
      if (!messagesEl.querySelector('.jc-user, .jc-assistant')) return;
      try {
        const url = URLExt.join(settings.baseUrl, 'api/chat/sessions');
        const r = await ServerConnection.makeRequest(url, {
          method: 'POST',
          body: JSON.stringify(currentSessionId ? { id: currentSessionId } : {})
        }, settings);
        const d = await r.json();
        if (d.id) currentSessionId = d.id;
      } catch { /* ignore */ }
    }

    async function newChat() {
      menuEl.style.display = 'none';
      currentSessionId = null;
      await ServerConnection.makeRequest(
        URLExt.join(settings.baseUrl, 'api/chat/history'),
        { method: 'DELETE' }, settings
      );
      messagesEl.innerHTML = '';
      attachments = [];
      renderAttachBar();
      sessionsEl.style.display = 'none';
      inputEl.focus();
    }

    async function refreshFromServer(scrollToBottom = true) {
      const url = URLExt.join(settings.baseUrl, 'api/chat/history');
      const r = await ServerConnection.makeRequest(url, {}, settings);
      const data = await r.json();
      renderHistory(data.history || [], scrollToBottom);
    }

    document.getElementById('jc-save')!.addEventListener('click', async () => {
      menuEl.style.display = 'none';
      const title = prompt('Chat name:', '');
      if (title === null) return;
      const url = URLExt.join(settings.baseUrl, 'api/chat/sessions');
      const r = await ServerConnection.makeRequest(url, {
        method: 'POST', body: JSON.stringify({ title: title || undefined, id: currentSessionId || undefined })
      }, settings);
      const d = await r.json();
      if (d.id) currentSessionId = d.id;
      addStatus('saved');
    });

    document.getElementById('jc-load-btn')!.addEventListener('click', showSessions);
    document.getElementById('jc-new-btn')!.addEventListener('click', newChat);
    document.getElementById('jc-sess-btn')!.addEventListener('click', showSessions);

    // Export
    document.getElementById('jc-export')!.addEventListener('click', async () => {
      menuEl.style.display = 'none';
      const url = URLExt.join(settings.baseUrl, 'api/chat/history');
      const r = await ServerConnection.makeRequest(url, {}, settings);
      const data = await r.json();
      let md = '# Chat Export\n\n';
      for (const msg of data.history || []) {
        const role = msg.role === 'user' ? '**You**' : '**Assistant**';
        const c = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        md += `### ${role}\n\n${c}\n\n---\n\n`;
      }
      const blob = new Blob([md], { type: 'text/markdown' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `chat-${new Date().toISOString().slice(0, 10)}.md`;
      a.click();
      URL.revokeObjectURL(a.href);
      addStatus('📤 Exported');
    });

    // Clear
    document.getElementById('jc-clear')!.addEventListener('click', newChat);

    // Close menu on outside click
    document.addEventListener('click', (e) => {
      if (!menuEl.contains(e.target as Node) && e.target !== menuBtn)
        menuEl.style.display = 'none';
    });

    /* ── File attachment ───────────────────────────── */
    attachBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      if (!fileInput.files) return;
      for (const f of Array.from(fileInput.files)) {
        attachments.push(await readFile(f));
      }
      fileInput.value = '';
      renderAttachBar();
    });

    // Drag & drop on input area
    const inputArea = document.getElementById('jc-input-area')!;
    inputArea.addEventListener('dragover', (e) => {
      e.preventDefault();
      inputArea.classList.add('jc-dragover');
    });
    inputArea.addEventListener('dragleave', () => inputArea.classList.remove('jc-dragover'));
    inputArea.addEventListener('drop', async (e) => {
      e.preventDefault();
      inputArea.classList.remove('jc-dragover');
      if (!e.dataTransfer?.files) return;
      for (const f of Array.from(e.dataTransfer.files)) {
        attachments.push(await readFile(f));
      }
      renderAttachBar();
    });

    function renderAttachBar() {
      attachBar.innerHTML = '';
      if (!attachments.length) {
        attachBar.style.display = 'none';
        return;
      }
      attachBar.style.display = 'flex';
      for (let i = 0; i < attachments.length; i++) {
        const tag = document.createElement('span');
        tag.className = 'jc-attach-tag';
        const isImg = attachments[i].mime.startsWith('image/');
        tag.innerHTML = `${isImg ? '🖼' : '📄'} ${attachments[i].name} <button data-i="${i}">&times;</button>`;
        tag.querySelector('button')!.addEventListener('click', () => {
          attachments.splice(i, 1);
          renderAttachBar();
        });
        attachBar.appendChild(tag);
      }
    }

    /* ── Fix last error button ─────────────────────── */
    fixBtn.addEventListener('click', async () => {
      if (sending) return;
      const err = findLastError(tracker);
      if (!err) {
        addStatus('No errors found in notebook');
        return;
      }
      inputEl.value = `Fix the error in Cell ${err.idx + 1}:\n\`\`\`\n${err.error}\n\`\`\``;
      await sendMessage();
    });

    /* ── Message helpers ───────────────────────────── */
    function addMsg(cls: string, text: string): HTMLDivElement {
      const el = document.createElement('div');
      el.className = `jc-msg ${cls}`;
      el.textContent = text;
      messagesEl.appendChild(el);
      return el;
    }
    function addStatus(t: string) {
      addMsg('jc-status', t);
    }

    function userText(content: any): string {
      if (typeof content === 'string') return content;
      if (!Array.isArray(content)) return String(content ?? '');
      const texts = content.filter((p: any) => p.type === 'text').map((p: any) => p.text);
      const imgs = content.filter((p: any) => p.type === 'image_url').length;
      return texts.join('\n') + (imgs ? ` [${imgs} image(s)]` : '');
    }

    async function deleteFromIdx(idx: number) {
      const url = URLExt.join(settings.baseUrl, 'api/chat/history');
      await ServerConnection.makeRequest(url, {
        method: 'PUT',
        body: JSON.stringify({ action: 'delete_from', index: idx })
      }, settings);
      await refreshFromServer();
      autosave();
    }

    async function editAndRegen(idx: number, newContent: string) {
      const url = URLExt.join(settings.baseUrl, 'api/chat/history');
      // Truncate from this message onward; then send as fresh message
      await ServerConnection.makeRequest(url, {
        method: 'PUT',
        body: JSON.stringify({ action: 'delete_from', index: idx })
      }, settings);
      await refreshFromServer();
      inputEl.value = newContent;
      sendMessage();
    }

    function wrapUserBubble(bubble: HTMLDivElement, idx: number, originalText: string) {
      const wrap = document.createElement('div');
      wrap.className = 'jc-user-wrap';
      const actions = document.createElement('div');
      actions.className = 'jc-msg-actions';
      const editBtn = document.createElement('button');
      editBtn.className = 'jc-act-btn';
      editBtn.title = 'Edit & resend';
      editBtn.textContent = '✎';
      const delBtn = document.createElement('button');
      delBtn.className = 'jc-act-btn';
      delBtn.title = 'Delete from here';
      delBtn.textContent = '✕';
      actions.append(editBtn, delBtn);

      editBtn.addEventListener('click', () => {
        const ta = document.createElement('textarea');
        ta.className = 'jc-edit-area';
        ta.value = originalText;
        ta.rows = Math.min(8, Math.max(2, originalText.split('\n').length));
        const save = document.createElement('button');
        save.className = 'jc-edit-save';
        save.textContent = 'Save & resend';
        const cancel = document.createElement('button');
        cancel.className = 'jc-edit-cancel';
        cancel.textContent = 'Cancel';
        bubble.innerHTML = '';
        const editBox = document.createElement('div');
        editBox.className = 'jc-edit-box';
        const btns = document.createElement('div');
        btns.className = 'jc-edit-btns';
        btns.append(cancel, save);
        editBox.append(ta, btns);
        bubble.appendChild(editBox);
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
        cancel.addEventListener('click', () => {
          bubble.textContent = originalText;
        });
        save.addEventListener('click', () => {
          const v = ta.value.trim();
          if (!v) return;
          editAndRegen(idx, v);
        });
        ta.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save.click();
          if (e.key === 'Escape') cancel.click();
        });
      });

      delBtn.addEventListener('click', () => {
        if (!confirm('Delete this message and everything after it?')) return;
        deleteFromIdx(idx);
      });

      bubble.parentElement!.insertBefore(wrap, bubble);
      wrap.appendChild(bubble);
      wrap.appendChild(actions);
    }

    function renderHistory(messages: any[], scrollToBottom = true) {
      messagesEl.innerHTML = '';
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        if (msg.role === 'system') continue;
        const el = document.createElement('div');
        if (msg.role === 'user') {
          el.className = 'jc-msg jc-user';
          const text = userText(msg.content);
          el.textContent = text;
          messagesEl.appendChild(el);
          wrapUserBubble(el, i, text);
        } else {
          el.className = 'jc-msg jc-assistant';
          renderMd(msg.content, el);
          messagesEl.appendChild(el);
        }
      }
      if (scrollToBottom) messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    /* ── Send message (streaming) ──────────────────── */
    async function sendMessage() {
      const text = inputEl.value.trim();
      if ((!text && !attachments.length) || sending) return;
      sending = true;

      const content = makeContent(text, attachments);
      const displayText =
        text + (attachments.length ? ` [${attachments.length} file(s)]` : '');
      addMsg('jc-user', displayText);
      inputEl.value = '';
      attachments = [];
      renderAttachBar();

      const bubble = addMsg('jc-assistant', 'Thinking\u2026');
      sendBtn.textContent = 'Stop';
      sendBtn.classList.add('jc-stop');

      abortCtrl = new AbortController();
      const ctx = getContext(tracker);
      let fullText = '';
      let aborted = false;

      try {
        fullText = await chatStream(
          content,
          ctx,
          selectedModel,
          settings,
          abortCtrl.signal,
          (full) => {
            renderMd(full, bubble);
          }
        );
        // Final render
        renderMd(fullText, bubble);
      } catch (e: any) {
        if (e.name === 'AbortError') {
          aborted = true;
          if (fullText) {
            renderMd(fullText + '\n\n*[stopped]*', bubble);
          } else {
            bubble.textContent = '[Stopped]';
            bubble.className = 'jc-msg jc-status';
          }
        } else {
          bubble.textContent = 'Error: ' + e.message;
          bubble.className = 'jc-msg jc-error';
        }
      }

      // Execute cell actions emitted by the model.
      if (!aborted && tracker && fullText) {
        const actions = extractCellActions(fullText);
        if (actions.length) {
          addStatus(`running ${actions.length} action${actions.length > 1 ? 's' : ''}…`);
          autoFixRunning = true;
          try {
            // Reverse-order execution keeps 1-based indices stable for structural ops.
            const hasStructural = actions.some(a => a.kind === 'delete' || a.kind === 'insert-before' || a.kind === 'insert-after');
            const ordered = hasStructural ? [...actions].reverse() : actions;
            for (const a of ordered) {
              if (a.kind === 'run') {
                await autoFix(tracker, a.code, selectedModel, settings, addStatus);
              } else {
                const r = await executeAction(tracker, a);
                addStatus(r.error ? `⚠ ${r.label}: ${r.error.split('\n')[0]}` : r.label);
              }
            }
          } finally {
            autoFixRunning = false;
          }
          addStatus('done');
        }
      }

      sending = false;
      abortCtrl = null;
      sendBtn.textContent = 'Send';
      sendBtn.classList.remove('jc-stop');
      // Rebuild from server so past user messages get edit/delete buttons,
      // preserving the user's current scroll position.
      const keepTop = messagesEl.scrollTop;
      await refreshFromServer(false);
      messagesEl.scrollTop = keepTop;
      autosave();
    }

    /* ── Send / Stop button ────────────────────────── */
    sendBtn.addEventListener('click', () => {
      if (sending && abortCtrl) {
        abortCtrl.abort();
      } else {
        sendMessage();
      }
    });
    inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!sending) sendMessage();
      }
    });

    /* ── Keyboard shortcut ─────────────────────────── */
    app.commands.addCommand('jupyterlab-chat:toggle', {
      label: 'Toggle LLM Chat',
      execute: toggleChat,
    });
    app.commands.addKeyBinding({
      command: 'jupyterlab-chat:toggle',
      keys: ['Accel Shift L'],
      selector: 'body',
    });

    /* ── Watch kernel errors (auto-notify) ─────────── */
    if (tracker) {
      tracker.currentChanged.connect((_, widget) => {
        if (!widget) return;
        const tryConnect = () => {
          const kernel = widget.sessionContext?.session?.kernel;
          if (!kernel) return;
          kernel.iopubMessage.connect((_, msg: any) => {
            if (autoFixRunning) return;
            if (msg.header.msg_type === 'error') {
              addStatus(
                `⚠ Error in notebook: ${msg.content.ename}. Click 🔧 to fix.`
              );
              if (!isOpen) {
                toggleBtn.classList.add('jc-has-notif');
              }
            }
          });
        };
        if (widget.sessionContext?.session?.kernel) {
          tryConnect();
        } else {
          widget.sessionContext.ready.then(tryConnect);
        }
      });

      // Also connect to current widget if already open
      if (tracker.currentWidget) {
        const w = tracker.currentWidget;
        const tryNow = () => {
          const kernel = w.sessionContext?.session?.kernel;
          if (!kernel) return;
          kernel.iopubMessage.connect((_, msg: any) => {
            if (autoFixRunning) return;
            if (msg.header.msg_type === 'error') {
              addStatus(
                `⚠ Error in notebook: ${msg.content.ename}. Click 🔧 to fix.`
              );
              if (!isOpen) toggleBtn.classList.add('jc-has-notif');
            }
          });
        };
        if (w.sessionContext?.session?.kernel) tryNow();
        else w.sessionContext.ready.then(tryNow);
      }

      // Clear notification badge when opening chat
      toggleBtn.addEventListener('click', () => {
        toggleBtn.classList.remove('jc-has-notif');
      });
    }

    console.log('jupyterlab-chat activated — Ctrl+Shift+L to toggle');
  }
};

export default plugin;
