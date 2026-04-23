import json
import os
import re
from collections import OrderedDict
from datetime import datetime
from pathlib import Path

import tornado.httpclient
import tornado.web
from jupyter_server.base.handlers import APIHandler

# Session ids are generated as datetime.strftime("%Y%m%d_%H%M%S_%f")[:-3],
# so the legitimate shape is strictly digits + underscore. Validating against
# this before letting `sid` hit the filesystem blocks path traversal
# ("../../etc/hosts") and absolute paths ("/etc/passwd") from escaping the
# per-folder sandbox — `_chat_dir(folder)` already guards `folder` similarly
# but leaves `sid` unprotected on its own.
_SID_RE = re.compile(r"^[0-9_]{1,64}$")


def _safe_sid(sid: str) -> str:
    if not sid or not _SID_RE.match(sid):
        raise tornado.web.HTTPError(400, "bad id")
    return sid

# Rolling window for what we actually send to the model. The full on-disk
# history is untouched; only the OUTBOUND request is trimmed. Keeps latency
# and the uncached portion of cost bounded on long chats.
HISTORY_WINDOW = 40

# LRU cap on the per-client in-memory history dict. Prevents unbounded
# growth as new tabs / page loads accumulate over the life of the server.
MAX_CLIENTS = 50

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
| ```` ```view-output:N ````         | get the full untruncated text/error output of cell N — frontend re-invokes you with the output appended. Use this whenever the `→ ...` line in context is truncated and you need the full text (long traceback, big DataFrame, multi-line print). Body empty. |
| ```` ```continue ````              | request one more turn after your actions run. Frontend re-invokes you with the notebook's updated state so you can observe outputs and decide next steps. Body empty. |
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

### The notebook context block IS the live state — trust it
The `[Cell N/total]` blocks you receive on every turn reflect the live notebook AFTER any actions you took on prior turns. If you deleted cell 4 last turn, the block this turn will not include the old cell 4, and the cells that were after it will have shifted up.

Hard rules:
- DO NOT run `print(...)`, `len(In)`, or any kernel introspection code to "check" the notebook state. The context block already shows it. Running diagnostic code wastes a cell and produces a stale answer.
- If the context shows a "RECENT ACTIONS YOU TOOK" log at the top, those are the structural changes you've already applied. Believe them. Do not redo work the log says you already did.
- If a cell's `→` output line is truncated and you genuinely need the full text/traceback, emit `view-output:N` rather than guessing from the truncated form or re-running the cell.
- If the user says "I still see X" but the context shows X is gone, tell them to refresh / share what they see — do not silently re-apply the same fix expecting a different result.

### Agentic continuation — `continue` fence (use sparingly)
End your response with an empty ```` ```continue``` ```` fence ONLY when your next step genuinely depends on what the last action produced — e.g. the code might fail in a non-obvious way, the output shape is unknown and affects what you do next, you ran code that renders an image and want to view it, or you're doing a multi-step investigation that can't be planned upfront.

DO use continue:
- after code that generates a plot or image you need to verify (combine with `view-image:N`)
- when debugging: run, see the error/output, decide whether to patch or give up
- iterative data exploration where step N+1 depends on step N's output

DON'T use continue:
- for straightforward one-shot tasks ("write a function to X" — just write it)
- when the user asked a question you can answer without needing to see output
- when your code obviously succeeds and the job is done
- to "check your work" when there is nothing genuinely uncertain

Cap: 5 continuations per user message. After that the frontend stops auto-invoking you. Use your budget wisely — each continue burns a turn.

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


def _read_env_var(path: str, name: str) -> str:
    """Pull a single variable out of a .env file.

    Handles the common dialect quirks: blank lines, comments, leading
    `export`, single/double-quoted values, and trailing inline comments.
    Returns "" if the variable isn't present or the file can't be read.
    """
    try:
        with open(path, encoding="utf-8") as fh:
            for raw in fh:
                ln = raw.strip()
                if not ln or ln.startswith("#"):
                    continue
                if ln.startswith("export "):
                    ln = ln[len("export "):].lstrip()
                if "=" not in ln:
                    continue
                key, _, val = ln.partition("=")
                if key.strip() != name:
                    continue
                val = val.strip()
                # Strip trailing inline comments BEFORE unwrapping quotes —
                # otherwise `KEY="sk" # note` leaves val[-1] as the comment's
                # last char, the quote-match fails, and we return the literal
                # `"sk"` (quotes and all) which breaks auth downstream.
                hash_pos = val.find(" #")
                if hash_pos >= 0:
                    val = val[:hash_pos].rstrip()
                if len(val) >= 2 and val[0] == val[-1] and val[0] in ('"', "'"):
                    return val[1:-1]
                return val
    except OSError:
        pass
    return ""


def _chat_dir(folder: str = "") -> str:
    """Resolve the per-folder `.jupyter-chat/` directory.

    When `folder` is provided it's interpreted as a path relative to the
    Jupyter server root. We refuse anything that escapes the root (absolute
    paths, `..` traversal) and fall back to the server cwd in that case —
    so a compromised frontend can't read/write outside the notebook tree.
    """
    root = os.path.abspath(os.getcwd())
    base = root
    if folder:
        cand = os.path.abspath(os.path.join(root, folder))
        if cand == root or cand.startswith(root + os.sep):
            base = cand
    d = os.path.join(base, CHAT_DIR)
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
    # Per-client histories keyed on a UUID the frontend picks at mount.
    # OrderedDict so we can do LRU eviction: every read/write move_to_end's
    # the key, and when we exceed MAX_CLIENTS we pop the oldest entry. Keeps
    # the process from slowly leaking memory as tabs / refreshes pile up.
    _histories: "OrderedDict[str, list]" = OrderedDict()
    _key: str | None = None

    @classmethod
    def history(cls, client_id: str) -> list:
        if not client_id:
            client_id = "default"
        if client_id in cls._histories:
            cls._histories.move_to_end(client_id)
        else:
            cls._histories[client_id] = []
            while len(cls._histories) > MAX_CLIENTS:
                cls._histories.popitem(last=False)
        return cls._histories[client_id]

    @classmethod
    def set_history(cls, client_id: str, hist: list) -> None:
        cid = client_id or "default"
        cls._histories[cid] = hist
        cls._histories.move_to_end(cid)
        while len(cls._histories) > MAX_CLIENTS:
            cls._histories.popitem(last=False)

    @classmethod
    def api_key(cls) -> str:
        if cls._key:
            return cls._key
        k = os.environ.get("OPENROUTER_API_KEY", "")
        if not k:
            env = os.path.join(os.getcwd(), ".env")
            if os.path.exists(env):
                k = _read_env_var(env, "OPENROUTER_API_KEY")
        if k:
            cls._key = k
        return k or ""


# ── Non-streaming (used by auto-fix) ─────────────────────


def _trim_for_request(hist: list) -> list:
    """Return the tail of `hist` that we actually send to the model.

    Keeps the most recent HISTORY_WINDOW messages, but if the window would
    start on an assistant turn we shift back by one so the model always sees
    a clean user→assistant pairing at the start of the window.
    """
    if len(hist) <= HISTORY_WINDOW:
        return hist
    start = len(hist) - HISTORY_WINDOW
    if start > 0 and hist[start].get("role") == "assistant":
        start -= 1
    return hist[start:]


def _apply_web_search(model: str, web_search: bool) -> str:
    """OpenRouter enables its built-in web plugin when a model slug ends in
    ':online'. We append it only when the toggle is on and it isn't already
    part of the slug."""
    if web_search and not model.endswith(":online"):
        return f"{model}:online"
    return model


class ChatHandler(APIHandler):
    @tornado.web.authenticated
    async def post(self):
        body = json.loads(self.request.body)
        client_id = body.get("client_id") or "default"
        content = body.get("content", body.get("message", ""))
        ctx = body.get("context", "")
        model = body.get("model", "anthropic/claude-sonnet-4.6")
        web_search = bool(body.get("web_search", False))
        model = _apply_web_search(model, web_search)

        hist = ChatState.history(client_id)
        hist.append({"role": "user", "content": content})
        key = ChatState.api_key()
        if not key:
            self.set_status(400)
            return self.finish(json.dumps({"error": "No OPENROUTER_API_KEY"}))

        sys = SYSTEM_PROMPT + (f"\n\nCurrent notebook:\n{ctx}" if ctx else "")
        msgs = [{"role": "system", "content": sys}] + _trim_for_request(hist)

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
            hist.append({"role": "assistant", "content": text})
            self.finish(json.dumps({"response": text}))
        except Exception as e:
            if hist and hist[-1]["role"] == "user":
                hist.pop()
            self.set_status(500)
            self.finish(json.dumps({"error": str(e)}))


# ── SSE streaming ────────────────────────────────────────


class ChatStreamHandler(APIHandler):
    @tornado.web.authenticated
    async def post(self):
        body = json.loads(self.request.body)
        client_id = body.get("client_id") or "default"
        content = body.get("content", body.get("message", ""))
        ctx = body.get("context", "")
        model = body.get("model", "anthropic/claude-sonnet-4.6")
        web_search = bool(body.get("web_search", False))
        model = _apply_web_search(model, web_search)

        hist = ChatState.history(client_id)
        hist.append({"role": "user", "content": content})
        key = ChatState.api_key()
        if not key:
            self.set_status(400)
            return self.finish(json.dumps({"error": "No OPENROUTER_API_KEY"}))

        sys_msg = SYSTEM_PROMPT + (f"\n\nCurrent notebook:\n{ctx}" if ctx else "")
        msgs = [{"role": "system", "content": sys_msg}] + _trim_for_request(hist)

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
            hist.append({"role": "assistant", "content": full})
        elif hist and hist[-1]["role"] == "user":
            hist.pop()

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
        cid = self.get_argument("client_id", "default")
        self.finish(json.dumps({"history": ChatState.history(cid)}))

    @tornado.web.authenticated
    def delete(self):
        cid = self.get_argument("client_id", "default")
        ChatState.history(cid).clear()
        self.finish(json.dumps({"status": "ok"}))

    @tornado.web.authenticated
    def put(self):
        """Edit or truncate history.
        Body: {action: "delete_from"|"edit", index: int, content?: str}
        - delete_from: remove messages from index onward
        - edit: replace content at index, remove everything after
        """
        body = json.loads(self.request.body)
        cid = body.get("client_id") or "default"
        hist = ChatState.history(cid)
        action = body.get("action", "")
        idx = int(body.get("index", -1))
        if idx < 0 or idx >= len(hist):
            self.set_status(400)
            return self.finish(json.dumps({"error": "bad index"}))
        if action == "delete_from":
            del hist[idx:]
        elif action == "edit":
            hist[idx]["content"] = body.get("content", "")
            del hist[idx + 1:]
        else:
            self.set_status(400)
            return self.finish(json.dumps({"error": "bad action"}))
        self.finish(json.dumps({"history": hist}))


# ── Session persistence ──────────────────────────────────


class ChatSessionHandler(APIHandler):
    @tornado.web.authenticated
    def get(self):
        sid = self.get_argument("id", None)
        folder = self.get_argument("folder", "")
        d = _chat_dir(folder)
        if sid:
            sid = _safe_sid(sid)
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
        cid = body.get("client_id") or "default"
        hist = ChatState.history(cid)
        sid = body.get("id", "")
        if sid:
            sid = _safe_sid(sid)
        d = _chat_dir(body.get("folder", ""))

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
            title = body.get("title") or _auto_title(hist)
            date = datetime.now().isoformat()
        else:
            title = body.get("title") or existing.get("title") or _auto_title(hist)
            date = existing.get("date") or datetime.now().isoformat()

        Path(d, f"{sid}.json").write_text(
            json.dumps(
                {
                    "id": sid,
                    "title": title,
                    "date": date,
                    "updated": datetime.now().isoformat(),
                    "messages": hist,
                },
                indent=2,
            )
        )
        self.finish(json.dumps({"id": sid, "title": title}))

    @tornado.web.authenticated
    def put(self):
        body = json.loads(self.request.body)
        cid = body.get("client_id") or "default"
        sid = _safe_sid(body.get("id", ""))
        p = os.path.join(_chat_dir(body.get("folder", "")), f"{sid}.json")
        if os.path.exists(p):
            data = json.loads(Path(p).read_text())
            ChatState.set_history(cid, list(data.get("messages", [])))
            self.finish(json.dumps({"messages": ChatState.history(cid), "title": data.get("title", "")}))
        else:
            self.set_status(404)
            self.finish(json.dumps({"error": "not found"}))

    @tornado.web.authenticated
    def delete(self):
        sid = _safe_sid(self.get_argument("id", ""))
        folder = self.get_argument("folder", "")
        p = os.path.join(_chat_dir(folder), f"{sid}.json")
        if os.path.exists(p):
            os.remove(p)
        self.finish(json.dumps({"status": "ok"}))
