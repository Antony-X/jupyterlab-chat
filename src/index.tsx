import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin,
} from '@jupyterlab/application';
import { INotebookTracker } from '@jupyterlab/notebook';
import { ServerConnection } from '@jupyterlab/services';
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import { App } from './App';

/**
 * Minimal signal hub so the plugin can ask React to toggle the panel from
 * a command / keybinding without lifting state out of the React tree.
 */
function makeToggleSignal() {
  const listeners = new Set<() => void>();
  return {
    fire: () => listeners.forEach((cb) => cb()),
    listen: (cb: () => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

const plugin: JupyterFrontEndPlugin<void> = {
  id: 'jupyterlab-chat:plugin',
  autoStart: true,
  optional: [INotebookTracker],
  activate: (app: JupyterFrontEnd, tracker: INotebookTracker | null) => {
    const settings = ServerConnection.makeSettings();
    const toggleSignal = makeToggleSignal();

    // Mount the React app into a detached container appended to <body>.
    // Using document.body — not a JupyterLab dock panel — because the product
    // identity is a free-floating, draggable overlay.
    const host = document.createElement('div');
    host.id = 'jupyterlab-chat-host';
    document.body.appendChild(host);

    const root = ReactDOM.createRoot(host);
    root.render(
      <App
        settings={settings}
        tracker={tracker}
        openSignal={{ listen: toggleSignal.listen }}
      />
    );

    // Command + keyboard shortcut.
    app.commands.addCommand('jupyterlab-chat:toggle', {
      label: 'Toggle LLM Chat',
      execute: () => toggleSignal.fire(),
    });
    app.commands.addKeyBinding({
      command: 'jupyterlab-chat:toggle',
      keys: ['Accel Shift L'],
      selector: 'body',
    });

    // eslint-disable-next-line no-console
    console.log('jupyterlab-chat activated — Ctrl+Shift+L to toggle');
  },
};

export default plugin;
