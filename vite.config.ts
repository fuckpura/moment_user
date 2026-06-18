import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

function manualChunks(id: string): string | undefined {
  if (id.includes("/src/gen/proto/")) {
    return "moment-proto";
  }
  if (id.includes("/src/api/")) {
    return "moment-api";
  }
  if (!id.includes("node_modules")) {
    return undefined;
  }
  if (id.includes("/react/") || id.includes("/react-dom/") || id.includes("/scheduler/")) {
    return "vendor-react";
  }
  if (id.includes("/@connectrpc/") || id.includes("/@bufbuild/")) {
    return "vendor-rpc";
  }
  if (id.includes("/lucide-react/")) {
    return "vendor-icons";
  }
  return "vendor";
}

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
  server: {
    proxy: {
      "/api": {
        target: process.env.API_PROXY_TARGET || "http://127.0.0.1:28080",
        changeOrigin: true,
      },
      "/moment.user.v1.UserPortalService": {
        target: process.env.API_PROXY_TARGET || "http://127.0.0.1:28080",
        changeOrigin: true,
      },
    },
  },
});
