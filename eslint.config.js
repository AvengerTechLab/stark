import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/", "node_modules/", "coverage/"] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    rules: {
      // Logging goes through src/logger.ts only (playbook §7).
      "no-console": "error",
    },
  },
  {
    // Plain Node.js scripts run by hand on a host (scripts/); they use Node's built-in globals.
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        performance: "readonly",
        fetch: "readonly",
        WebSocket: "readonly",
        AbortSignal: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
      },
    },
  },
);
