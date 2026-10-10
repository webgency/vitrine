// True when building the read-only static export for GitHub Pages.
// Set via NEXT_PUBLIC_STATIC=true so it's readable in both server and client
// components. Used to drop dynamic rendering and hide write actions (add/edit/
// delete) that have no server to talk to on a static host.
export const IS_STATIC = process.env.NEXT_PUBLIC_STATIC === "true";

// Public assets need the same project prefix as Next's static page routes.
export const ASSET_BASE_PATH = IS_STATIC ? "/vitrine" : "";
