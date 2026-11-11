const TOKEN_KEY = "mist_meet_token";

// In production, set VITE_API_ORIGIN (e.g. https://api.example.com) if the
// API lives on a different host than the frontend. Empty = same origin.
const API_ORIGIN = (import.meta.env.VITE_API_ORIGIN || "").replace(/\/+$/, "");

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

export const API_BASE_LABEL = API_ORIGIN || "this site";

export async function api(path, { method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Token ${token}`;

  let res;
  try {
    res = await fetch(`${API_ORIGIN}/api${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw Object.assign(
      new Error(`Can't reach the MIST Meet server at ${API_BASE_LABEL}. Check your connection and the server address.`),
      { status: 0 }
    );
  }
  if (res.status === 204) return null;

  // The API always answers with JSON. Anything else (an HTML page) means the
  // request reached the wrong place: a missing VITE_API_ORIGIN, or a server
  // that is still starting up.
  const isJson = (res.headers.get("Content-Type") || "").includes("application/json");
  const data = isJson ? await res.json().catch(() => ({})) : null;

  if (!isJson) {
    const error = new Error(
      res.status >= 500 || res.status === 0
        ? `The server had a problem (${res.status}). If you deployed recently, check the API service's Logs on Render.`
        : `The MIST Meet server didn't respond at ${API_BASE_LABEL}. It may still be starting up. Wait a minute and try again.`
    );
    error.status = res.status;
    error.notApi = true;
    throw error;
  }
  if (!res.ok) {
    const message =
      data.detail ||
      Object.values(data).flat().filter((v) => typeof v === "string").join(" ") ||
      `Request failed (${res.status})`;
    throw Object.assign(new Error(message), { status: res.status });
  }
  return data;
}

/**
 * Start a real browser download from an API path that returns a short-lived
 * signed URL ({ url }). Using a plain link (instead of fetch + blob) means the
 * browser's downloader, download managers and mobile browsers all get the
 * complete file.
 */
export async function downloadFromSignedLink(linkPath) {
  const { url } = await api(linkPath);
  const a = document.createElement("a");
  a.href = `${API_ORIGIN}${url}`;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
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
