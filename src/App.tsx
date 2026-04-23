import * as React from 'react';
import { INotebookTracker } from '@jupyterlab/notebook';
import { ServerConnection } from '@jupyterlab/services';
import { ensureKatexCss } from './lib/markdown';
import { useChat } from './hooks/useChat';
import { useTheme } from './hooks/useTheme';
import { useKernelErrors } from './hooks/useKernelErrors';
import { useHasNotebook } from './hooks/useHasNotebook';
import { ChatFAB } from './components/chat/ChatFAB';
import { ChatPanel } from './components/chat/ChatPanel';
import { ChatHeader } from './components/chat/ChatHeader';
import { ChatMenu } from './components/chat/ChatMenu';
import { SessionsList } from './components/chat/SessionsList';
import { MessagesList } from './components/chat/MessagesList';
import { ChatInput } from './components/chat/ChatInput';
import { DEFAULT_MODEL } from './constants';
import { cn } from './lib/utils';

export interface AppProps {
  settings: ServerConnection.ISettings;
  tracker: INotebookTracker | null;
  openSignal: { listen: (cb: () => void) => () => void };
}

export function App({ settings, tracker, openSignal }: AppProps) {
  const { theme, toggle: toggleTheme } = useTheme();
  const hasNotebook = useHasNotebook(tracker);
  const [open, setOpen] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [sessionsOpen, setSessionsOpen] = React.useState(false);
  const [notif, setNotif] = React.useState(false);
  const firstOpenRef = React.useRef(true);

  const chat = useChat({ settings, tracker, initialModel: DEFAULT_MODEL });

  // Load KaTeX CSS once.
  React.useEffect(() => {
    ensureKatexCss();
  }, []);

  // External open trigger (command palette, keyboard shortcut)
  React.useEffect(() => {
    return openSignal.listen(() => setOpen((v) => !v));
  }, [openSignal]);

  // On first open: load history; if empty, show sessions panel.
  React.useEffect(() => {
    if (!open || !firstOpenRef.current) return;
    firstOpenRef.current = false;
    (async () => {
      await chat.refreshFromServer();
      await chat.refreshSessions();
    })();
  }, [open, chat]);

  // Clear notification badge when panel opens.
  React.useEffect(() => {
    if (open) setNotif(false);
  }, [open]);

  // Listen for kernel errors — show notification dot if chat is closed.
  // Use refs so the handlers are stable and the effect doesn't re-subscribe
  // on every render (which would double-up iopub listeners).
  const openRef = React.useRef(open);
  React.useEffect(() => {
    openRef.current = open;
  }, [open]);
  const { isAutoFixRunning } = chat;
  const onKernelError = React.useCallback((_ename: string) => {
    if (!openRef.current) setNotif(true);
  }, []);
  useKernelErrors(tracker, onKernelError, isAutoFixRunning);

  // Command & Shift + L binding lives in the plugin entry; here we honor openSignal.
  // Support a local Escape to close.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const handleNew = async () => {
    setMenuOpen(false);
    setSessionsOpen(false);
    await chat.newChat();
  };

  const handleSave = async () => {
    const title = window.prompt('Chat name:', '') ?? undefined;
    if (title === undefined) return;
    await chat.saveChat(title);
  };

  const handleLoad = async () => {
    await chat.refreshSessions();
    setMenuOpen(false);
    setSessionsOpen(true);
  };

  const handleSelectSession = async (id: string) => {
    await chat.loadSessionById(id);
    setSessionsOpen(false);
  };

  const handleDeleteSession = async (id: string) => {
    await chat.removeSession(id);
  };

  const handleSend = (text: string) => {
    chat.sendMessage(text, chat.attachments);
  };

  // Never unmount the root on notebook-tracker flickers — `tracker.size` can
  // briefly transition through false during cell execution / focus changes,
  // and unmounting here would wipe all chat state (messages, open, session).
  // We just hide the FAB so the user can't reopen chat when no notebook is
  // open; the panel itself stays in the tree if it's already open.
  return (
    <div className={cn('jchat-root', theme === 'dark' && 'dark')}>
      {hasNotebook && (
        <ChatFAB
          open={open}
          hasNotification={notif}
          onClick={() => setOpen((v) => !v)}
        />
      )}
      <ChatPanel open={open}>
        {({ onHeaderMouseDown }) => (
          <>
            <ChatHeader
              theme={theme}
              selectedModel={chat.selectedModel}
              onModelChange={chat.setSelectedModel}
              webSearch={chat.webSearch}
              onToggleWebSearch={() => chat.setWebSearch(v => !v)}
              thinking={chat.thinking}
              onToggleThinking={() => chat.setThinking(v => !v)}
              onToggleTheme={toggleTheme}
              onNew={handleNew}
              onToggleSessions={async () => {
                setMenuOpen(false);
                if (!sessionsOpen) await chat.refreshSessions();
                setSessionsOpen((v) => !v);
              }}
              onToggleMenu={() => {
                setSessionsOpen(false);
                setMenuOpen((v) => !v);
              }}
              onClose={() => setOpen(false)}
              onHeaderMouseDown={onHeaderMouseDown}
            />
            {menuOpen && (
              <ChatMenu
                onSave={handleSave}
                onLoad={handleLoad}
                onExport={chat.exportMd}
                onClear={handleNew}
                onClose={() => setMenuOpen(false)}
              />
            )}
            <MessagesList
              messages={chat.messages}
              empty={chat.messages.length === 0 && !sessionsOpen}
              onEdit={chat.editAndRegen}
              onDelete={chat.deleteFromIdx}
            />
            {sessionsOpen && (
              <SessionsList
                sessions={chat.sessions}
                currentId={chat.currentSessionId}
                onSelect={handleSelectSession}
                onDelete={handleDeleteSession}
                onClose={() => setSessionsOpen(false)}
              />
            )}
            <ChatInput
              sending={chat.sending}
              queuedCount={chat.queuedCount}
              attachments={chat.attachments}
              onAttach={(atts) => chat.setAttachments((prev) => [...prev, ...atts])}
              onRemoveAttachment={(i) =>
                chat.setAttachments((prev) => prev.filter((_, idx) => idx !== i))
              }
              onSend={handleSend}
              onStop={chat.abort}
              onFix={() => {
                void chat.fixLastError();
              }}
            />
          </>
        )}
      </ChatPanel>
    </div>
  );
}
