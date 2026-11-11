import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  ChevronLeft, ChevronRight, Circle, Download, Eraser, FileDown, Grid3x3, Highlighter, Lock, Minus,
  MonitorUp, MoreHorizontal, MoveUpRight, Pencil, Plus, Redo2, Sigma, Square, Trash2, Type, Undo2, Unlock, X,
} from "lucide-react";
import {
  BOARD_H, BOARD_W, applyOp, createMathCache, drawItem, drawPaper, exportPdf, exportPng,
  hitTest, measureText, r1, renderTex, uid,
} from "../whiteboard/engine.js";

const TOOLS = [
  { id: "pen", label: "Pen", Icon: Pencil },
  { id: "highlighter", label: "Highlighter", Icon: Highlighter },
  { id: "line", label: "Line", Icon: Minus },
  { id: "arrow", label: "Arrow", Icon: MoveUpRight },
  { id: "rect", label: "Rectangle", Icon: Square },
  { id: "ellipse", label: "Ellipse", Icon: Circle },
  { id: "text", label: "Text", Icon: Type },
  { id: "math", label: "Equation", Icon: Sigma },
  { id: "eraser", label: "Eraser", Icon: Eraser },
];

const COLORS = [
  { value: "#2b1d14", name: "Espresso" },
  { value: "#c0392b", name: "Red" },
  { value: "#1f5fbf", name: "Blue" },
  { value: "#2e7d32", name: "Green" },
  { value: "#e08a1e", name: "Orange" },
  { value: "#7b3fa0", name: "Purple" },
];

const SIZES = [
  { id: "s", label: "Thin", pen: 3, text: 26 },
  { id: "m", label: "Medium", pen: 6, text: 38 },
  { id: "l", label: "Thick", pen: 12, text: 56 },
];

const SNIPPETS = [
  ["a/b", "\\frac{a}{b}"],
  ["x²", "x^{2}"],
  ["√x", "\\sqrt{x}"],
  ["∫", "\\int_{a}^{b} f(x)\\,dx"],
  ["Σ", "\\sum_{i=1}^{n} x_i"],
  ["lim", "\\lim_{x \\to 0}"],
  ["matrix", "\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}"],
  ["vector", "\\vec{F}"],
  ["∂", "\\frac{\\partial f}{\\partial x}"],
  ["α β θ", "\\alpha \\beta \\theta"],
];

export default function Whiteboard({ meeting, info, onClose }) {
  const { isHost } = meeting;
  const meetingRef = useRef(meeting);
  meetingRef.current = meeting;

  const [board, setBoard] = useState(null); // { pages, current, locked }
  const boardRef = useRef(board);
  boardRef.current = board;

  const [tool, setTool] = useState("pen");
  const [color, setColor] = useState(COLORS[0].value);
  const [sizeId, setSizeId] = useState("m");
  const [grid, setGrid] = useState(false);
  const [textEdit, setTextEdit] = useState(null); // { x, y, value }
  const [mathEdit, setMathEdit] = useState(null); // { x, y }
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [, refresh] = useReducer((n) => n + 1, 0);

  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const viewRef = useRef({ scale: 0.5, dpr: 1 });
  const drawingRef = useRef(null);
  const draftsRef = useRef(new Map());
  const undoRef = useRef([]);
  const redoRef = useRef([]);
  const frameRef = useRef(0);
  const mathRef = useRef(null);

  const size = SIZES.find((s) => s.id === sizeId);
  const page = board ? board.pages.find((p) => p.id === board.current) || board.pages[0] : null;
  const pageIndex = board && page ? board.pages.indexOf(page) : 0;
  const canDraw = Boolean(board) && (!board.locked || isHost);

  // ------------------------------------------------------------------ rendering

  const render = useCallback(() => {
    frameRef.current = 0;
    const canvas = canvasRef.current;
    const b = boardRef.current;
    if (!canvas || !b) return;
    const { scale, dpr } = viewRef.current;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    drawPaper(ctx, grid);
    const current = b.pages.find((p) => p.id === b.current) || b.pages[0];
    current.items.forEach((item) => drawItem(ctx, item, mathRef.current));
    const now = Date.now();
    draftsRef.current.forEach((draft, id) => {
      if (now - draft.at > 4000) draftsRef.current.delete(id);
      else if (draft.page === current.id) drawItem(ctx, draft.item, mathRef.current);
    });
    if (drawingRef.current?.item) drawItem(ctx, drawingRef.current.item, mathRef.current);
  }, [grid]);

  const renderRef = useRef(render);
  renderRef.current = render;
  const schedule = useCallback(() => {
    if (!frameRef.current) frameRef.current = requestAnimationFrame(() => renderRef.current());
  }, []);

  if (!mathRef.current) mathRef.current = createMathCache(() => schedule());

  useEffect(() => {
    schedule();
  }, [board, grid, schedule]);

  // Fit the 16:9 board inside the available space.
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const fit = () => {
      const { width, height } = wrap.getBoundingClientRect();
      const scale = Math.max(0.1, Math.min(width / BOARD_W, height / BOARD_H));
      const dpr = window.devicePixelRatio || 1;
      viewRef.current = { scale, dpr };
      canvas.style.width = `${BOARD_W * scale}px`;
      canvas.style.height = `${BOARD_H * scale}px`;
      canvas.width = Math.round(BOARD_W * scale * dpr);
      canvas.height = Math.round(BOARD_H * scale * dpr);
      refresh();
      render();
    };
    const observer = new ResizeObserver(fit);
    observer.observe(wrap);
    fit();
    return () => observer.disconnect();
  }, [render, board === null]); // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------------ sync

  useEffect(() => {
    const off = meetingRef.current.subscribeWhiteboard((msg) => {
      switch (msg.type) {
        case "wb-state":
          setBoard({ pages: msg.pages, current: msg.current, locked: msg.locked });
          break;
        case "wb-op":
          if (msg.op.op === "add") msg.op.items.forEach((i) => draftsRef.current.delete(i.id));
          setBoard((b) => applyOp(b, msg.op));
          break;
        case "wb-draft":
          draftsRef.current.set(msg.item.id, { item: msg.item, page: msg.page, at: Date.now() });
          schedule();
          break;
        case "wb-lock":
          setBoard((b) => (b ? { ...b, locked: msg.locked } : b));
          break;
        case "wb-error":
          setError(msg.message);
          break;
        default:
          break;
      }
    });
    meetingRef.current.sendWhiteboard({ type: "wb-sync" });
    return off;
  }, [schedule]);

  useEffect(() => {
    if (!error) return;
    const id = setTimeout(() => setError(""), 5000);
    return () => clearTimeout(id);
  }, [error]);

  const commit = (op) => {
    setBoard((b) => applyOp(b, op));
    meetingRef.current.sendWhiteboard({ type: "wb-op", op });
  };

  const pushUndo = (entry) => {
    undoRef.current = [...undoRef.current.slice(-99), entry];
    redoRef.current = [];
    refresh();
  };

  const undo = () => {
    const entry = undoRef.current.pop();
    if (!entry || !canDraw) return;
    if (entry.kind === "add") commit({ op: "remove", page: entry.page, ids: entry.items.map((i) => i.id) });
    else commit({ op: "add", page: entry.page, items: entry.items });
    redoRef.current.push(entry);
    refresh();
  };

  const redo = () => {
    const entry = redoRef.current.pop();
    if (!entry || !canDraw) return;
    if (entry.kind === "add") commit({ op: "add", page: entry.page, items: entry.items });
    else commit({ op: "remove", page: entry.page, ids: entry.items.map((i) => i.id) });
    undoRef.current.push(entry);
    refresh();
  };

  // Ctrl/⌘+Z and Ctrl/⌘+Shift+Z / Ctrl+Y, when not typing.
  const undoRedoRef = useRef({ undo, redo });
  undoRedoRef.current = { undo, redo };
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        undoRedoRef.current.undo();
      } else if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        undoRedoRef.current.redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ------------------------------------------------------------------ pointer input

  const toBoard = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const { scale } = viewRef.current;
    return [r1((e.clientX - rect.left) / scale), r1((e.clientY - rect.top) / scale)];
  };

  const eraseAt = (x, y) => {
    const drawing = drawingRef.current;
    const radius = Math.max(10, 14 / viewRef.current.scale);
    const hits = page.items.filter((item) => !drawing.erasedIds.has(item.id) && hitTest(item, x, y, radius));
    if (!hits.length) return;
    hits.forEach((item) => {
      drawing.erasedIds.add(item.id);
      drawing.erased.push(item);
    });
    commit({ op: "remove", page: page.id, ids: hits.map((i) => i.id) });
  };

  const onPointerDown = (e) => {
    if (!canDraw || !page || (e.pointerType === "mouse" && e.button !== 0)) return;
    const [x, y] = toBoard(e);
    setMenuOpen(false);
    if (tool === "text") {
      setTextEdit({ x, y, value: "" });
      return;
    }
    if (tool === "math") {
      setMathEdit({ x, y });
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    if (tool === "eraser") {
      drawingRef.current = { eraser: true, erased: [], erasedIds: new Set() };
      eraseAt(x, y);
      return;
    }
    const base = { id: uid(), type: tool, color, width: tool === "highlighter" ? size.pen * 4 : size.pen };
    const item = tool === "pen" || tool === "highlighter" ? { ...base, points: [[x, y]] } : { ...base, x1: x, y1: y, x2: x, y2: y };
    drawingRef.current = { item, page: page.id, lastSent: 0 };
    schedule();
  };

  const onPointerMove = (e) => {
    const drawing = drawingRef.current;
    if (!drawing) return;
    const events = e.nativeEvent.getCoalescedEvents?.() || [e.nativeEvent];
    if (drawing.eraser) {
      events.forEach((ev) => eraseAt(...toBoard(ev)));
      return;
    }
    const { item } = drawing;
    if (item.points) {
      for (const ev of events) {
        const [x, y] = toBoard(ev);
        const last = item.points[item.points.length - 1];
        if (item.points.length < 1500 && Math.hypot(x - last[0], y - last[1]) >= 1.5) item.points.push([x, y]);
      }
    } else {
      const [x, y] = toBoard(e);
      item.x2 = x;
      item.y2 = y;
    }
    schedule();
    const now = performance.now();
    if (now - drawing.lastSent > 60) {
      drawing.lastSent = now;
      meetingRef.current.sendWhiteboard({ type: "wb-draft", page: drawing.page, item });
    }
  };

  const onPointerUp = () => {
    const drawing = drawingRef.current;
    drawingRef.current = null;
    if (!drawing) return;
    if (drawing.eraser) {
      if (drawing.erased.length) pushUndo({ kind: "remove", page: page.id, items: drawing.erased });
      return;
    }
    const { item } = drawing;
    const isShape = !item.points;
    if (isShape && Math.hypot(item.x2 - item.x1, item.y2 - item.y1) < 3) {
      schedule();
      return;
    }
    commit({ op: "add", page: drawing.page, items: [item] });
    pushUndo({ kind: "add", page: drawing.page, items: [item] });
  };

  // ------------------------------------------------------------------ text & equations

  const commitText = () => {
    const edit = textEdit;
    setTextEdit(null);
    const text = edit?.value.replace(/\s+$/, "");
    if (!text || !page) return;
    const { w, h } = measureText(text, size.text);
    const item = { id: uid(), type: "text", x: edit.x, y: edit.y, text, color, size: size.text, w, h, width: 1 };
    commit({ op: "add", page: page.id, items: [item] });
    pushUndo({ kind: "add", page: page.id, items: [item] });
  };

  const insertMath = async (tex) => {
    const edit = mathEdit;
    const { w, h } = await renderTex(tex, color, size.text);
    const item = { id: uid(), type: "math", x: edit.x, y: edit.y, tex, color, size: size.text, w, h, width: 1 };
    setMathEdit(null);
    commit({ op: "add", page: page.id, items: [item] });
    pushUndo({ kind: "add", page: page.id, items: [item] });
  };

  // ------------------------------------------------------------------ pages, host actions, export

  const goTo = (index) => {
    const target = board.pages[index];
    if (target && canDraw) commit({ op: "page", id: target.id });
  };
  const addPage = () => canDraw && commit({ op: "add-page", id: uid(), after: page.id });

  const clearPage = () => {
    setMenuOpen(false);
    if (!page.items.length || !window.confirm("Clear everything on this page for everyone?")) return;
    pushUndo({ kind: "remove", page: page.id, items: page.items });
    commit({ op: "clear", page: page.id });
  };

  const toggleLock = () => {
    setMenuOpen(false);
    meetingRef.current.sendWhiteboard({ type: "wb-lock", locked: !board.locked });
  };

  const showToEveryone = () => {
    setMenuOpen(false);
    meetingRef.current.sendWhiteboard({ type: "wb-show" });
    meetingRef.current.notify("The whiteboard is now open for everyone");
  };

  const runExport = async (kind) => {
    setMenuOpen(false);
    setBusy(kind === "pdf" ? "Preparing PDF…" : "Preparing image…");
    try {
      const name = `whiteboard-${info.code}`;
      if (kind === "pdf") await exportPdf(board.pages, grid, mathRef.current, `${name}.pdf`);
      else await exportPng(page, grid, mathRef.current, `${name}-page-${pageIndex + 1}.png`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  };

  // ------------------------------------------------------------------ view

  const { scale } = viewRef.current;

  return (
    <section className="wb" aria-label="Whiteboard">
      <div className="wb-toolbar">
        <div className="wb-tools" role="toolbar" aria-label="Drawing tools">
          {TOOLS.map(({ id, label, Icon }) => (
            <button
              key={id}
              className={`wb-btn ${tool === id ? "is-on" : ""}`}
              onClick={() => setTool(id)}
              disabled={!canDraw}
              aria-pressed={tool === id}
              aria-label={label}
              title={label}
            >
              <Icon size={18} />
            </button>
          ))}
          <span className="wb-sep" />
          {COLORS.map((c) => (
            <button
              key={c.value}
              className={`wb-swatch ${color === c.value ? "is-on" : ""}`}
              style={{ "--swatch": c.value }}
              onClick={() => setColor(c.value)}
              disabled={!canDraw}
              aria-pressed={color === c.value}
              aria-label={c.name}
              title={c.name}
            />
          ))}
          <span className="wb-sep" />
          {SIZES.map((s) => (
            <button
              key={s.id}
              className={`wb-btn ${sizeId === s.id ? "is-on" : ""}`}
              onClick={() => setSizeId(s.id)}
              disabled={!canDraw}
              aria-pressed={sizeId === s.id}
              aria-label={s.label}
              title={s.label}
            >
              <span className="wb-dot" style={{ width: 4 + s.pen, height: 4 + s.pen }} />
            </button>
          ))}
          <span className="wb-sep" />
          <button className="wb-btn" onClick={undo} disabled={!canDraw || !undoRef.current.length} aria-label="Undo (Ctrl+Z)" title="Undo (Ctrl+Z)">
            <Undo2 size={18} />
          </button>
          <button className="wb-btn" onClick={redo} disabled={!canDraw || !redoRef.current.length} aria-label="Redo (Ctrl+Shift+Z)" title="Redo (Ctrl+Shift+Z)">
            <Redo2 size={18} />
          </button>
          <button className={`wb-btn ${grid ? "is-on" : ""}`} onClick={() => setGrid((g) => !g)} aria-pressed={grid} aria-label="Grid" title="Grid">
            <Grid3x3 size={18} />
          </button>
        </div>

        <div className="wb-right">
          {board && (
            <div className="wb-pages">
              <button className="wb-btn" onClick={() => goTo(pageIndex - 1)} disabled={!canDraw || pageIndex === 0} aria-label="Previous page">
                <ChevronLeft size={18} />
              </button>
              <span className="wb-page-label">
                {pageIndex + 1} / {board.pages.length}
              </span>
              <button className="wb-btn" onClick={() => goTo(pageIndex + 1)} disabled={!canDraw || pageIndex >= board.pages.length - 1} aria-label="Next page">
                <ChevronRight size={18} />
              </button>
              <button className="wb-btn" onClick={addPage} disabled={!canDraw} aria-label="Add page" title="Add page">
                <Plus size={18} />
              </button>
            </div>
          )}
          <div className="menu-anchor">
            <button className="wb-btn" onClick={() => setMenuOpen((o) => !o)} aria-label="More options" aria-expanded={menuOpen}>
              <MoreHorizontal size={18} />
            </button>
            {menuOpen && board && (
              <div className="menu wb-menu" role="menu">
                <button role="menuitem" onClick={() => runExport("png")}><Download size={17} /> Download this page (PNG)</button>
                <button role="menuitem" onClick={() => runExport("pdf")}><FileDown size={17} /> Download all pages (PDF)</button>
                {isHost && (
                  <>
                    <button role="menuitem" onClick={showToEveryone}><MonitorUp size={17} /> Open for everyone</button>
                    <button role="menuitem" onClick={toggleLock}>
                      {board.locked ? <Unlock size={17} /> : <Lock size={17} />}
                      {board.locked ? "Let everyone draw" : "Only I can draw"}
                    </button>
                    <button role="menuitem" className="danger" onClick={clearPage}><Trash2 size={17} /> Clear this page</button>
                  </>
                )}
              </div>
            )}
          </div>
          <button className="wb-btn" onClick={onClose} aria-label="Close whiteboard" title="Close whiteboard">
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="wb-stage" ref={wrapRef}>
        {!board && <div className="spinner" />}
        <div className="wb-canvas-box" style={{ display: board ? "block" : "none" }}>
          <canvas
            ref={canvasRef}
            className={`wb-canvas tool-${tool} ${canDraw ? "" : "is-readonly"}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
          {textEdit && (
            <textarea
              className="wb-text-input"
              autoFocus
              value={textEdit.value}
              onChange={(e) => setTextEdit({ ...textEdit, value: e.target.value })}
              onBlur={commitText}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  commitText();
                } else if (e.key === "Escape") {
                  setTextEdit(null);
                }
              }}
              placeholder="Type, then press Enter"
              style={{
                left: textEdit.x * scale,
                top: textEdit.y * scale,
                fontSize: size.text * scale,
                color,
              }}
            />
          )}
        </div>

        {board?.locked && !isHost && <div className="wb-banner">The host has locked the whiteboard. You can watch and download it.</div>}
        {board?.locked && isHost && <div className="wb-banner">Only you can draw right now.</div>}
        {(error || busy) && <div className="wb-toast" role="status">{error || busy}</div>}
      </div>

      {mathEdit && <MathDialog color={color} size={size.text} onCancel={() => setMathEdit(null)} onInsert={insertMath} />}
    </section>
  );
}

function MathDialog({ color, size, onCancel, onInsert }) {
  const [tex, setTex] = useState("");
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const [inserting, setInserting] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!tex.trim()) {
      setPreview(null);
      setError("");
      return;
    }
    let cancelled = false;
    const id = setTimeout(() => {
      renderTex(tex, color, size)
        .then((result) => !cancelled && (setPreview(result), setError("")))
        .catch((err) => !cancelled && (setPreview(null), setError(err.message)));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [tex, color, size]);

  const insertSnippet = (snippet) => {
    const el = inputRef.current;
    const start = el?.selectionStart ?? tex.length;
    const end = el?.selectionEnd ?? tex.length;
    const next = tex.slice(0, start) + snippet + tex.slice(end);
    setTex(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + snippet.length, start + snippet.length);
    });
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!tex.trim() || error) return;
    setInserting(true);
    try {
      await onInsert(tex.trim());
    } catch (err) {
      setError(err.message);
      setInserting(false);
    }
  };

  return (
    <div className="wb-dialog-backdrop" onMouseDown={onCancel}>
      <form className="wb-dialog" onSubmit={submit} onMouseDown={(e) => e.stopPropagation()}>
        <h3>Insert equation</h3>
        <p className="muted small">Write it in LaTeX, or start from a shortcut.</p>
        <div className="wb-snippets">
          {SNIPPETS.map(([label, snippet]) => (
            <button key={label} type="button" onClick={() => insertSnippet(snippet)}>{label}</button>
          ))}
        </div>
        <textarea
          ref={inputRef}
          autoFocus
          value={tex}
          onChange={(e) => setTex(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && onCancel()}
          placeholder="E = mc^2"
          rows={3}
          spellCheck={false}
          aria-label="Equation in LaTeX"
        />
        <div className="wb-preview" aria-live="polite">
          {preview ? <img src={preview.src} alt="Equation preview" /> : <span className="muted small">{error || "Preview appears here"}</span>}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" disabled={!preview || inserting}>{inserting ? "Inserting…" : "Insert"}</button>
        </div>
      </form>
    </div>
  );
}
