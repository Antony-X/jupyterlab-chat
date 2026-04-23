import { INotebookTracker } from '@jupyterlab/notebook';
import { ServerConnection } from '@jupyterlab/services';
import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../lib/api';
import { extractCellActions } from '../lib/cell-actions';
import {
  Attachment,
  autoFix,
  executeAction,
  findLastError,
  getCellImageData,
  getCellTextOutput,
  getContext,
  getNotebookDir,
  makeContent,
  userText,
} from '../lib/notebook';

import { AUTO_PREFIX } from '../lib/constants';
export { AUTO_PREFIX };

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

interface QueuedSend {
  text: string;
  attachments: Attachment[];
}

export function useChat(opts: UseChatOpts) {
  const { settings, tracker } = opts;
  const [messages, setMessages] = useState<DisplayMsg[]>([]);
  const [sessions, setSessions] = useState<api.SessionSummary[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState(opts.initialModel);
  const [webSearch, setWebSearch] = useState(false);
  // Refs mirror the latest model/web-search so that a sendMessage closure
  // created on a past render (still running when the user drains the queue
  // or when auto-chain follow-ups fire) picks up the current selection
  // instead of the stale render's value.
  const selectedModelRef = useRef(selectedModel);
  const webSearchRef = useRef(webSearch);
  useEffect(() => { selectedModelRef.current = selectedModel; }, [selectedModel]);
  useEffect(() => { webSearchRef.current = webSearch; }, [webSearch]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [sending, setSending] = useState(false);
  // Queue for messages typed while a response is still streaming. We drain
  // FIFO at the end of each send. Kept as a ref so we can append without
  // re-running sendMessage's useCallback.
  const queueRef = useRef<QueuedSend[]>([]);
  const [queuedCount, setQueuedCount] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const autoFixRunning = useRef(false);
  // Rolling log of structural/run actions. Injected into context so the LLM
  // sees what it has already done and stops re-deleting the same cell when
  // the user says "still see errors" — without the breadcrumb the model
  // confabulates from chat history instead of trusting fresh notebook state.
  const recentActionsRef = useRef<string[]>([]);
  const RECENT_ACTIONS_CAP = 10;

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
      const folder = getNotebookDir(tracker);
      const res = await api.saveSession(
        settings,
        currentSessionId
          ? { id: currentSessionId, folder }
          : { folder }
      );
      if (res.id) setCurrentSessionId(res.id);
    } catch {
      /* ignore */
    }
  }, [settings, currentSessionId, tracker]);

  const refreshSessions = useCallback(async () => {
    try {
      setSessions(await api.listSessions(settings, getNotebookDir(tracker)));
    } catch {
      setSessions([]);
    }
  }, [settings, tracker]);

  const newChat = useCallback(async () => {
    setCurrentSessionId(null);
    try {
      await api.clearHistory(settings);
    } catch {
      /* ignore */
    }
    setMessages([]);
    setAttachments([]);
    recentActionsRef.current = [];
    // Drop anything queued from the prior session — otherwise an in-flight
    // stream's drain would leak those messages into the fresh chat.
    queueRef.current = [];
    setQueuedCount(0);
  }, [settings]);

  const saveChat = useCallback(
    async (title?: string) => {
      try {
        const res = await api.saveSession(settings, {
          id: currentSessionId ?? undefined,
          title: title || undefined,
          folder: getNotebookDir(tracker),
        });
        if (res.id) setCurrentSessionId(res.id);
        return res.id;
      } catch {
        return null;
      }
    },
    [settings, currentSessionId, tracker]
  );

  const loadSessionById = useCallback(
    async (id: string) => {
      try {
        const { messages: srvMsgs } = await api.loadSession(
          settings,
          id,
          getNotebookDir(tracker)
        );
        setCurrentSessionId(id);
        setMessages(historyToDisplay(srvMsgs));
        // Drop queue + recent-action breadcrumbs so content from the old
        // session can't leak into the one we just loaded (either via drain
        // or via the context injected on the next send).
        queueRef.current = [];
        setQueuedCount(0);
        recentActionsRef.current = [];
      } catch {
        /* ignore */
      }
    },
    [settings, historyToDisplay, tracker]
  );

  const removeSession = useCallback(
    async (id: string) => {
      try {
        await api.deleteSession(settings, id, getNotebookDir(tracker));
      } catch {
        /* ignore */
      }
      if (id === currentSessionId) setCurrentSessionId(null);
      setSessions(prev => prev.filter(s => s.id !== id));
    },
    [settings, currentSessionId, tracker]
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
   * `depth` tracks auto-chained follow-up turns (currently: `view-image` requests
   * trigger ONE follow-up with the images attached). Capped so the LLM can't
   * loop on itself by re-emitting view-image in the follow-up response.
   */
  const sendMessage = useCallback(
    async (rawText: string, rawAttachments: Attachment[], depth = 0) => {
      const text = rawText.trim();
      if (!text && !rawAttachments.length) return;
      // Clear the visible input on any accepted user send (queue OR immediate)
      // so a queued submit doesn't leave attachments in the tray that would
      // then ride along on the NEXT user message. Auto-chained follow-ups
      // (depth > 0) carry synthetic attachments and must not touch input state.
      if (depth === 0) setAttachments([]);
      // Already streaming: queue and let the in-flight send drain it when
      // it finishes. depth>0 means this is an internal auto-chained call
      // (view-image follow-up) and must bypass the queue.
      if (sending && depth === 0) {
        queueRef.current.push({ text: rawText, attachments: rawAttachments });
        setQueuedCount(queueRef.current.length);
        return;
      }
      setSending(true);

      const content = makeContent(text, rawAttachments);
      const displayText = text + (rawAttachments.length ? ` [${rawAttachments.length} file(s)]` : '');

      const assistantId = uid();
      setMessages(prev => [
        ...prev,
        { id: uid(), kind: 'user', content, originalText: displayText },
        { id: assistantId, kind: 'assistant', content: 'Thinking…', pending: true },
      ]);

      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const ctx = getContext(tracker, recentActionsRef.current);
      let fullText = '';
      let aborted = false;

      try {
        fullText = await api.chatStream(
          content,
          ctx,
          selectedModelRef.current,
          settings,
          ctrl.signal,
          full => {
            setMessages(prev =>
              prev.map(m =>
                m.id === assistantId ? { ...m, content: full, pending: true } : m
              )
            );
          },
          webSearchRef.current
        );
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantId ? { ...m, content: fullText, pending: false } : m
          )
        );
      } catch (e: any) {
        if (e?.name === 'AbortError') {
          aborted = true;
          // Stop also cancels anything the user queued while this was
          // streaming — otherwise queued messages would silently fire through
          // the drain block below, defying Stop's contract.
          if (queueRef.current.length > 0) {
            queueRef.current = [];
            setQueuedCount(0);
          }
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

      let viewImageRequests: Array<{ index?: number }> = [];
      let viewOutputRequests: Array<{ index?: number }> = [];
      let wantsContinue = false;
      let lastRunZeroIdx: number | undefined;
      // When a `run` action appends a cell, we stash its stable cell id so a
      // structural op that fires afterward (the reverse-order loop means
      // inserts/deletes may run AFTER the run) can't strand the index. We
      // re-resolve by id at the end of the loop.
      let runCellId: string | undefined;
      let runActionLogIdx: number | undefined;

      const recordAction = (label: string) => {
        recentActionsRef.current.push(label);
        if (recentActionsRef.current.length > RECENT_ACTIONS_CAP) {
          recentActionsRef.current.shift();
        }
      };

      if (!aborted && tracker && fullText) {
        const actions = extractCellActions(fullText);
        if (actions.length) {
          wantsContinue = actions.some(a => a.kind === 'continue');
          const mutating = actions.filter(
            a => a.kind !== 'view-image' && a.kind !== 'view-output' && a.kind !== 'continue'
          );

          if (mutating.length) {
            addStatus(`running ${mutating.length} action${mutating.length > 1 ? 's' : ''}…`);
          }
          autoFixRunning.current = true;
          try {
            viewImageRequests = actions
              .filter(a => a.kind === 'view-image')
              .map(a => ({ index: a.index }));
            viewOutputRequests = actions
              .filter(a => a.kind === 'view-output')
              .map(a => ({ index: a.index }));

            const hasStructural = mutating.some(
              a => a.kind === 'delete' || a.kind === 'insert-before' || a.kind === 'insert-after'
            );
            const ordered = hasStructural ? [...mutating].reverse() : mutating;
            for (const a of ordered) {
              if (a.kind === 'run') {
                await autoFix(
                  tracker,
                  a.code,
                  selectedModelRef.current,
                  settings,
                  addStatus,
                  v => {
                    autoFixRunning.current = v;
                  },
                  ctrl.signal
                );
                const mdl = tracker.currentWidget?.content.model;
                if (mdl) {
                  const nbJson = mdl.toJSON() as any;
                  const cs: any[] = nbJson.cells || [];
                  if (cs.length > 0) {
                    runCellId = cs[cs.length - 1].id;
                    lastRunZeroIdx = cs.length - 1;
                  } else {
                    lastRunZeroIdx = undefined;
                  }
                }
                recordAction(lastRunZeroIdx !== undefined ? `ran new cell ${lastRunZeroIdx + 1}` : 'ran new cell');
                runActionLogIdx = recentActionsRef.current.length - 1;
              } else {
                const r = await executeAction(tracker, a);
                addStatus(
                  r.error ? `⚠ ${r.label}: ${r.error.split('\n')[0]}` : r.label
                );
                // Keep a structural-op fallback for bare view-image sequences
                // that have no `run` — but the run cell's position (if any)
                // is re-resolved by id after the loop and takes precedence.
                if (r.cellIdx >= 0 && runCellId === undefined) lastRunZeroIdx = r.cellIdx;
                recordAction(r.error ? `${r.label} — errored: ${r.error.split('\n')[0]}` : r.label);
              }
            }

            // Re-resolve the run cell's current position by id. Subsequent
            // structural ops in this loop may have shifted or removed it.
            if (runCellId && tracker.currentWidget?.content.model) {
              const nbJson = tracker.currentWidget.content.model.toJSON() as any;
              const cs: any[] = nbJson.cells || [];
              const found = cs.findIndex((c: any) => c.id === runCellId);
              if (found >= 0) {
                lastRunZeroIdx = found;
                if (runActionLogIdx !== undefined) {
                  recentActionsRef.current[runActionLogIdx] = `ran new cell ${found + 1}`;
                }
              } else {
                lastRunZeroIdx = undefined;
              }
            }
          } finally {
            autoFixRunning.current = false;
          }
          addStatus('done');
        }
      }

      abortRef.current = null;
      await refreshFromServer();
      await autosave();
      setSending(false);

      // Auto-chained follow-ups. Two mechanisms share the same depth counter:
      //   • view-image — LLM asked to see a cell's image output
      //   • continue   — LLM wants to observe post-run notebook state and
      //                  maybe take more action
      // Capped at 5 total hops per original user message so a stuck model
      // can't burn tokens indefinitely. If the user has typed something new
      // and it's sitting in the queue, we break out of the chain so their
      // message fires instead of waiting behind 5 hops.
      const MAX_AGENT_HOPS = 5;
      const userIsWaiting = queueRef.current.length > 0;
      const canAutoChain = tracker && depth < MAX_AGENT_HOPS && !userIsWaiting;

      const wantsView = viewImageRequests.length > 0 || viewOutputRequests.length > 0;
      if (wantsView && canAutoChain) {
        const atts: Attachment[] = [];
        const seenImageCells: number[] = [];
        const outputBlocks: string[] = [];
        const seenOutputCells: number[] = [];

        for (const req of viewImageRequests) {
          const img = getCellImageData(tracker, req.index, lastRunZeroIdx);
          if (!img) continue;
          atts.push({
            name: `cell-${img.cellIdx + 1}.${img.mime.split('/')[1] || 'png'}`,
            mime: img.mime,
            data: img.dataUri,
          });
          seenImageCells.push(img.cellIdx + 1);
        }
        for (const req of viewOutputRequests) {
          const out = getCellTextOutput(tracker, req.index, lastRunZeroIdx);
          if (!out) continue;
          outputBlocks.push(`[cell ${out.cellIdx + 1} output]\n${out.text}\n[/cell ${out.cellIdx + 1} output]`);
          seenOutputCells.push(out.cellIdx + 1);
        }

        if (atts.length || outputBlocks.length) {
          const segments: string[] = [];
          if (atts.length) {
            segments.push(`Image output${atts.length > 1 ? 's' : ''} from cell ${seenImageCells.join(', ')} attached.`);
          }
          if (outputBlocks.length) {
            segments.push(`Full output${outputBlocks.length > 1 ? 's' : ''} for cell ${seenOutputCells.join(', ')}:\n\n${outputBlocks.join('\n\n')}`);
          }
          segments.push('Continue.');
          await sendMessage(`${AUTO_PREFIX}${segments.join('\n\n')}`, atts, depth + 1);
        } else {
          addStatus('⚠ view request: no matching output found');
        }
      } else if (wantsContinue && canAutoChain) {
        // The assistant explicitly opted in to another turn. Fresh notebook
        // context is rebuilt by getContext() on the next send, so outputs
        // from the actions we just ran will be visible.
        await sendMessage(
          `${AUTO_PREFIX}Notebook state updated. Review outputs and decide: continue with more actions, or reply without any action fences to stop.`,
          [],
          depth + 1
        );
      }

      // Drain one queued user message per send cycle. Only the top-level
      // call (depth 0) touches the queue — view-image follow-ups pass
      // through without consuming queued input. Aborted sends skip this
      // entirely (the abort branch also wiped the queue), so Stop is honored.
      if (depth === 0 && !aborted && queueRef.current.length > 0) {
        const next = queueRef.current.shift()!;
        setQueuedCount(queueRef.current.length);
        // Fire-and-forget: this call will flip sending back on and run the
        // same cycle again, draining one more if more arrived in the meantime.
        void sendMessage(next.text, next.attachments);
      }
    },
    [sending, tracker, settings, addStatus, refreshFromServer, autosave]
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
    webSearch,
    setWebSearch,
    attachments,
    setAttachments,
    sending,
    queuedCount,
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
