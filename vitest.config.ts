import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Claude Code background sessions create git worktrees under
    // .claude/worktrees/, inside this checkout. Without this, `npm test` here
    // also runs their in-progress tests, deliberately failing repro tests
    // included, and reports them as this branch's failures.
    exclude: [...configDefaults.exclude, ".claude/**"],
  },
});
