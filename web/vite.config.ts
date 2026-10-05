import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      "/chat": {
        target: "ws://127.0.0.1:8787",
        ws: true,
      },
      "/meta": {
        target: "http://127.0.0.1:8787",
      },
      "/mute": {
        target: "http://127.0.0.1:8787",
      },
      "/profile": {
        target: "http://127.0.0.1:8787",
      },
      "/avatar": {
        target: "http://127.0.0.1:8787",
      },
      "/rank": {
        target: "http://127.0.0.1:8787",
      },
      "/health": {
        target: "http://127.0.0.1:8787",
      },
    },
  },
});
