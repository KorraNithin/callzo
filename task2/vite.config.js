import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development, /api is proxied to the mock API on your machine.
// In Docker, nginx does the same job (see nginx.conf).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8001",
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
