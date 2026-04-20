import { INotebookTracker } from '@jupyterlab/notebook';
import { useEffect } from 'react';

/**
 * Subscribe to kernel iopub 'error' messages on the current notebook (and
 * any future current notebook). Each per-kernel slot is tracked so the
 * effect cleanup disconnects them cleanly — without this, StrictMode's
 * double-invocation (and every currentChanged) would leak a handler.
 */
export function useKernelErrors(
  tracker: INotebookTracker | null,
  onError: (ename: string) => void,
  suppress: () => boolean
): void {
  useEffect(() => {
    if (!tracker) return;

    const disposers: Array<() => void> = [];
    const connectedKernels = new WeakSet<object>();

    const attach = (widget: any) => {
      if (!widget) return;
      const bind = () => {
        const kernel = widget.sessionContext?.session?.kernel;
        if (!kernel || connectedKernels.has(kernel)) return;
        connectedKernels.add(kernel);
        const slot = (_: any, msg: any) => {
          if (suppress()) return;
          if (msg.header?.msg_type === 'error') {
            onError(msg.content?.ename ?? 'Error');
          }
        };
        kernel.iopubMessage.connect(slot);
        disposers.push(() => {
          try {
            kernel.iopubMessage.disconnect(slot);
          } catch {
            /* kernel already disposed */
          }
        });
      };
      if (widget.sessionContext?.session?.kernel) {
        bind();
      } else {
        widget.sessionContext?.ready?.then(bind).catch(() => {});
      }
    };

    attach(tracker.currentWidget);
    const onCurrentChanged = (_: any, widget: any) => attach(widget);
    tracker.currentChanged.connect(onCurrentChanged);

    return () => {
      tracker.currentChanged.disconnect(onCurrentChanged);
      while (disposers.length) disposers.pop()?.();
    };
  }, [tracker, onError, suppress]);
}
