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

export interface UsageInfo {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  // Dollar cost reported by OpenRouter for providers that expose it.
  // Undefined when the provider didn't supply it — fall back to token counts.
  cost?: number;
  // Anthropic prompt-caching breakdown: tokens billed for writing vs reading
  // the KV cache. Present only when we sent cache_control markers AND the
  // provider forwarded the counters back (Anthropic via OpenRouter).
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  // OpenAI-style nested details (seen on both OpenAI and some OpenRouter
  // responses) — surfaces the cached prefix as `cached_tokens`.
  prompt_tokens_details?: { cached_tokens?: number };
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: any;
  reasoning?: string;
  usage?: UsageInfo;
}

export async function chatSync(
  content: any,
  ctx: string,
  model: string,
  s: ServerConnection.ISettings,
  webSearch = false,
  thinking = false,
  teach = false
): Promise<string> {
  const url = URLExt.join(s.baseUrl, 'api/chat/message');
  const r = await ServerConnection.makeRequest(
    url,
    {
      method: 'POST',
      body: JSON.stringify(
        withClientId({
          content,
          context: ctx,
          model,
          web_search: webSearch,
          thinking,
          teach,
        })
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
  webSearch = false,
  thinking = false,
  onReasoning?: (full: string) => void,
  onUsage?: (u: UsageInfo) => void,
  teach = false
): Promise<{ content: string; reasoning: string; usage?: UsageInfo }> {
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
      withClientId({
        content,
        context: ctx,
        model,
        web_search: webSearch,
        thinking,
        teach,
      })
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
  let fullReasoning = '';
  let sseBuf = '';
  let usage: UsageInfo | undefined;

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
        if (obj.reasoning) {
          fullReasoning += obj.reasoning;
          onReasoning?.(fullReasoning);
        }
        if (obj.token) {
          full += obj.token;
          onToken(full);
        }
        if (obj.usage && typeof obj.usage === 'object') {
          usage = obj.usage as UsageInfo;
          onUsage?.(usage);
        }
      } catch (e) {
        if (e instanceof SyntaxError) continue;
        throw e;
      }
    }
  }
  return { content: full, reasoning: fullReasoning, usage };
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
