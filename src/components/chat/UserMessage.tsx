import * as React from 'react';
import { Pencil, X, Check } from 'lucide-react';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { AUTO_PREFIX } from '../../hooks/useChat';
import { cn } from '../../lib/utils';

interface Props {
  displayText: string;
  content?: any;
  serverIdx?: number;
  onEdit?: (idx: number, newText: string) => void;
  onDelete?: (idx: number) => void;
}

/** Pull image URLs / data URIs out of a multimodal user-content array. */
function extractImages(content: any): string[] {
  if (!Array.isArray(content)) return [];
  const out: string[] = [];
  for (const part of content) {
    if (part?.type === 'image_url' && part.image_url?.url) {
      out.push(part.image_url.url);
    }
  }
  return out;
}

export function UserMessage({ displayText, content, serverIdx, onEdit, onDelete }: Props) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(displayText);
  const [lightbox, setLightbox] = React.useState<string | null>(null);
  const taRef = React.useRef<HTMLTextAreaElement>(null);
  const images = React.useMemo(() => extractImages(content), [content]);
  // Auto follow-ups (the frontend synthesizes these for view-image chains and
  // continue hops) are hidden from the UI — only the images they carry stay
  // visible, so the user still sees what the assistant looked at.
  const isAuto = displayText.startsWith(AUTO_PREFIX);
  const canEdit = !isAuto && serverIdx !== undefined && onEdit && onDelete;
  const visibleText = isAuto ? '' : displayText;

  React.useEffect(() => {
    if (editing && taRef.current) {
      const ta = taRef.current;
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }
  }, [editing]);

  const startEdit = () => {
    setDraft(displayText);
    setEditing(true);
  };
  const cancel = () => setEditing(false);
  const save = () => {
    const v = draft.trim();
    if (!v || serverIdx === undefined) return;
    setEditing(false);
    onEdit?.(serverIdx, v);
  };
  const handleDelete = () => {
    if (serverIdx === undefined) return;
    if (!window.confirm('Delete this message and everything after it?')) return;
    onDelete?.(serverIdx);
  };

  if (editing) {
    return (
      <div className="self-end max-w-[90%] my-2 w-full animate-fade-in">
        <div className="bg-brand-soft/60 border border-brand/30 rounded-lg p-2 shadow-sm">
          <Textarea
            ref={taRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={Math.min(8, Math.max(2, draft.split('\n').length))}
            className="bg-input-bg-2 border-brand/30 text-sm"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
              if (e.key === 'Escape') cancel();
            }}
          />
          <div className="flex justify-end gap-1.5 mt-1.5">
            <Button variant="ghost" size="xs" onClick={cancel}>
              Cancel
            </Button>
            <Button variant="default" size="xs" onClick={save}>
              <Check size={12} /> Save & resend
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="self-end max-w-[90%] my-2 animate-fade-in group relative">
      {images.length > 0 && (
        <div className="flex flex-wrap justify-end gap-1.5 mb-1.5">
          {images.map((src, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setLightbox(src)}
              className={cn(
                'rounded-md overflow-hidden border border-line bg-paper-2',
                'hover:ring-2 hover:ring-brand/50 transition-shadow'
              )}
              title="Click to expand"
            >
              <img
                src={src}
                alt={`attachment ${i + 1}`}
                className="block max-h-40 max-w-[200px] object-cover"
              />
            </button>
          ))}
        </div>
      )}
      {visibleText && (
        <div
          className={cn(
            'bg-brand text-white rounded-lg rounded-br-sm px-3.5 py-2.5',
            'shadow-[0_1px_2px_rgba(0,0,0,.08)] whitespace-pre-wrap break-words',
            'text-sm-plus leading-relaxed font-sans'
          )}
        >
          {visibleText}
        </div>
      )}
      {lightbox && (
        <div
          className="fixed inset-0 z-[10000] bg-black/70 flex items-center justify-center p-6 cursor-zoom-out animate-fade-in"
          onClick={() => setLightbox(null)}
        >
          <img
            src={lightbox}
            alt="expanded"
            className="max-h-[90vh] max-w-[90vw] object-contain rounded shadow-panel"
          />
        </div>
      )}
      {canEdit && (
        <div className="flex justify-end gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={startEdit}
            title="Edit & resend"
            className="text-muted hover:text-ink"
          >
            <Pencil size={12} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleDelete}
            title="Delete from here"
            className="text-muted hover:text-danger"
          >
            <X size={12} />
          </Button>
        </div>
      )}
    </div>
  );
}
