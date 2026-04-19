import * as React from 'react';
import { Paperclip, Send, Square, Wrench } from 'lucide-react';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { AttachBar } from './AttachBar';
import type { Attachment } from '../../lib/notebook';
import { readFile } from '../../lib/notebook';
import { cn } from '../../lib/utils';

interface Props {
  sending: boolean;
  attachments: Attachment[];
  onAttach: (files: Attachment[]) => void;
  onRemoveAttachment: (idx: number) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  onFix: () => void;
}

export function ChatInput({
  sending,
  attachments,
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

  const submit = () => {
    const v = text.trim();
    if ((!v && !attachments.length) || sending) return;
    setText('');
    onSend(v);
  };

  const handleFiles = async (list: FileList | null) => {
    if (!list) return;
    const atts: Attachment[] = [];
    for (const f of Array.from(list)) {
      atts.push(await readFile(f));
    }
    if (atts.length) onAttach(atts);
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
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (!sending) submit();
            }
          }}
          placeholder="Ask anything… (Enter to send, Shift+Enter for newline)"
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
          {sending ? (
            <Button variant="stop" size="sm" onClick={onStop} title="Stop">
              <Square size={12} fill="currentColor" />
              Stop
            </Button>
          ) : (
            <Button
              variant="default"
              size="sm"
              onClick={submit}
              disabled={!text.trim() && !attachments.length}
              title="Send (Enter)"
            >
              <Send size={13} />
              Send
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
