import { INotebookTracker } from '@jupyterlab/notebook';
import { useEffect, useState } from 'react';

/**
 * Returns true whenever at least one notebook is open in the lab shell.
 *
 * We watch `tracker.size` (count of tracked notebooks) rather than
 * `tracker.currentWidget`, because the latter flips to null the instant the
 * user focuses a non-notebook tab (File Browser, Launcher, Terminal) — which
 * would yank the chat FAB out from under them on every click-away.
 *
 * Two robustness measures, because the FAB was vanishing intermittently:
 *  - We recompute on `widgetAdded`, `currentChanged`, AND each widget's
 *    `disposed` signal, so no open/close/focus event is missed.
 *  - The HIDE transition is debounced. `tracker.size` can read 0 for a beat
 *    while a notebook widget is being torn down and recreated (kernel
 *    restart, layout restore, hot reload). We confirm it's really empty a
 *    short tick later before hiding, so a transient zero never blanks the FAB.
 */
export function useHasNotebook(tracker: INotebookTracker | null): boolean {
  const [has, setHas] = useState<boolean>(() => !!tracker && tracker.size > 0);

  useEffect(() => {
    if (!tracker) {
      setHas(false);
      return;
    }

    let hideTimer: number | undefined;
    const clearHideTimer = () => {
      if (hideTimer !== undefined) {
        window.clearTimeout(hideTimer);
        hideTimer = undefined;
      }
    };

    const present = () => tracker.size > 0 || !!tracker.currentWidget;

    const recompute = () => {
      if (present()) {
        clearHideTimer();
        setHas(true);
      } else if (hideTimer === undefined) {
        hideTimer = window.setTimeout(() => {
          hideTimer = undefined;
          setHas(present());
        }, 300);
      }
    };

    const disposers: Array<() => void> = [];
    const watch = (widget: any) => {
      const slot = () => recompute();
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
      recompute();
    };
    const onCurrentChanged = () => recompute();

    tracker.widgetAdded.connect(onAdded);
    tracker.currentChanged.connect(onCurrentChanged);
    recompute();

    return () => {
      clearHideTimer();
      tracker.widgetAdded.disconnect(onAdded);
      tracker.currentChanged.disconnect(onCurrentChanged);
      while (disposers.length) disposers.pop()?.();
    };
  }, [tracker]);

  return has;
}
