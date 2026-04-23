import * as React from 'react';
import { ChevronRight, Brain, Copy, Check } from 'lucide-react';
import { MarkdownView } from '../../lib/markdown';
import type { UsageInfo } from '../../lib/api';
import { cn } from '../../lib/utils';

interface Props {
  text: string;
  reasoning?: string;
  usage?: UsageInfo;
  pending?: boolean;
}

// Side-channel fences (`view-image`, `continue`) are frontend signals with
// empty bodies. Once applied they have no reader value, and leaving them in
// the markdown renders them as empty grey code blocks. Strip them.
const SIDE_CHANNEL_FENCE =
  /```(?:view-image|see-image|look-image|view|view-output|see-output|inspect-output|inspect-cell|continue|observe|next-step)(?::\d+)?\n[\s\S]*?```\s*/g;
function cleanAssistantText(text: string): string {
  return text.replace(SIDE_CHANNEL_FENCE, '').trimEnd();
}

function formatUsage(u: UsageInfo): string {
  const bits: string[] = [];
  if (typeof u.prompt_tokens === 'number') bits.push(`${u.prompt_tokens} in`);
  if (typeof u.completion_tokens === 'number') bits.push(`${u.completion_tokens} out`);
  if (typeof u.cost === 'number' && u.cost > 0) {
    // OpenRouter reports cost in USD. Show 4 decimals for sub-cent precision.
    bits.push(`$${u.cost.toFixed(4)}`);
  }
  return bits.join(' · ');
}

function ThinkingBlock({ reasoning, pending }: { reasoning: string; pending?: boolean }) {
  // Auto-open during the live stream so the user sees the model think in
  // real time; historical messages (pending=false at mount) start collapsed
  // so the chat scrollback isn't dominated by old reasoning dumps.
  const [open, setOpen] = React.useState<boolean>(!!pending);
  return (
    <div className="mb-1.5 rounded-md border border-line/60 bg-paper/60">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={cn(
          'w-full flex items-center gap-1.5 px-2 py-1 text-xs text-muted',
          'hover:text-ink-soft transition-colors'
        )}
      >
        <ChevronRight
          size={12}
          className={cn('transition-transform', open && 'rotate-90')}
        />
        <Brain size={12} />
        <span className="font-medium">
          {pending ? 'Thinking…' : 'Thinking'}
        </span>
        {pending && (
          <span
            className="ml-0.5 inline-block w-1 h-1 rounded-full bg-brand animate-pulse"
            aria-hidden
          />
        )}
      </button>
      {open && (
        <div
          className={cn(
            'px-3 py-2 border-t border-line/60',
            'text-xs leading-relaxed text-muted whitespace-pre-wrap font-mono',
            'max-h-[40vh] overflow-y-auto jc-scroll'
          )}
        >
          {reasoning}
        </div>
      )}
    </div>
  );
}

function CopyMessageButton({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard blocked (insecure context etc.) — silent no-op */
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      className={cn(
        'inline-flex items-center gap-1 text-[11px] text-muted',
        'hover:text-ink-soft transition-colors'
      )}
      title="Copy full message"
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

export function AssistantMessage({ text, reasoning, usage, pending }: Props) {
  const cleaned = React.useMemo(() => cleanAssistantText(text), [text]);
  const showFooter = !pending && (usage || cleaned.length > 0);
  return (
    <div className="self-start max-w-[94%] my-2 animate-fade-in text-ink group">
      {reasoning && <ThinkingBlock reasoning={reasoning} pending={pending} />}
      <MarkdownView text={cleaned} />
      {pending && (
        <span
          className="inline-block w-1.5 h-3 ml-0.5 bg-brand align-middle animate-pulse"
          aria-label="streaming"
        />
      )}
      {showFooter && (
        <div className="mt-1.5 flex items-center gap-3 text-[11px] text-muted">
          {cleaned.length > 0 && <CopyMessageButton text={cleaned} />}
          {usage && <span className="font-mono">{formatUsage(usage)}</span>}
        </div>
      )}
    </div>
  );
}
