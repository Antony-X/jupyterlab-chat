import { INotebookTracker } from '@jupyterlab/notebook';
import { useEffect } from 'react';

export function useKernelErrors(
  tracker: INotebookTracker | null,
  onError: (ename: string) => void,
  suppress: () => boolean
): void {
  useEffect(() => {
    if (!tracker) return;

    const connect = (widget: any) => {
      if (!widget) return;
      const tryNow = () => {
        const kernel = widget.sessionContext?.session?.kernel;
        if (!kernel) return;
        kernel.iopubMessage.connect((_: any, msg: any) => {
          if (suppress()) return;
          if (msg.header?.msg_type === 'error') {
            onError(msg.content?.ename ?? 'Error');
          }
        });
      };
      if (widget.sessionContext?.session?.kernel) {
        tryNow();
      } else {
        widget.sessionContext?.ready?.then(tryNow);
      }
    };

    connect(tracker.currentWidget);
    const handle = (_: any, widget: any) => connect(widget);
    tracker.currentChanged.connect(handle);
    return () => {
      tracker.currentChanged.disconnect(handle);
    };
  }, [tracker, onError, suppress]);
}
