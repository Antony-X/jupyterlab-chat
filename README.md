# jupyterlab-chat

A floating chat panel for **JupyterLab 4** that lets you talk to LLMs (via [OpenRouter](https://openrouter.ai)) while giving the assistant **direct read/write access to your active notebook** — it can run, edit, insert, and delete cells by emitting a handful of special fenced code blocks.

Pick from 13 models (Claude Opus 4.7, GPT-5.4 Pro, Grok 4.20, DeepSeek V4 Pro/Flash, GPT-5.3 Codex, Gemini 3.1 Pro, and more), see live thinking traces when you want them, queue messages while streaming, and keep every chat session saved per notebook folder.

---

## Features

### Chat
- Floating, draggable, 8-way resizable panel (**Ctrl+Shift+L** or the FAB)
- 10-model picker grouped into top / mid / fast tiers
- Streaming responses with Stop; type another message mid-stream to queue it
- Per-tab isolation — parallel notebook tabs don't cross-contaminate
- Markdown + KaTeX math rendering
- **Copy buttons** on every code block (hover) and on the whole message
- Light / dark theme (persisted)

### Notebook actions
The assistant emits fenced blocks the extension applies directly to your notebook:

| Fence                        | Effect                                           |
| ---------------------------- | ------------------------------------------------ |
| ```` ```python-run ````      | append a new code cell at the end and run it    |
| ```` ```python-edit:N ````   | replace source of cell N (1-based), then run it |
| ```` ```python-insert-after:N ```` / ```` ```python-insert-before:N ```` | insert a new cell and run |
| ```` ```python-delete:N ```` | delete cell N                                    |
| ```` ```view-image:N ````    | assistant inspects the image output of cell N    |
| ```` ```view-output:N ````   | assistant grabs the full untruncated output of N |
| ```` ```continue ````        | assistant asks for another turn (capped at 5)    |

### Assistant power
- **Thinking traces** — brain-icon toggle reveals model reasoning in a collapsible "Thinking" dropdown (OpenRouter `reasoning` param)
- **Web search** — globe-icon toggle appends `:online` for OpenRouter models that support live search
- **Fix** button — finds the last kernel error in the notebook and asks the model to fix it (auto-retries up to 3×, abortable)
- **Agentic loop** — `view-image`, `view-output`, and `continue` let the model investigate outputs and plan multi-step work without your prompting
- **Context windowing** — large notebooks send a head/tail + ±10 around the active cell plus any errored cells, so token use stays bounded

### Productivity
- **Token & cost counter** — per-message footer + rolling session total, live from OpenRouter's usage stream
- **Auto-named sessions** — new sessions titled by a cheap LLM call (Claude Haiku 4.5), no prompts
- **Attachments** — click, drag-drop, or paste images / text files; big pasted text auto-stashes as a `.txt` attachment
- **Edit & regenerate** — edit any past user message; subsequent assistant replies re-generate from there
- **Kernel error badge** — FAB pulses when a cell errors while the panel is closed

---

## Prerequisites
- **JupyterLab 4.x**
- **Python 3.10+**
- An **OpenRouter** account and API key (https://openrouter.ai)
- Node.js (only needed if you're building from source)

## Install

> Not yet published to PyPI — install from source:

```bash
git clone https://github.com/Antony-X/jupyterlab-chat
cd jupyterlab-chat
pip install -e .
jupyter labextension develop . --overwrite
jlpm build:prod
jupyter lab
```

`jlpm` is JupyterLab's wrapped yarn — it's installed alongside `jupyterlab` itself.

### Configure your API key

Either export `OPENROUTER_API_KEY` in your shell, or drop a `.env` file into the directory where you launch `jupyter lab`:

```bash
cp .env.example .env
# then edit .env and paste your key
```

The extension reads `OPENROUTER_API_KEY` from the process environment first, then from `.env` at the Jupyter server's working directory.

---

## Getting started

1. Launch JupyterLab and open any notebook.
2. Press **Ctrl+Shift+L** or click the chat FAB at the bottom-right.
3. Pick a model from the dropdown at the top-left of the panel.
4. Ask a question — the assistant sees your notebook's cells as context.
5. Ask it to *do* something: *"refactor cell 3"*, *"write a test for the function above"*, *"explain the error in cell 5"* — it edits your cells directly.

### Tips
- **Esc** while streaming → stop.
- **Enter** while the assistant is still streaming → your message queues; fires when the current reply finishes.
- Hover a code block in a reply to reveal its copy button.
- Drag the panel header to move. Drag any side or corner to resize (except the top edge, which is the drag target).
- Click the **brain** icon to turn on thinking traces — costs extra tokens but worth it for hard problems.
- Click the **globe** icon for OpenRouter web search (not all models support it).

---

## Architecture

- **Frontend** (`src/`) — React 18 + TypeScript, Tailwind + shadcn/ui primitives, `react-markdown` with KaTeX.
- **Backend** (`jupyter_chat/`) — Python Tornado handlers mounted on the Jupyter server:
  - `POST /api/chat/stream` — SSE streaming chat
  - `POST /api/chat/message` — non-streaming (used internally by auto-fix)
  - `GET | DELETE | PUT /api/chat/history` — in-memory conversation, keyed per client_id
  - `GET | POST | PUT | DELETE /api/chat/sessions` — persisted sessions on disk
- Session files live under `.jupyter-chat/` in the folder of the active notebook. Session ids are validated against `^[0-9_]{1,64}$`; folder paths are clamped to the server root. The `.jupyter-chat/` dir is `.gitignore`'d by default.
- Outbound request history is trimmed to the most recent 40 messages; saved sessions keep everything. Reasoning traces and OpenRouter usage stats are persisted per assistant turn and stripped before re-sending to the provider.

---

## Development

```bash
jlpm build           # dev build (css + lib + labextension)
jlpm build:prod      # production build
jlpm watch:css       # rebuild Tailwind on change
```

After editing Python, **restart** `jupyter lab`. After editing TS/CSS, rebuild and **hard-refresh** the browser (Ctrl+Shift+R) — JupyterLab aggressively caches extension JS.

---

## Troubleshooting

**`No OPENROUTER_API_KEY`** — Your key isn't set. Check `echo $OPENROUTER_API_KEY` (or `$env:OPENROUTER_API_KEY` on PowerShell) and make sure `.env` is in the directory where you ran `jupyter lab`.

**I don't see my new changes** — JupyterLab caches aggressively. Stop the server (Ctrl+C), start it again, then hard-refresh the browser.

**The FAB is missing** — It only shows when a notebook is open. Open any `.ipynb` file.

**Thinking dropdown never appears** — Click the brain icon (it should get a subtle highlight when on), and use a reasoning-capable model — Opus 4.7, Sonnet 4.6, GPT-5.4 Pro, or Gemini 3.1 Pro. Smaller models often return empty reasoning.

**"Error: HTTP 401" or similar** — Your OpenRouter key is invalid or out of credits. Check your [OpenRouter dashboard](https://openrouter.ai).

**Cell changes don't apply** — Make sure you're on the notebook you expect; the chat acts on the *currently-focused* notebook. The status line at the top of the message list shows which cell was touched.

---

## Roadmap / known gaps

- Publish to PyPI so installs don't require a git clone + build
- Undo button for assistant-initiated cell edits / deletes (safety net for bad rewrites)
- Slash commands: `/fix`, `/explain`, `/test`, `/refactor`
- Regenerate-response button (re-ask the last prompt, optionally with a different model)
- Automated tests + CI

Contributions welcome — open an issue or PR on GitHub.

---

## License

MIT — see [LICENSE](LICENSE).
