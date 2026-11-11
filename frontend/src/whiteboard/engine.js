/*
 * Whiteboard engine: everything that isn't React.
 *
 * Board space is a fixed 1600 x 900 (16:9) so a drawing looks the same on a
 * phone, a laptop, and in exported files. The canvas is scaled to fit.
 */

export const BOARD_W = 1600;
export const BOARD_H = 900;
export const PAPER = "#fffdf9";
const GRID = "#ece2d6";

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
export const r1 = (v) => Math.round(v * 10) / 10;

// ------------------------------------------------------------------ board operations
// Mirrors backend/meetings/whiteboard.py so every client ends up with the same board.

export function applyOp(board, op) {
  if (!board) return board;
  const onPage = (fn) => ({ ...board, pages: board.pages.map((p) => (p.id === op.page ? fn(p) : p)) });
  switch (op.op) {
    case "add":
      return onPage((p) => {
        const existing = new Set(p.items.map((i) => i.id));
        return { ...p, items: [...p.items, ...op.items.filter((i) => !existing.has(i.id))] };
      });
    case "remove": {
      const ids = new Set(op.ids);
      return onPage((p) => ({ ...p, items: p.items.filter((i) => !ids.has(i.id)) }));
    }
    case "clear":
      return onPage((p) => ({ ...p, items: [] }));
    case "add-page": {
      if (board.pages.some((p) => p.id === op.id)) return board;
      const pages = [...board.pages];
      const index = pages.findIndex((p) => p.id === op.after);
      pages.splice(index === -1 ? pages.length : index + 1, 0, { id: op.id, items: [] });
      return { ...board, pages, current: op.id };
    }
    case "page":
      return board.pages.some((p) => p.id === op.id) ? { ...board, current: op.id } : board;
    default:
      return board;
  }
}

// ------------------------------------------------------------------ script loading (CDN, pinned)

const scripts = new Map();
export function loadScript(src) {
  if (!scripts.has(src)) {
    scripts.set(
      src,
      new Promise((resolve, reject) => {
        const el = document.createElement("script");
        el.src = src;
        el.async = true;
        el.onload = resolve;
        el.onerror = () => {
          scripts.delete(src);
          reject(new Error("Couldn't load a needed component. Check your internet connection."));
        };
        document.head.appendChild(el);
      })
    );
  }
  return scripts.get(src);
}

const MATHJAX_URL = "https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/tex-svg.js";
const JSPDF_URL = "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js";

let mathJaxReady = null;
function loadMathJax() {
  if (window.MathJax?.tex2svgPromise) return Promise.resolve(window.MathJax);
  if (!mathJaxReady) {
    mathJaxReady = new Promise((resolve, reject) => {
      window.MathJax = {
        svg: { fontCache: "none" }, // self-contained SVGs, so they can be drawn as images
        startup: {
          typeset: false,
          ready() {
            window.MathJax.startup.defaultReady();
            window.MathJax.startup.promise.then(() => resolve(window.MathJax));
          },
        },
      };
      loadScript(MATHJAX_URL).catch((err) => {
        mathJaxReady = null;
        reject(new Error("Couldn't load the equation tool. Check your internet connection."));
        console.warn(err);
      });
    });
  }
  return mathJaxReady;
}

/** Render LaTeX to an SVG data URL sized for `size` (board units). */
export async function renderTex(tex, color, size) {
  const MathJax = await loadMathJax();
  const node = await MathJax.tex2svgPromise(tex, { display: true });
  const error = node.querySelector("[data-mjx-error]");
  if (error) throw new Error(error.getAttribute("data-mjx-error"));
  const svg = node.querySelector("svg");
  const ex = size * 0.5;
  const w = Math.max(4, parseFloat(svg.getAttribute("width")) * ex);
  const h = Math.max(4, parseFloat(svg.getAttribute("height")) * ex);
  svg.setAttribute("width", String(w));
  svg.setAttribute("height", String(h));
  svg.removeAttribute("style");
  let markup = new XMLSerializer().serializeToString(svg).replace(/currentColor/g, color);
  if (!markup.includes('xmlns="http://www.w3.org/2000/svg"')) {
    markup = markup.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  return { src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`, w: r1(w), h: r1(h) };
}

/** Cache of rendered equation images, shared by the live board and exports. */
export function createMathCache(onReady) {
  const cache = new Map();
  const load = (item) => {
    const key = `${item.tex}\u0000${item.color}\u0000${item.size}`;
    let entry = cache.get(key);
    if (!entry) {
      entry = { status: "loading" };
      entry.promise = renderTex(item.tex, item.color, item.size)
        .then(
          ({ src }) =>
            new Promise((resolve) => {
              const img = new Image();
              img.onload = () => {
                entry.status = "ready";
                entry.img = img;
                resolve();
              };
              img.onerror = () => {
                entry.status = "error";
                resolve();
              };
              img.src = src;
            })
        )
        .catch(() => {
          entry.status = "error";
        })
        .finally(() => onReady?.());
      cache.set(key, entry);
    }
    return entry;
  };
  return { get: load, ensure: (items) => Promise.all(items.filter((i) => i.type === "math").map((i) => load(i).promise)) };
}

// ------------------------------------------------------------------ drawing

export function drawPaper(ctx, grid) {
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, BOARD_W, BOARD_H);
  if (!grid) return;
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 40; x < BOARD_W; x += 40) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, BOARD_H);
  }
  for (let y = 40; y < BOARD_H; y += 40) {
    ctx.moveTo(0, y);
    ctx.lineTo(BOARD_W, y);
  }
  ctx.stroke();
}

function drawSmooth(ctx, points) {
  if (points.length === 1) {
    ctx.beginPath();
    ctx.arc(points[0][0], points[0][1], ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length - 1; i++) {
    const midX = (points[i][0] + points[i + 1][0]) / 2;
    const midY = (points[i][1] + points[i + 1][1]) / 2;
    ctx.quadraticCurveTo(points[i][0], points[i][1], midX, midY);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last[0], last[1]);
  ctx.stroke();
}

export function drawItem(ctx, item, math) {
  ctx.save();
  ctx.strokeStyle = item.color;
  ctx.fillStyle = item.color;
  ctx.lineWidth = item.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  switch (item.type) {
    case "highlighter":
      ctx.globalAlpha = 0.32;
      ctx.lineCap = "butt";
      drawSmooth(ctx, item.points);
      break;
    case "pen":
      drawSmooth(ctx, item.points);
      break;
    case "line":
    case "arrow": {
      ctx.beginPath();
      ctx.moveTo(item.x1, item.y1);
      ctx.lineTo(item.x2, item.y2);
      ctx.stroke();
      if (item.type === "arrow") {
        const angle = Math.atan2(item.y2 - item.y1, item.x2 - item.x1);
        const head = Math.max(16, item.width * 4);
        ctx.beginPath();
        ctx.moveTo(item.x2, item.y2);
        ctx.lineTo(item.x2 - head * Math.cos(angle - Math.PI / 7), item.y2 - head * Math.sin(angle - Math.PI / 7));
        ctx.moveTo(item.x2, item.y2);
        ctx.lineTo(item.x2 - head * Math.cos(angle + Math.PI / 7), item.y2 - head * Math.sin(angle + Math.PI / 7));
        ctx.stroke();
      }
      break;
    }
    case "rect":
      ctx.strokeRect(Math.min(item.x1, item.x2), Math.min(item.y1, item.y2), Math.abs(item.x2 - item.x1), Math.abs(item.y2 - item.y1));
      break;
    case "ellipse":
      ctx.beginPath();
      ctx.ellipse(
        (item.x1 + item.x2) / 2,
        (item.y1 + item.y2) / 2,
        Math.abs(item.x2 - item.x1) / 2,
        Math.abs(item.y2 - item.y1) / 2,
        0,
        0,
        Math.PI * 2
      );
      ctx.stroke();
      break;
    case "text":
      ctx.font = `${item.size}px "IBM Plex Sans", "Segoe UI", sans-serif`;
      ctx.textBaseline = "top";
      item.text.split("\n").forEach((line, i) => ctx.fillText(line, item.x, item.y + i * item.size * 1.25));
      break;
    case "math": {
      const entry = math?.get(item);
      if (entry?.status === "ready") {
        ctx.drawImage(entry.img, item.x, item.y, item.w, item.h);
      } else {
        ctx.setLineDash([6, 6]);
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(item.x, item.y, item.w, item.h);
        ctx.font = `16px "IBM Plex Sans", sans-serif`;
        ctx.textBaseline = "top";
        ctx.fillText(entry?.status === "error" ? "Equation unavailable" : "Loading equation…", item.x + 6, item.y + 6);
      }
      break;
    }
    default:
      break;
  }
  ctx.restore();
}

export function measureText(text, size) {
  const ctx = document.createElement("canvas").getContext("2d");
  ctx.font = `${size}px "IBM Plex Sans", "Segoe UI", sans-serif`;
  const lines = text.split("\n");
  return {
    w: r1(Math.max(...lines.map((l) => ctx.measureText(l).width), 4)),
    h: r1(lines.length * size * 1.25),
  };
}

// ------------------------------------------------------------------ hit testing (eraser)

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;
  let t = lengthSq ? ((px - x1) * dx + (py - y1) * dy) / lengthSq : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function nearPolyline(points, x, y, reach, closed = false) {
  if (points.length === 1) return Math.hypot(x - points[0][0], y - points[0][1]) <= reach;
  const count = closed ? points.length : points.length - 1;
  for (let i = 0; i < count; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (distToSegment(x, y, a[0], a[1], b[0], b[1]) <= reach) return true;
  }
  return false;
}

export function hitTest(item, x, y, radius) {
  const reach = radius + (item.width || 0) / 2;
  switch (item.type) {
    case "pen":
    case "highlighter":
      return nearPolyline(item.points, x, y, reach);
    case "line":
    case "arrow":
      return distToSegment(x, y, item.x1, item.y1, item.x2, item.y2) <= reach;
    case "rect":
      return nearPolyline([[item.x1, item.y1], [item.x2, item.y1], [item.x2, item.y2], [item.x1, item.y2]], x, y, reach, true);
    case "ellipse": {
      const cx = (item.x1 + item.x2) / 2;
      const cy = (item.y1 + item.y2) / 2;
      const rx = Math.abs(item.x2 - item.x1) / 2;
      const ry = Math.abs(item.y2 - item.y1) / 2;
      const pts = Array.from({ length: 48 }, (_, i) => [cx + rx * Math.cos((i / 48) * Math.PI * 2), cy + ry * Math.sin((i / 48) * Math.PI * 2)]);
      return nearPolyline(pts, x, y, reach, true);
    }
    case "text":
    case "math":
      return x >= item.x - radius && x <= item.x + item.w + radius && y >= item.y - radius && y <= item.y + item.h + radius;
    default:
      return false;
  }
}

// ------------------------------------------------------------------ export

async function renderPage(page, grid, math, scale) {
  await math.ensure(page.items);
  const canvas = document.createElement("canvas");
  canvas.width = BOARD_W * scale;
  canvas.height = BOARD_H * scale;
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  drawPaper(ctx, grid);
  page.items.forEach((item) => drawItem(ctx, item, math));
  return canvas;
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export async function exportPng(page, grid, math, filename) {
  const canvas = await renderPage(page, grid, math, 2);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  saveBlob(blob, filename);
}

export async function exportPdf(pages, grid, math, filename) {
  await loadScript(JSPDF_URL);
  const { jsPDF } = window.jspdf;
  const W = BOARD_W * 0.75; // points
  const H = BOARD_H * 0.75;
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: [W, H] });
  for (let i = 0; i < pages.length; i++) {
    if (i > 0) doc.addPage([W, H], "landscape");
    const canvas = await renderPage(pages[i], grid, math, 1.5);
    doc.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, W, H);
  }
  saveBlob(doc.output("blob"), filename);
}
