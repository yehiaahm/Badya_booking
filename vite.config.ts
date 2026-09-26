import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    port: 5173,
    // The API server (npm run dev starts both). SSE needs the connection left open.
    proxy: { "/api": { target: `http://127.0.0.1:${process.env.API_PORT || 3000}`, changeOrigin: false } },
  },
  build: {
    // Libraries change far less often than the app — separate files stay cached across updates.
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return id.includes("/src/i18n/ar.ts") ? "arabic" : undefined;
          if (/[\\/](react|react-dom|react-router|scheduler)[\\/]/.test(id)) return "react";
          if (id.includes("motion")) return "motion";
          if (id.includes("@tanstack")) return "query";
          if (id.includes("lucide-react")) return "icons";
          if (id.includes("date-fns")) return "dates";
          return "vendor";
        },
      },
    },
  },
  test: { environment: "node", include: ["src/**/*.test.ts", "server/**/*.test.ts"] },
} as never);
