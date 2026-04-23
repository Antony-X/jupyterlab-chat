import * as React from 'react';
import { Paperclip, Send, Square, Wrench } from 'lucide-react';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { AttachBar } from './AttachBar';
import type { Attachment } from '../../lib/notebook';
import { readFile } from '../../lib/notebook';
import { cn } from '../../lib/utils';

// Chars above which a pasted text blob becomes a .txt attachment instead of
// being dumped inline into the textarea. Tuned so normal paragraph pastes
// stay inline but stack traces / file dumps get stashed as attachments.
const LARGE_TEXT_PASTE_THRESHOLD = 3000;

interface SessionUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost?: number;
}

interface Props {
  sending: boolean;
  queuedCount: number;
  attachments: Attachment[];
  sessionUsage: SessionUsage;
  onAttach: (files: Attachment[]) => void;
  onRemoveAttachment: (idx: number) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  onFix: () => void;
}

function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}

export function ChatInput({
  sending,
  queuedCount,
  attachments,
  sessionUsage,
  onAttach,
  onRemoveAttachment,
  onSend,
  onStop,
  onFix,
}: Props) {
  const [text, setText] = React.useState('');
  const [dragOver, setDragOver] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const taRef = React.useRef<HTMLTextAreaElement>(null);

  // Enter always submits, even while the assistant is streaming — the chat
  // hook queues the message and fires it the moment the current send finishes.
  const submit = () => {
    const v = text.trim();
    if (!v && !attachments.length) return;
    setText('');
    onSend(v);
  };

  const handleFiles = async (list: FileList | null) => {
    if (!list) return;
    const atts: Attachment[] = [];
    const failures: string[] = [];
    for (const f of Array.from(list)) {
      try {
        atts.push(await readFile(f));
      } catch (err: any) {
        failures.push(err?.message ?? String(err));
      }
    }
    if (atts.length) onAttach(atts);
    if (failures.length) window.alert(failures.join('\n'));
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const cd = e.clipboardData;
    if (!cd) return;

    const imageFiles: File[] = [];
    for (const it of Array.from(cd.items)) {
      if (it.kind === 'file' && it.type.startsWith('image/')) {
        const f = it.getAsFile();
        if (f) imageFiles.push(f);
      }
    }
    if (imageFiles.length) {
      e.preventDefault();
      const atts: Attachment[] = [];
      const failures: string[] = [];
      for (const f of imageFiles) {
        try {
          atts.push(await readFile(f));
        } catch (err: any) {
          failures.push(err?.message ?? String(err));
        }
      }
      if (atts.length) onAttach(atts);
      if (failures.length) window.alert(failures.join('\n'));
      return;
    }

    const pastedText = cd.getData('text');
    if (pastedText.length >= LARGE_TEXT_PASTE_THRESHOLD) {
      e.preventDefault();
      const name = `pasted-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.txt`;
      onAttach([{ name, mime: 'text/plain', data: pastedText }]);
    }
  };

  React.useEffect(() => {
    // autofocus on mount
    taRef.current?.focus();
  }, []);

  return (
    <div
      className={cn(
        'relative jc-input-accent bg-paper border-t border-line',
        dragOver && 'bg-brand-soft/30'
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={async (e) => {
        e.preventDefault();
        setDragOver(false);
        await handleFiles(e.dataTransfer?.files ?? null);
      }}
    >
      <AttachBar attachments={attachments} onRemove={onRemoveAttachment} />
      <div className="px-3 pt-2 pb-2">
        <Textarea
          ref={taRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={handlePaste}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={
            sending
              ? 'Assistant is replying… (Enter to queue)'
              : 'Ask anything… (Enter to send, Shift+Enter for newline)'
          }
          rows={2}
          className="bg-input-bg-2 min-h-[54px] max-h-[180px] text-sm-plus"
        />
        <div className="flex items-center gap-1.5 mt-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onFix}
            disabled={sending}
            title="Fix last notebook error"
          >
            <Wrench size={13} />
            Fix
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => fileRef.current?.click()}
            disabled={sending}
            title="Attach file(s)"
          >
            <Paperclip size={13} />
            Attach
          </Button>
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={async (e) => {
              await handleFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <div className="flex-1" />
          {sessionUsage.totalTokens > 0 && (
            <span
              className="text-[11px] text-muted font-mono px-1.5 tabular-nums"
              title={
                `Session total: ${sessionUsage.promptTokens} prompt + ` +
                `${sessionUsage.completionTokens} completion` +
                (sessionUsage.cost !== undefined
                  ? ` · $${sessionUsage.cost.toFixed(4)}`
                  : '')
              }
            >
              {fmtTokens(sessionUsage.totalTokens)} tok
              {sessionUsage.cost !== undefined &&
                ` · $${sessionUsage.cost.toFixed(sessionUsage.cost < 0.01 ? 4 : 3)}`}
            </span>
          )}
          {queuedCount > 0 && (
            <span
              className="text-[11px] text-muted px-1.5"
              title={`${queuedCount} queued — will send after current reply`}
            >
              {queuedCount} queued
            </span>
          )}
          {sending && (
            <Button variant="stop" size="sm" onClick={onStop} title="Stop">
              <Square size={12} fill="currentColor" />
              Stop
            </Button>
          )}
          <Button
            variant="default"
            size="sm"
            onClick={submit}
            disabled={!text.trim() && !attachments.length}
            title={sending ? 'Queue (Enter)' : 'Send (Enter)'}
          >
            <Send size={13} />
            {sending ? 'Queue' : 'Send'}
          </Button>
        </div>
      </div>
    </div>
  );
}
