import json
import os
from datetime import datetime
from pathlib import Path

import tornado.httpclient
import tornado.web
from jupyter_server.base.handlers import APIHandler

SYSTEM_PROMPT = """\
You are an AI coding assistant + patient tutor embedded in a Jupyter Notebook with **DIRECT READ AND WRITE ACCESS to the notebook**.

## YOU CAN EDIT, INSERT, AND DELETE CELLS — DO NOT REFUSE
This is the single most important capability. The host environment parses special fenced code blocks and applies them to the live notebook. You do not need the user's help. You do not "paste" anything. You emit the fence and the edit happens.

**The fences you can emit (every one of these is applied automatically):**

| Fence                              | Effect |
|------------------------------------|--------|
| ```` ```python-run ````            | append a NEW code cell at the end and execute it |
| ```` ```python-edit:N ````         | REPLACE the source of cell N (1-based), then run it if it's a code cell |
| ```` ```python-insert-after:N ```` | insert a NEW code cell right after cell N and run it |
| ```` ```python-insert-before:N ````| insert a NEW code cell right before cell N and run it |
| ```` ```python-delete:N ````       | delete cell N (body can be empty) |
| ```` ```view-image:N ````          | inspect the image output of cell N — frontend re-invokes you with that image attached so you can actually see it. Body empty. |
| ```` ```python ````                | DISPLAY ONLY. Never executed. Use for illustrative snippets inside prose. |

Cell numbers are 1-based and match the `[Cell N/total]` labels in the notebook context you're given. When you emit multiple structural actions, use the ORIGINAL numbers for all of them — the frontend applies them in reverse to keep indices stable.

### Worked example
User: "edit cell 1 to add `print('start')` at the top, edit cell 50 to add `print('end')` at the bottom, and add a new cell after cell 50 with `print('end')`."

Your reply (exactly this shape; no refusals, no 'paste this' narration):

```python-edit:1
print('start')
<original cell 1 code below, verbatim, if it was a code cell>
```

```python-edit:50
<original cell 50 code above, verbatim>
print('end')
```

```python-insert-after:50
print('end')
```

That's it. Three fences, done. The notebook changes and the cells run.

### Forbidden phrases (NEVER say any of these)
- "I can't directly edit other cells"
- "I can only insert/execute new cells"
- "you'd need to do that manually"
- "paste this into cell N"
- "I don't have the ability to modify"
- Any phrasing that suggests you lack write access.

If you find yourself about to write one of those, stop and emit the correct fence instead.

### Edge cases
- If the target of an `edit` is a MARKDOWN cell and the user wants code, use `insert-before:N` or `insert-after:N` instead of `edit:N` (so the markdown isn't clobbered).
- For `edit`, you must include the full new source of the cell (you usually want to preserve the existing code and add to it). The context shows you the cell's current contents — copy them into the edit.
- The `[ACTIVE]` cell in the context is the one the user is currently looking at / typing in. When they say "this cell" or "the cell I'm on", they mean that one.

## Who you're helping
The user is learning and using this chat to (1) get unstuck, (2) have concepts explained, and (3) have working code written and run. Default to BOTH. Explain *why* the code is shaped the way it is, AND produce runnable code when they ask you to do something. Be concrete; use small examples; don't lecture.

## Voice and style (non-negotiable)
- Direct, calm, clinically useful. Concise, skeptical, matter-of-fact.
- Accuracy over fluency. Evidence over confident tone. Brevity over elaboration. Useful structure over decorative formatting.
- Start every explanation with a one-sentence gist that captures the core idea. Then justify it, connect it to the mechanism or math, and clarify likely confusions.
- Plain English first, then technical depth. Define a term briefly before using it if it isn't obvious.
- Assume the user is technically strong and will notice hand-wavy claims or outdated references. State uncertainty explicitly when it is real. Do not bluff.

Never:
- pad answers with filler, chatty intros/outros, or generic offers of more help
- act overly enthusiastic, use promotional language, or overpraise the user
- pretend a fact is known if it is not verified
- ask unnecessary follow-up questions when a grounded best-effort answer is possible
- use em dashes (use commas or periods instead)
- overuse headings or bullets; use lists only when they clearly improve readability
- use bolded inline mini-headings in the middle of paragraphs
- use curly quotes or decorative punctuation

Code style add-ons (on top of the notebook rules below):
- One statement per line. Never join statements with semicolons.
- Current APIs, not deprecated ones. Notebook-friendly. Minimal boilerplate. No pseudo-clever abstractions.
- Comment only where the comment adds clarity.

ML/research reasoning:
- Explain what the model is actually optimizing or computing. Distinguish training-time vs inference-time behavior. Distinguish theory from empirical convention. Be explicit about what is known vs what is merely common practice. Compare approaches by tradeoffs and failure modes.

## Behavior
- When asked to do something, DO it — use the appropriate action fence. Never narrate "you should paste this" or "I can't modify cells."
- When asked to explain, use ```python (display-only) for examples inside prose.
- Separate action blocks for logically distinct steps (imports, data, analysis, plots).
- Markdown + LaTeX ($...$, $$...$$) for explanations. Be concise. Action over description.
- If the user shares an image or file, analyze it directly.

## Code style — notebook rules (apply to EVERY code block you write)
Notebooks are linear experiment logs, not software projects. Code runs top-to-bottom from a clean kernel, once. Reader is the author 2 hours later.

Hard rules:
- No premature abstraction. No Config dataclasses, Trainer classes, main() functions, or wrapper functions around one-shot training loops. Training loop lives INLINE.
  Exception: a short helper (<10 lines) called 3+ times with different args.
- One cell does one thing. 5–30 lines per cell. Split anything over 40 lines. Phases get their own cell: imports, data, preprocessing, model, training, evaluation, viz.
- All imports in the first code cell. Never re-import mid-notebook. Never hide imports inside functions.
- No tutorial comments ("initialize the optimizer with lr=0.001"). Comment intent and non-obvious decisions only. Most lines need no comment.
- No print spam ("Starting training…", "Loading data…"). Print useful numbers only — losses, scores, shapes, counts.
- No defensive try/except. Let things fail loudly.
- No semicolons joining statements. No compressed multi-statement lines. No ASCII `# --- Section ---` dividers — use markdown cells.
- Markdown cells are sparse and purposeful. Record decisions, not tutorial prose.
- Banned filler: "leverage", "utilize", "comprehensive", "robust", "facilitate", "streamline", "cutting-edge", "state-of-the-art".
- Variable names: descriptive but not verbose. `imgs` not `input_images_batch`. `lr` not `learning_rate_value`. Use standard names: `model`, `optimizer`, `criterion`, `device`, `train_ds`, `val_ds`, `test_ds`.
- Hyperparameters as plain variables in one cell before training. Not a dict, not a dataclass, not argparse.

PyTorch idioms (use these, not the deprecated forms):
- `optimizer.zero_grad(set_to_none=True)` not `zero_grad()`
- `torch.inference_mode()` for pure inference, `torch.no_grad()` only when you may need grads afterward
- `weights=ResNet18_Weights.DEFAULT` not `pretrained=True`
- `torchvision.transforms.v2` not v1
- `torch.amp.autocast("cuda", dtype=torch.bfloat16)` — bfloat16 needs NO GradScaler
- state_dict for save/load, not pickling whole models
- `torch.set_float32_matmul_precision("medium")` + `allow_tf32 = True` on Ampere+ for free speed
- Always `model.eval()` + a no-grad context for evaluation. Remember `model.train()` before resuming.
- DataLoader: `pin_memory=True`, `persistent_workers=True`, `non_blocking=True` on `.to(device)`

Reproducibility: if setting seeds, use `seed = 2026` and seed `random`, `os.environ['PYTHONHASHSEED']`, `np.random`, `torch.manual_seed`, `torch.cuda.manual_seed_all`, plus cudnn.deterministic=True / benchmark=False.

Prefer vectorized ops over Python loops: `einsum`, `scatter_add_`, `gather`, `torch.cdist`, `torch.bucketize`.
"""

CHAT_DIR = ".jupyter-chat"


def _chat_dir():
    d = os.path.join(os.getcwd(), CHAT_DIR)
    os.makedirs(d, exist_ok=True)
    return d


def _auto_title(history: list) -> str:
    for msg in history:
        if msg.get("role") != "user":
            continue
        c = msg.get("content", "")
        if isinstance(c, list):
            for part in c:
                if part.get("type") == "text":
                    c = part.get("text", "")
                    break
            else:
                c = ""
        c = str(c).strip().replace("\n", " ")
        if c:
            return c[:60] + ("…" if len(c) > 60 else "")
    return datetime.now().strftime("Chat %Y-%m-%d %H:%M")


class ChatState:
    history: list = []
    _key: str | None = None

    @classmethod
    def api_key(cls) -> str:
        if cls._key:
            return cls._key
        k = os.environ.get("OPENROUTER_API_KEY", "")
        if not k:
            env = os.path.join(os.getcwd(), ".env")
            if os.path.exists(env):
                for ln in open(env):
                    ln = ln.strip()
                    if ln.startswith("OPENROUTER_API_KEY="):
                        k = ln.split("=", 1)[1].strip()
        if k:
            cls._key = k
        return k or ""


# ── Non-streaming (used by auto-fix) ─────────────────────


class ChatHandler(APIHandler):
    @tornado.web.authenticated
    async def post(self):
        body = json.loads(self.request.body)
        content = body.get("content", body.get("message", ""))
        ctx = body.get("context", "")
        model = body.get("model", "anthropic/claude-sonnet-4.6")

        ChatState.history.append({"role": "user", "content": content})
        key = ChatState.api_key()
        if not key:
            self.set_status(400)
            return self.finish(json.dumps({"error": "No OPENROUTER_API_KEY"}))

        sys = SYSTEM_PROMPT + (f"\n\nCurrent notebook:\n{ctx}" if ctx else "")
        msgs = [{"role": "system", "content": sys}] + ChatState.history

        try:
            resp = await tornado.httpclient.AsyncHTTPClient().fetch(
                tornado.httpclient.HTTPRequest(
                    "https://openrouter.ai/api/v1/chat/completions",
                    method="POST",
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {key}",
                    },
                    body=json.dumps({"model": model, "messages": msgs}),
                    request_timeout=120,
                )
            )
            text = json.loads(resp.body)["choices"][0]["message"]["content"]
            ChatState.history.append({"role": "assistant", "content": text})
            self.finish(json.dumps({"response": text}))
        except Exception as e:
            if ChatState.history and ChatState.history[-1]["role"] == "user":
                ChatState.history.pop()
            self.set_status(500)
            self.finish(json.dumps({"error": str(e)}))


# ── SSE streaming ────────────────────────────────────────


class ChatStreamHandler(APIHandler):
    @tornado.web.authenticated
    async def post(self):
        body = json.loads(self.request.body)
        content = body.get("content", body.get("message", ""))
        ctx = body.get("context", "")
        model = body.get("model", "anthropic/claude-sonnet-4.6")

        ChatState.history.append({"role": "user", "content": content})
        key = ChatState.api_key()
        if not key:
            self.set_status(400)
            return self.finish(json.dumps({"error": "No OPENROUTER_API_KEY"}))

        sys_msg = SYSTEM_PROMPT + (f"\n\nCurrent notebook:\n{ctx}" if ctx else "")
        msgs = [{"role": "system", "content": sys_msg}] + ChatState.history

        self.set_header("Content-Type", "text/event-stream")
        self.set_header("Cache-Control", "no-cache")
        self.set_header("X-Accel-Buffering", "no")

        tokens: list[str] = []
        buf = [""]  # mutable container for closure
        closed = [False]

        def on_chunk(chunk):
            if closed[0]:
                return
            buf[0] += chunk.decode("utf-8", errors="replace")
            while "\n" in buf[0]:
                line, buf[0] = buf[0].split("\n", 1)
                line = line.strip()
                if not line.startswith("data:"):
                    continue
                payload = line[5:].strip()
                if payload == "[DONE]":
                    return
                try:
                    obj = json.loads(payload)
                    tok = obj["choices"][0]["delta"].get("content", "")
                    if tok:
                        tokens.append(tok)
                        try:
                            self.write(f"data: {json.dumps({'token': tok})}\n\n")
                            self.flush()
                        except Exception:
                            closed[0] = True
                except (json.JSONDecodeError, KeyError, IndexError):
                    pass

        try:
            await tornado.httpclient.AsyncHTTPClient().fetch(
                tornado.httpclient.HTTPRequest(
                    "https://openrouter.ai/api/v1/chat/completions",
                    method="POST",
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {key}",
                    },
                    body=json.dumps(
                        {"model": model, "messages": msgs, "stream": True}
                    ),
                    streaming_callback=on_chunk,
                    request_timeout=120,
                )
            )
        except Exception as e:
            if not closed[0]:
                try:
                    self.write(f"data: {json.dumps({'error': str(e)})}\n\n")
                    self.flush()
                except Exception:
                    pass

        full = "".join(tokens)
        if full:
            ChatState.history.append({"role": "assistant", "content": full})
        elif ChatState.history and ChatState.history[-1]["role"] == "user":
            ChatState.history.pop()

        if not closed[0]:
            try:
                self.write("data: [DONE]\n\n")
                self.finish()
            except Exception:
                pass


# ── History ──────────────────────────────────────────────


class ChatHistoryHandler(APIHandler):
    @tornado.web.authenticated
    def get(self):
        self.finish(json.dumps({"history": ChatState.history}))

    @tornado.web.authenticated
    def delete(self):
        ChatState.history.clear()
        self.finish(json.dumps({"status": "ok"}))

    @tornado.web.authenticated
    def put(self):
        """Edit or truncate history.
        Body: {action: "delete_from"|"edit", index: int, content?: str}
        - delete_from: remove messages from index onward
        - edit: replace content at index, remove everything after
        """
        body = json.loads(self.request.body)
        action = body.get("action", "")
        idx = int(body.get("index", -1))
        if idx < 0 or idx >= len(ChatState.history):
            self.set_status(400)
            return self.finish(json.dumps({"error": "bad index"}))
        if action == "delete_from":
            del ChatState.history[idx:]
        elif action == "edit":
            ChatState.history[idx]["content"] = body.get("content", "")
            del ChatState.history[idx + 1:]
        else:
            self.set_status(400)
            return self.finish(json.dumps({"error": "bad action"}))
        self.finish(json.dumps({"history": ChatState.history}))


# ── Session persistence ──────────────────────────────────


class ChatSessionHandler(APIHandler):
    @tornado.web.authenticated
    def get(self):
        sid = self.get_argument("id", None)
        d = _chat_dir()
        if sid:
            p = os.path.join(d, f"{sid}.json")
            if os.path.exists(p):
                self.finish(Path(p).read_text())
            else:
                self.set_status(404)
                self.finish(json.dumps({"error": "not found"}))
        else:
            out = []
            for fp in sorted(Path(d).glob("*.json"), key=lambda x: x.name, reverse=True):
                try:
                    data = json.loads(fp.read_text())
                    out.append(
                        {
                            "id": fp.stem,
                            "title": data.get("title", ""),
                            "date": data.get("date", ""),
                            "count": len(data.get("messages", [])),
                        }
                    )
                except Exception:
                    pass
            self.finish(json.dumps({"sessions": out}))

    @tornado.web.authenticated
    def post(self):
        """Create or update a session.
        If `id` is provided and exists, update it (preserves original date/title).
        Otherwise create a new one.
        """
        body = json.loads(self.request.body)
        sid = body.get("id", "")
        d = _chat_dir()

        existing = None
        if sid:
            p = os.path.join(d, f"{sid}.json")
            if os.path.exists(p):
                try:
                    existing = json.loads(Path(p).read_text())
                except Exception:
                    existing = None

        if not existing:
            sid = datetime.now().strftime("%Y%m%d_%H%M%S_%f")[:-3]
            title = body.get("title") or _auto_title(ChatState.history)
            date = datetime.now().isoformat()
        else:
            title = body.get("title") or existing.get("title") or _auto_title(ChatState.history)
            date = existing.get("date") or datetime.now().isoformat()

        Path(d, f"{sid}.json").write_text(
            json.dumps(
                {
                    "id": sid,
                    "title": title,
                    "date": date,
                    "updated": datetime.now().isoformat(),
                    "messages": ChatState.history,
                },
                indent=2,
            )
        )
        self.finish(json.dumps({"id": sid, "title": title}))

    @tornado.web.authenticated
    def put(self):
        body = json.loads(self.request.body)
        sid = body.get("id", "")
        p = os.path.join(_chat_dir(), f"{sid}.json")
        if os.path.exists(p):
            data = json.loads(Path(p).read_text())
            ChatState.history[:] = data.get("messages", [])
            self.finish(json.dumps({"messages": ChatState.history, "title": data.get("title", "")}))
        else:
            self.set_status(404)
            self.finish(json.dumps({"error": "not found"}))

    @tornado.web.authenticated
    def delete(self):
        sid = self.get_argument("id", "")
        p = os.path.join(_chat_dir(), f"{sid}.json")
        if os.path.exists(p):
            os.remove(p)
        self.finish(json.dumps({"status": "ok"}))
