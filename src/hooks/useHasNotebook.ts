import { INotebookTracker } from '@jupyterlab/notebook';
import { useEffect, useState } from 'react';

/**
 * Returns true when there is at least one open notebook. Used to gate the
 * chat FAB on the Launcher / non-notebook tabs.
 *
 * Subscribes to each tracked notebook's `disposed` signal because closing
 * the last notebook while a non-notebook tab (e.g. Launcher) is focused
 * doesn't always flip currentWidget through currentChanged.
 */
export function useHasNotebook(tracker: INotebookTracker | null): boolean {
  const [has, setHas] = useState<boolean>(() => !!tracker?.currentWidget);

  useEffect(() => {
    if (!tracker) {
      setHas(false);
      return;
    }

    const update = () => setHas(!!tracker.currentWidget);
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
    tracker.currentChanged.connect(update);
    tracker.widgetAdded.connect(onAdded);

    return () => {
      tracker.currentChanged.disconnect(update);
      tracker.widgetAdded.disconnect(onAdded);
      while (disposers.length) disposers.pop()?.();
    };
  }, [tracker]);

  return has;
}
