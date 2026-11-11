"""
Shared whiteboard: validation and state changes.

The board is a list of pages, each a list of items (strokes, shapes, text,
equations) in a fixed 1600 x 900 coordinate space, so it looks the same on
every screen size. Clients send small operations ("add these items",
"remove these ids", ...). The server validates them, applies them to the
stored state, and forwards them to everyone else in the call.

This module has no Django imports so it can be unit-tested on its own.
"""

import re

BOARD_W, BOARD_H = 1600, 900
MAX_PAGES = 60
MAX_ITEMS_PER_PAGE = 4000
MAX_POINTS = 1500
MAX_ITEMS_PER_OP = 200
MAX_IDS_PER_OP = 500

ITEM_TYPES = {"pen", "highlighter", "line", "arrow", "rect", "ellipse", "text", "math"}
ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
DEFAULT_COLOR = "#2b1d14"


def _id(value):
    return value if isinstance(value, str) and ID_RE.match(value) else None


def _num(value, lo=-BOARD_W, hi=BOARD_W * 2):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number:  # NaN
        return None
    return round(min(hi, max(lo, number)), 1)


def sanitize_item(item):
    """Return a cleaned copy of a board item, or None if it isn't valid."""
    if not isinstance(item, dict) or item.get("type") not in ITEM_TYPES:
        return None
    item_id = _id(item.get("id"))
    if not item_id:
        return None
    kind = item["type"]
    color = item.get("color") if isinstance(item.get("color"), str) and COLOR_RE.match(item.get("color")) else DEFAULT_COLOR
    width = _num(item.get("width"), 1, 120) or 4
    clean = {"id": item_id, "type": kind, "color": color, "width": width}

    if kind in ("pen", "highlighter"):
        points = item.get("points")
        if not isinstance(points, list) or not points:
            return None
        cleaned = []
        for point in points[:MAX_POINTS]:
            if not isinstance(point, (list, tuple)) or len(point) < 2:
                continue
            x, y = _num(point[0]), _num(point[1])
            if x is not None and y is not None:
                cleaned.append([x, y])
        if not cleaned:
            return None
        clean["points"] = cleaned
    elif kind in ("line", "arrow", "rect", "ellipse"):
        for key in ("x1", "y1", "x2", "y2"):
            value = _num(item.get(key))
            if value is None:
                return None
            clean[key] = value
    else:  # text, math
        body_key = "text" if kind == "text" else "tex"
        body = item.get(body_key)
        if not isinstance(body, str) or not body.strip():
            return None
        clean[body_key] = body[:1000]
        for key, lo, hi in (("x", -BOARD_W, BOARD_W * 2), ("y", -BOARD_H, BOARD_H * 2), ("w", 0, 6000), ("h", 0, 6000), ("size", 8, 200)):
            value = _num(item.get(key), lo, hi)
            if value is None:
                return None
            clean[key] = value
    return clean


def sanitize_op(op):
    """Return a cleaned operation, or None if it isn't valid."""
    if not isinstance(op, dict):
        return None
    kind = op.get("op")
    if kind == "add":
        page = _id(op.get("page"))
        items = op.get("items")
        if not page or not isinstance(items, list):
            return None
        cleaned = [c for c in (sanitize_item(i) for i in items[:MAX_ITEMS_PER_OP]) if c]
        return {"op": "add", "page": page, "items": cleaned} if cleaned else None
    if kind == "remove":
        page = _id(op.get("page"))
        ids = op.get("ids")
        if not page or not isinstance(ids, list):
            return None
        cleaned = [i for i in (_id(v) for v in ids[:MAX_IDS_PER_OP]) if i]
        return {"op": "remove", "page": page, "ids": cleaned} if cleaned else None
    if kind == "clear":
        page = _id(op.get("page"))
        return {"op": "clear", "page": page} if page else None
    if kind == "add-page":
        page_id = _id(op.get("id"))
        return {"op": "add-page", "id": page_id, "after": _id(op.get("after"))} if page_id else None
    if kind == "page":
        page_id = _id(op.get("id"))
        return {"op": "page", "id": page_id} if page_id else None
    return None


def initial_state(state=None):
    """Make sure a stored state has at least one page and a current page."""
    state = state if isinstance(state, dict) else {}
    if not state.get("pages"):
        state["pages"] = [{"id": "p1", "items": []}]
    ids = [p["id"] for p in state["pages"]]
    if state.get("current") not in ids:
        state["current"] = ids[0]
    return state


def apply_op(state, op):
    """Apply a sanitized op to the state in place. Returns an error message, or None on success."""
    pages = state["pages"]
    by_id = {p["id"]: p for p in pages}
    kind = op["op"]

    if kind in ("add", "remove", "clear"):
        page = by_id.get(op["page"])
        if page is None:
            return "That page no longer exists."
        if kind == "add":
            existing = {i["id"] for i in page["items"]}
            new_items = [i for i in op["items"] if i["id"] not in existing]
            if len(page["items"]) + len(new_items) > MAX_ITEMS_PER_PAGE:
                return "This page is full. Add a new page to keep drawing."
            page["items"].extend(new_items)
        elif kind == "remove":
            ids = set(op["ids"])
            page["items"] = [i for i in page["items"] if i["id"] not in ids]
        else:
            page["items"] = []
    elif kind == "add-page":
        if op["id"] in by_id:
            return None  # already added (repeat message)
        if len(pages) >= MAX_PAGES:
            return f"A board can have up to {MAX_PAGES} pages."
        index = next((n for n, p in enumerate(pages) if p["id"] == op["after"]), len(pages) - 1)
        pages.insert(index + 1, {"id": op["id"], "items": []})
        state["current"] = op["id"]
    elif kind == "page":
        if op["id"] in by_id:
            state["current"] = op["id"]
    return None
