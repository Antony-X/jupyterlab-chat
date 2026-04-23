import * as React from 'react';
import { MarkdownView } from '../../lib/markdown';

interface Props {
  text: string;
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

export function AssistantMessage({ text, pending }: Props) {
  const cleaned = React.useMemo(() => cleanAssistantText(text), [text]);
  return (
    <div className="self-start max-w-[94%] my-2 animate-fade-in text-ink">
      <MarkdownView text={cleaned} />
      {pending && (
        <span
          className="inline-block w-1.5 h-3 ml-0.5 bg-brand align-middle animate-pulse"
          aria-label="streaming"
        />
      )}
    </div>
  );
}
