# jupyterlab-chat

A JupyterLab 4 extension that adds a floating chat panel for talking to LLMs (via OpenRouter) with **direct read/write access to the active notebook** — the assistant can run, edit, insert, and delete cells by emitting special fenced code blocks.

## Features

- Floating, draggable, **8-way resizable** chat panel (toggle with **Ctrl+Shift+L** or the FAB)
- 10-model picker grouped by tier (April 2026 lineup): Claude Opus 4.7 / Sonnet 4.6 / Haiku 4.5, GPT-5.4 Pro / 5.4 / Nano, Gemini 3.1 Pro / Flash Lite, Grok 4.20 / 4.1 Fast
- Streaming (SSE) responses with Stop; pending messages can be **queued while a reply is still streaming**
- Markdown + KaTeX math rendering
- Notebook actions via fenced code blocks:
  - `` ```python-run `` — append and run a new cell
  - `` ```python-edit:N `` — replace source of cell N (1-based), then run
  - `` ```python-insert-after:N `` / `` ```python-insert-before:N `` — insert and run
  - `` ```python-delete:N `` — delete cell N
  - `` ```view-image:N `` — assistant asks to see cell N's image output; frontend re-invokes the model with the image attached
  - `` ```view-output:N `` — assistant asks for the full untruncated text/error output of cell N
  - `` ```continue `` — assistant requests another turn to observe post-action state (capped at 5 hops per user message)
- **Agentic loop** — `view-image` / `view-output` / `continue` let the model investigate outputs and plan multi-step work without user prompting
- **Fix** button — finds the last kernel error and asks the model to fix it (auto-retries up to 3x, abortable)
- **Web-search toggle** — appends OpenRouter's `:online` suffix for models that support live web lookups
- File attachments — click, drag-drop, or paste; images (sent to vision models), text files, and large pasted text stashed as `.txt` attachments
- Session persistence — save / load / export past chats, auto-save on every turn, one store per notebook folder
- **Per-tab isolation** — each browser tab gets its own `client_id`, so parallel notebook tabs don't cross-contaminate
- Edit and regenerate user messages; delete-from-here truncation
- Kernel error listener — FAB pulses when an error occurs while the panel is closed
- Light / dark theme (persisted)

## Install

```bash
pip install -e .
jupyter labextension develop . --overwrite
jlpm build
jupyter lab
```

Set your OpenRouter API key via environment variable or a `.env` file at Jupyter's cwd:

```bash
cp .env.example .env
# then edit .env and put your real key
```

## Development

```bash
jlpm build           # dev build (css + lib + labextension)
jlpm build:prod      # production build
jlpm watch:css       # rebuild CSS on change
```

## Architecture

- **Frontend** (`src/`) — React 18 + TypeScript, Tailwind + shadcn/ui primitives, `react-markdown` with KaTeX
- **Backend** (`jupyter_chat/`) — Python Tornado handlers:
  - `POST /api/chat/message` — non-streaming chat (used by auto-fix)
  - `POST /api/chat/stream` — SSE streaming chat
  - `GET | DELETE | PUT /api/chat/history` — in-memory conversation for a given `client_id`
  - `GET | POST | PUT | DELETE /api/chat/sessions` — persisted sessions on disk
- Sessions persist under `.jupyter-chat/` in the folder of the active notebook (falls back to the server cwd). Path traversal is blocked: session ids must match `^[0-9_]{1,64}$` and folder paths must stay under the server root.
- Outbound request history is trimmed to the most recent 40 messages; the on-disk session keeps everything.

## License

MIT — see [LICENSE](LICENSE).
