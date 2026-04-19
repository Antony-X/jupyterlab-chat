import { INotebookTracker } from '@jupyterlab/notebook';
import { useEffect, useState } from 'react';

/**
 * Returns true when there is at least one open notebook (tracker.currentWidget
 * is non-null). Used to hide the chat FAB on the Launcher / non-notebook tabs.
 */
export function useHasNotebook(tracker: INotebookTracker | null): boolean {
  const [has, setHas] = useState<boolean>(() => !!tracker?.currentWidget);

  useEffect(() => {
    if (!tracker) {
      setHas(false);
      return;
    }
    const update = () => setHas(!!tracker.currentWidget);
    update();
    tracker.currentChanged.connect(update);
    tracker.widgetAdded.connect(update);
    return () => {
      tracker.currentChanged.disconnect(update);
      tracker.widgetAdded.disconnect(update);
    };
  }, [tracker]);

  return has;
}
