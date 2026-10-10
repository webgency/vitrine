import { defineConfig } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  {
    // .claude/** holds Claude Code background sessions' worktrees, which carry
    // their own .next build output; same reason as vitest.config.ts.
    ignores: ["node_modules/**", ".next/**", "out/**", "watch-researcher/**", ".claude/**"],
  },
  ...nextVitals,
  ...nextTypeScript,
]);
