import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The dev server proxies the API and WebSockets to Django, so the browser
// talks to a single origin and no CORS setup is needed during development.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/ws": { target: "ws://127.0.0.1:8000", ws: true },
    },
  },
});
