// The app runs in two modes:
//   • Dynamic (default) — `npm run dev` / `npm start`: full app with editing,
//     backed by the JSON file via API routes.
//   • Static export — set NEXT_PUBLIC_STATIC=true: a read-only build for
//     GitHub Pages. Pages can't run a server, so this bakes your collection
//     into static HTML at build time.
const isStatic = process.env.NEXT_PUBLIC_STATIC === "true";

// GitHub Pages project sites are served from /<repo>, so the static build
// needs a matching basePath. Local/dynamic builds use the root.
const repo = "vitrine";

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: { unoptimized: true },
  // The dev server is reached from a phone over Tailscale. Next blocks dev
  // assets and the HMR socket for hosts other than localhost unless listed,
  // which leaves the page loaded but retrying its live-reload connection
  // forever. Tailscale hosts are its 100.64/10 addresses and MagicDNS names
  // (machine.tailnet.ts.net — two levels, hence `**`).
  allowedDevOrigins: ["100.*.*.*", "**.ts.net"],
  ...(isStatic
    ? { output: "export", basePath: `/${repo}`, trailingSlash: true }
    : {}),
};

export default nextConfig;
