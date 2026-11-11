const TOKEN_KEY = "mist_meet_token";

// In production, set VITE_API_ORIGIN (e.g. https://api.example.com) if the
// API lives on a different host than the frontend. Empty = same origin.
const API_ORIGIN = import.meta.env.VITE_API_ORIGIN || "";

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

export async function api(path, { method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Token ${token}`;

  const res = await fetch(`${API_ORIGIN}/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      data.detail ||
      Object.values(data).flat().filter((v) => typeof v === "string").join(" ") ||
      `Request failed (${res.status})`;
    const error = new Error(message);
    error.status = res.status;
    throw error;
  }
  return data;
}

/** Fetch an authenticated file (e.g. a PDF) and hand it to the browser as a download. */
export async function downloadFile(path, fallbackName) {
  const res = await fetch(`${API_ORIGIN}/api${path}`, {
    headers: { Authorization: `Token ${getToken()}` },
  });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const disposition = res.headers.get("Content-Disposition") || "";
  const filename = disposition.match(/filename="([^"]+)"/)?.[1] || fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function wsUrl(code) {
  const base = API_ORIGIN || window.location.origin;
  const url = new URL(`/ws/meet/${code}/`, base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("token", getToken() || "");
  return url.toString();
}

export const CODE_RE = /([a-z]{3}-[a-z]{4}-[a-z]{3})/;

export function meetingLink(code) {
  return `${window.location.origin}/${code}`;
}
