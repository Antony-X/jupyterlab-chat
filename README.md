# jupyterlab-chat

A JupyterLab 4 extension that adds a floating chat panel for talking to LLMs (via OpenRouter) with direct read/write access to the active notebook — the assistant can run, edit, insert, and delete cells by emitting special fenced code blocks.

## Features

- Floating, draggable, resizable chat panel (toggle with **Ctrl+Shift+L** or the FAB)
- 7 models: Claude Sonnet 4.6 / Haiku 4.5, GPT-4o / 4o-mini, Gemini 2.5 Flash / 3.1 Flash Lite, DeepSeek V3
- Streaming responses (SSE) with abort
- Markdown + KaTeX math rendering
- Notebook cell actions via fenced blocks:
  - `` ```python-run `` — append and run a new cell
  - `` ```python-edit:N `` — replace source of cell N (1-based), then run
  - `` ```python-insert-after:N `` / `` ```python-insert-before:N `` — insert and run
  - `` ```python-delete:N `` — delete cell N
- Fix button — finds the last kernel error in the notebook and asks the model to fix it (auto-retries up to 3x)
- File attachments (click or drag-drop) — images (vision models) and text
- Session persistence — save/load/export past chats, auto-save on every turn
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
jlpm build           # build extension in watch mode
jlpm build:prod      # production build
```

## Architecture

- **Frontend** (`src/`) — TypeScript, currently vanilla DOM; React + Tailwind + shadcn/prompt-kit on `feat/react-shadcn-prompt-kit`
- **Backend** (`jupyter_chat/`) — Python Tornado handlers:
  - `POST /api/chat/message` — non-streaming chat (used by auto-fix)
  - `POST /api/chat/stream` — SSE streaming chat
  - `GET|DELETE|PUT /api/chat/history` — in-memory conversation
  - `GET|POST|PUT|DELETE /api/chat/sessions` — persisted sessions on disk
- Sessions persist under `.jupyter-chat/` in the Jupyter server's cwd.

## License

MIT
