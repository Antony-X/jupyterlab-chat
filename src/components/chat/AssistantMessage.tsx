import * as React from 'react';
import { MarkdownView } from '../../lib/markdown';

interface Props {
  text: string;
  pending?: boolean;
}

export function AssistantMessage({ text, pending }: Props) {
  return (
    <div className="self-start max-w-[94%] my-2 animate-fade-in text-ink">
      <MarkdownView text={text} />
      {pending && (
        <span
          className="inline-block w-1.5 h-3 ml-0.5 bg-brand align-middle animate-pulse"
          aria-label="streaming"
        />
      )}
    </div>
  );
}
