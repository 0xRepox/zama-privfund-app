import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  envDir: resolve(__dirname, ".."),
  define: {
    global: "globalThis",
  },
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
    fs: {
      allow: [".."],
    },
  },
  resolve: {
    alias: {
      process: "process/browser",
      stream: "stream-browserify",
      util: "util",
      events: "events",
      buffer: "buffer",
      crypto: "crypto-browserify",
    },
  },
  optimizeDeps: {
    include: ["process", "util", "events", "buffer", "stream-browserify", "crypto-browserify"],
    exclude: ["@zama-fhe/relayer-sdk", "keccak", "secp256k1"],
  },
  assetsInclude: ["**/*.wasm"],
  build: {
    target: "esnext",
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
});
