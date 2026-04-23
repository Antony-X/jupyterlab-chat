import { URLExt } from '@jupyterlab/coreutils';
import { ServerConnection } from '@jupyterlab/services';
import { xsrf } from './utils';

// Stable per-tab identifier so the backend keeps our chat buffer separate
// from other open tabs/notebooks. Stored in sessionStorage so an accidental
// refresh (or devtools reload) keeps the server-side in-memory history alive
// for this tab. A brand-new tab gets its own UUID; closing the tab discards it.
const CID_KEY = 'jupyterlab-chat:cid';
function initClientId(): string {
  try {
    const cached = sessionStorage.getItem(CID_KEY);
    if (cached) return cached;
  } catch {
    /* storage disabled (private mode); fall through */
  }
  const fresh =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `c_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  try {
    sessionStorage.setItem(CID_KEY, fresh);
  } catch {
    /* ignore */
  }
  return fresh;
}
const CLIENT_ID: string = initClientId();

function withClientId<T extends object>(body: T): T & { client_id: string } {
  return { ...body, client_id: CLIENT_ID };
}

function cidQuery(extra = ''): string {
  const base = `?client_id=${encodeURIComponent(CLIENT_ID)}`;
  return extra ? `${base}&${extra}` : base;
}

export interface SessionSummary {
  id: string;
  title: string;
  date: string;
  count: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: any;
}

export async function chatSync(
  content: any,
  ctx: string,
  model: string,
  s: ServerConnection.ISettings,
  webSearch = false
): Promise<string> {
  const url = URLExt.join(s.baseUrl, 'api/chat/message');
  const r = await ServerConnection.makeRequest(
    url,
    {
      method: 'POST',
      body: JSON.stringify(
        withClientId({ content, context: ctx, model, web_search: webSearch })
      ),
    },
    s
  );
  const d = await r.json();
  if (d.error) throw new Error(d.error);
  return d.response;
}

export async function chatStream(
  content: any,
  ctx: string,
  model: string,
  s: ServerConnection.ISettings,
  signal: AbortSignal,
  onToken: (full: string) => void,
  webSearch = false
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
    body: JSON.stringify(
      withClientId({ content, context: ctx, model, web_search: webSearch })
    ),
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

export async function getHistory(s: ServerConnection.ISettings): Promise<ChatMessage[]> {
  const url = URLExt.join(s.baseUrl, 'api/chat/history') + cidQuery();
  const r = await ServerConnection.makeRequest(url, {}, s);
  const d = await r.json();
  return d.history || [];
}

export async function clearHistory(s: ServerConnection.ISettings): Promise<void> {
  const url = URLExt.join(s.baseUrl, 'api/chat/history') + cidQuery();
  await ServerConnection.makeRequest(url, { method: 'DELETE' }, s);
}

export async function deleteFromIdx(s: ServerConnection.ISettings, idx: number): Promise<void> {
  const url = URLExt.join(s.baseUrl, 'api/chat/history');
  await ServerConnection.makeRequest(
    url,
    {
      method: 'PUT',
      body: JSON.stringify(withClientId({ action: 'delete_from', index: idx })),
    },
    s
  );
}

export async function listSessions(
  s: ServerConnection.ISettings,
  folder = ''
): Promise<SessionSummary[]> {
  const qs = folder ? `?folder=${encodeURIComponent(folder)}` : '';
  const url = URLExt.join(s.baseUrl, 'api/chat/sessions') + qs;
  const r = await ServerConnection.makeRequest(url, {}, s);
  const d = await r.json();
  return d.sessions || [];
}

export async function loadSession(
  s: ServerConnection.ISettings,
  id: string,
  folder = ''
): Promise<{ messages: ChatMessage[]; title: string }> {
  const url = URLExt.join(s.baseUrl, 'api/chat/sessions');
  const r = await ServerConnection.makeRequest(
    url,
    { method: 'PUT', body: JSON.stringify(withClientId({ id, folder })) },
    s
  );
  const d = await r.json();
  return { messages: d.messages || [], title: d.title || '' };
}

export async function saveSession(
  s: ServerConnection.ISettings,
  opts: { id?: string; title?: string; folder?: string } = {}
): Promise<{ id: string; title: string }> {
  const url = URLExt.join(s.baseUrl, 'api/chat/sessions');
  const r = await ServerConnection.makeRequest(
    url,
    { method: 'POST', body: JSON.stringify(withClientId(opts)) },
    s
  );
  return r.json();
}

export async function deleteSession(
  s: ServerConnection.ISettings,
  id: string,
  folder = ''
): Promise<void> {
  const qs = folder ? `&folder=${encodeURIComponent(folder)}` : '';
  const url =
    URLExt.join(s.baseUrl, 'api/chat/sessions') +
    `?id=${encodeURIComponent(id)}${qs}`;
  await ServerConnection.makeRequest(url, { method: 'DELETE' }, s);
}
