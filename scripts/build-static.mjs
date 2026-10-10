#!/usr/bin/env node
import { spawn } from "node:child_process";
import { cp, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "vitrine-static-"));
const excluded = new Set([".git", "node_modules", ".next", "out", "watch-researcher"]);
// Seller-private data never enters the build copy, so no page can read it.
// prepare-pages deletes it again and check-export scans the result.
const excludedPaths = new Set([path.join("data", "private.json"), path.join("data", "listing-drafts")]);

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? root,
      env: { ...process.env, ...options.env },
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}`));
    });
  });
}

try {
  await cp(root, tempRoot, {
    recursive: true,
    filter: (source) => {
      const relative = path.relative(root, source);
      if (!relative) return true;
      if (excludedPaths.has(relative)) return false;
      return !relative.split(path.sep).some((part) => excluded.has(part));
    },
  });

  await symlink(path.join(root, "node_modules"), path.join(tempRoot, "node_modules"), "dir").catch(() => undefined);
  await run(process.execPath, ["scripts/prepare-pages.mjs"], { cwd: tempRoot });
  await run("npm", ["run", "build", "--", "--webpack"], { cwd: tempRoot, env: { NEXT_PUBLIC_STATIC: "true" } });

  await rm(path.join(root, "out"), { recursive: true, force: true });
  await cp(path.join(tempRoot, "out"), path.join(root, "out"), { recursive: true });
  await writeFile(path.join(root, "out", ".nojekyll"), "");
  // Last guard before anything can be published: fail if private data leaked.
  await run(process.execPath, ["scripts/check-export.mjs", "out"]);
  console.log(`Static export written to ${path.join(root, "out")}`);
} finally {
  await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
}
