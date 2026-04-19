import * as React from 'react';
import { FileText, Image as ImageIcon, X } from 'lucide-react';
import type { Attachment } from '../../lib/notebook';
import { cn } from '../../lib/utils';

interface Props {
  attachments: Attachment[];
  onRemove: (idx: number) => void;
}

export function AttachBar({ attachments, onRemove }: Props) {
  if (!attachments.length) return null;
  return (
    <div className="px-3 pt-2 flex flex-wrap gap-1.5 border-t border-line bg-paper-2/40">
      {attachments.map((a, i) => {
        const isImg = a.mime.startsWith('image/');
        return (
          <span
            key={i}
            className={cn(
              'inline-flex items-center gap-1 rounded-full bg-paper border border-line',
              'px-2 py-[3px] text-[11px] text-ink-soft font-sans max-w-[220px]'
            )}
          >
            {isImg ? <ImageIcon size={11} /> : <FileText size={11} />}
            <span className="truncate">{a.name}</span>
            <button
              type="button"
              className="ml-0.5 text-muted hover:text-danger transition-colors"
              onClick={() => onRemove(i)}
              title="Remove"
            >
              <X size={11} />
            </button>
          </span>
        );
      })}
    </div>
  );
}
