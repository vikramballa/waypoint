import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Content-Security-Policy for production builds. Everything (scripts, styles,
 * fonts) is bundled and served from our own origin, so the policy can forbid
 * inline and third-party script entirely. React applies `style={…}` through
 * the CSSOM, which CSP does not restrict, so no 'unsafe-inline' is needed.
 * The dev server is exempt: Vite's HMR client relies on inline scripts.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
].join("; ");

/** Headers that can't be expressed in a <meta> tag (used by `vite preview`). */
const SECURITY_HEADERS = {
  "Content-Security-Policy": `${CSP}; frame-ancestors 'none'`,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Cross-Origin-Opener-Policy": "same-origin",
};

function securityPolicy(): Plugin {
  return {
    name: "security-policy",
    apply: "build",
    transformIndexHtml(html) {
      return html.replace(
        "<head>",
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />\n    <meta name="referrer" content="no-referrer" />`
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), securityPolicy()],
  // Bind IPv4 explicitly: scripts/e2e.mjs and scripts/shots.mjs target
  // 127.0.0.1, and Node ≥17 resolves "localhost" to ::1 first.
  server: {
    host: "127.0.0.1",
    port: 5175,
    strictPort: true,
    // `npm run server` provides the API on :5180. Without it, the app runs in
    // local mode: /api/session answers {mode:"local"} instead of a 502.
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${process.env.API_PORT ?? 5180}`,
        changeOrigin: false,
        configure(proxy) {
          proxy.on("error", (_err, req, res) => {
            const r = res as import("node:http").ServerResponse;
            if (r.headersSent) return;
            const local = req.url?.startsWith("/api/session");
            r.writeHead(local ? 200 : 503, { "Content-Type": "application/json" });
            r.end(JSON.stringify(local ? { mode: "local" } : { error: "server_unavailable" }));
          });
        },
      },
    },
  },
  preview: { host: "127.0.0.1", port: 5176, strictPort: true, headers: SECURITY_HEADERS },
  build: {
    target: "es2020",
    outDir: "dist",
    // never inline fonts as data: URIs — keeps `font-src 'self'` strict
    assetsInlineLimit: (file) => (/\.woff2?$/.test(file) ? false : undefined),
    rollupOptions: {
      output: {
        // React changes far less often than app code: keep it in its own
        // long-cacheable chunk.
        manualChunks: { react: ["react", "react-dom"] },
      },
    },
  },
});
