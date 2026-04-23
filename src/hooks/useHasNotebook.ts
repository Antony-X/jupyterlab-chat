import { INotebookTracker } from '@jupyterlab/notebook';
import { useEffect, useState } from 'react';

/**
 * Returns true whenever at least one notebook is open anywhere in the lab
 * shell. We check `tracker.size` (count of tracked notebooks) rather than
 * `tracker.currentWidget` because the latter flips to null the instant the
 * user focuses a non-notebook tab (File Browser, Launcher, Terminal) — which
 * would yank the chat panel out from under them every time they click away.
 */
export function useHasNotebook(tracker: INotebookTracker | null): boolean {
  const [has, setHas] = useState<boolean>(() => !!tracker && tracker.size > 0);

  useEffect(() => {
    if (!tracker) {
      setHas(false);
      return;
    }

    const update = () => setHas(tracker.size > 0);
    const disposers: Array<() => void> = [];

    const watch = (widget: any) => {
      const slot = () => update();
      widget.disposed.connect(slot);
      disposers.push(() => {
        try {
          widget.disposed.disconnect(slot);
        } catch {
          /* already disposed */
        }
      });
    };

    tracker.forEach((widget: any) => watch(widget));

    const onAdded = (_: any, widget: any) => {
      watch(widget);
      update();
    };

    update();
    tracker.widgetAdded.connect(onAdded);

    return () => {
      tracker.widgetAdded.disconnect(onAdded);
      while (disposers.length) disposers.pop()?.();
    };
  }, [tracker]);

  return has;
}
