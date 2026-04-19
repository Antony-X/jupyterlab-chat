import { INotebookTracker } from '@jupyterlab/notebook';
import { ServerConnection } from '@jupyterlab/services';
import { useCallback, useRef, useState } from 'react';
import * as api from '../lib/api';
import { extractCellActions } from '../lib/cell-actions';
import {
  Attachment,
  autoFix,
  executeAction,
  findLastError,
  getContext,
  makeContent,
  userText,
} from '../lib/notebook';

export type DisplayKind = 'user' | 'assistant' | 'status' | 'error' | 'stopped';

export interface DisplayMsg {
  id: string;
  kind: DisplayKind;
  content: any;
  serverIdx?: number;
  originalText?: string;
  pending?: boolean;
}

let uidCounter = 0;
const uid = () => `m_${++uidCounter}_${Date.now()}`;

export interface UseChatOpts {
  settings: ServerConnection.ISettings;
  tracker: INotebookTracker | null;
  initialModel: string;
}

export function useChat(opts: UseChatOpts) {
  const { settings, tracker } = opts;
  const [messages, setMessages] = useState<DisplayMsg[]>([]);
  const [sessions, setSessions] = useState<api.SessionSummary[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState(opts.initialModel);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [sending, setSending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const autoFixRunning = useRef(false);

  const historyToDisplay = useCallback((hist: api.ChatMessage[]): DisplayMsg[] => {
    const out: DisplayMsg[] = [];
    hist.forEach((m, i) => {
      if (m.role === 'system') return;
      if (m.role === 'user') {
        out.push({
          id: uid(),
          kind: 'user',
          content: m.content,
          serverIdx: i,
          originalText: userText(m.content),
        });
      } else {
        out.push({ id: uid(), kind: 'assistant', content: m.content, serverIdx: i });
      }
    });
    return out;
  }, []);

  const refreshFromServer = useCallback(async () => {
    try {
      const hist = await api.getHistory(settings);
      setMessages(historyToDisplay(hist));
    } catch {
      /* ignore */
    }
  }, [settings, historyToDisplay]);

  const autosave = useCallback(async () => {
    try {
      const hist = await api.getHistory(settings);
      if (hist.every(m => m.role === 'system')) return;
      const res = await api.saveSession(
        settings,
        currentSessionId ? { id: currentSessionId } : {}
      );
      if (res.id) setCurrentSessionId(res.id);
    } catch {
      /* ignore */
    }
  }, [settings, currentSessionId]);

  const refreshSessions = useCallback(async () => {
    try {
      setSessions(await api.listSessions(settings));
    } catch {
      setSessions([]);
    }
  }, [settings]);

  const newChat = useCallback(async () => {
    setCurrentSessionId(null);
    try {
      await api.clearHistory(settings);
    } catch {
      /* ignore */
    }
    setMessages([]);
    setAttachments([]);
  }, [settings]);

  const saveChat = useCallback(
    async (title?: string) => {
      try {
        const res = await api.saveSession(settings, {
          id: currentSessionId ?? undefined,
          title: title || undefined,
        });
        if (res.id) setCurrentSessionId(res.id);
        return res.id;
      } catch {
        return null;
      }
    },
    [settings, currentSessionId]
  );

  const loadSessionById = useCallback(
    async (id: string) => {
      try {
        const { messages: srvMsgs } = await api.loadSession(settings, id);
        setCurrentSessionId(id);
        setMessages(historyToDisplay(srvMsgs));
      } catch {
        /* ignore */
      }
    },
    [settings, historyToDisplay]
  );

  const removeSession = useCallback(
    async (id: string) => {
      try {
        await api.deleteSession(settings, id);
      } catch {
        /* ignore */
      }
      if (id === currentSessionId) setCurrentSessionId(null);
      setSessions(prev => prev.filter(s => s.id !== id));
    },
    [settings, currentSessionId]
  );

  const exportMd = useCallback(async () => {
    try {
      const hist = await api.getHistory(settings);
      let md = '# Chat Export\n\n';
      for (const msg of hist) {
        if (msg.role === 'system') continue;
        const role = msg.role === 'user' ? '**You**' : '**Assistant**';
        const c =
          typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content, null, 2);
        md += `### ${role}\n\n${c}\n\n---\n\n`;
      }
      const blob = new Blob([md], { type: 'text/markdown' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `chat-${new Date().toISOString().slice(0, 10)}.md`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      /* ignore */
    }
  }, [settings]);

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const addStatus = useCallback((text: string) => {
    setMessages(prev => [...prev, { id: uid(), kind: 'status', content: text }]);
  }, []);

  const deleteFromIdx = useCallback(
    async (idx: number) => {
      try {
        await api.deleteFromIdx(settings, idx);
        await refreshFromServer();
        autosave();
      } catch {
        /* ignore */
      }
    },
    [settings, refreshFromServer, autosave]
  );

  /**
   * Core send flow — streams an assistant reply, then executes cell actions if any.
   * `textOverride` / `attachmentsOverride` are used for "edit & regen" where the
   * UI path has already been taken.
   */
  const sendMessage = useCallback(
    async (rawText: string, rawAttachments: Attachment[]) => {
      const text = rawText.trim();
      if ((!text && !rawAttachments.length) || sending) return;
      setSending(true);

      const content = makeContent(text, rawAttachments);
      const displayText = text + (rawAttachments.length ? ` [${rawAttachments.length} file(s)]` : '');

      const assistantId = uid();
      setMessages(prev => [
        ...prev,
        { id: uid(), kind: 'user', content, originalText: displayText },
        { id: assistantId, kind: 'assistant', content: 'Thinking…', pending: true },
      ]);

      setAttachments([]);

      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const ctx = getContext(tracker);
      let fullText = '';
      let aborted = false;

      try {
        fullText = await api.chatStream(
          content,
          ctx,
          selectedModel,
          settings,
          ctrl.signal,
          full => {
            setMessages(prev =>
              prev.map(m =>
                m.id === assistantId ? { ...m, content: full, pending: true } : m
              )
            );
          }
        );
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantId ? { ...m, content: fullText, pending: false } : m
          )
        );
      } catch (e: any) {
        if (e?.name === 'AbortError') {
          aborted = true;
          if (fullText) {
            setMessages(prev =>
              prev.map(m =>
                m.id === assistantId
                  ? { ...m, content: fullText + '\n\n*[stopped]*', pending: false }
                  : m
              )
            );
          } else {
            setMessages(prev =>
              prev.map(m =>
                m.id === assistantId
                  ? { ...m, kind: 'stopped', content: '[Stopped]', pending: false }
                  : m
              )
            );
          }
        } else {
          setMessages(prev =>
            prev.map(m =>
              m.id === assistantId
                ? { ...m, kind: 'error', content: 'Error: ' + (e?.message ?? e), pending: false }
                : m
            )
          );
        }
      }

      if (!aborted && tracker && fullText) {
        const actions = extractCellActions(fullText);
        if (actions.length) {
          addStatus(`running ${actions.length} action${actions.length > 1 ? 's' : ''}…`);
          autoFixRunning.current = true;
          try {
            const hasStructural = actions.some(
              a => a.kind === 'delete' || a.kind === 'insert-before' || a.kind === 'insert-after'
            );
            const ordered = hasStructural ? [...actions].reverse() : actions;
            for (const a of ordered) {
              if (a.kind === 'run') {
                await autoFix(
                  tracker,
                  a.code,
                  selectedModel,
                  settings,
                  addStatus,
                  v => {
                    autoFixRunning.current = v;
                  }
                );
              } else {
                const r = await executeAction(tracker, a);
                addStatus(
                  r.error ? `⚠ ${r.label}: ${r.error.split('\n')[0]}` : r.label
                );
              }
            }
          } finally {
            autoFixRunning.current = false;
          }
          addStatus('done');
        }
      }

      setSending(false);
      abortRef.current = null;
      await refreshFromServer();
      autosave();
    },
    [sending, tracker, selectedModel, settings, addStatus, refreshFromServer, autosave]
  );

  const editAndRegen = useCallback(
    async (idx: number, newContent: string) => {
      try {
        await api.deleteFromIdx(settings, idx);
        await refreshFromServer();
      } catch {
        /* ignore */
      }
      await sendMessage(newContent, []);
    },
    [settings, refreshFromServer, sendMessage]
  );

  const fixLastError = useCallback(async () => {
    if (sending) return null;
    const err = findLastError(tracker);
    if (!err) return null;
    const prompt = `Fix the error in Cell ${err.idx + 1}:\n\`\`\`\n${err.error}\n\`\`\``;
    await sendMessage(prompt, []);
    return true;
  }, [sending, tracker, sendMessage]);

  const isAutoFixRunning = useCallback(() => autoFixRunning.current, []);

  return {
    messages,
    sessions,
    currentSessionId,
    selectedModel,
    setSelectedModel,
    attachments,
    setAttachments,
    sending,
    sendMessage,
    abort,
    fixLastError,
    editAndRegen,
    deleteFromIdx,
    newChat,
    saveChat,
    loadSessionById,
    removeSession,
    exportMd,
    refreshFromServer,
    refreshSessions,
    isAutoFixRunning,
  };
}
