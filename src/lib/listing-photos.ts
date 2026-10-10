import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { isPhotoDataUrl, publishedPhotoPattern } from "./listing-shape.mjs";

/**
 * Listing photos on disk. A draft keeps its photos as data URLs inside
 * data/private.json; publishing writes them here, under public/listings/<id>/,
 * where both the dev server and the Pages export serve them. Files are named
 * by content hash, so re-publishing the same photo is a no-op and the same
 * image is never stored twice.
 */
const EXTENSIONS: Record<string, string> = { jpeg: "jpg", png: "png", webp: "webp" };
const MIME: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

function safeId(id: string): string {
  // Ids are generated base36 (or hand-set like "w24"); anything else must not
  // become a path segment.
  if (!/^[a-z0-9-]+$/i.test(id)) throw new Error(`Unsafe watch id for a photo path: ${id}`);
  return id;
}

function photoDir(id: string): string {
  return path.join(process.cwd(), "public", "listings", safeId(id));
}

function absolute(relativePath: string): string {
  return path.join(process.cwd(), "public", relativePath);
}

/** Turn each photo into a published path: data URLs are written to disk,
 * existing published paths for this watch are kept as they are. */
export async function publishPhotos(id: string, photos: string[]): Promise<string[]> {
  const pattern = publishedPhotoPattern(safeId(id));
  await fs.mkdir(photoDir(id), { recursive: true });
  const published: string[] = [];
  for (const photo of photos) {
    if (pattern.test(photo)) {
      await fs.access(absolute(photo));
      published.push(photo);
      continue;
    }
    if (!isPhotoDataUrl(photo)) throw new Error("A photo is neither an image upload nor one of this listing's saved photos.");
    const [, kind, base64] = photo.match(/^data:image\/(jpeg|png|webp);base64,(.+)$/)!;
    const bytes = Buffer.from(base64, "base64");
    const name = `${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}.${EXTENSIONS[kind]}`;
    const relativePath = `listings/${id}/${name}`;
    await fs.writeFile(absolute(relativePath), bytes);
    published.push(relativePath);
  }
  return [...new Set(published)];
}

/** Read a published photo back as a data URL, for moving a live listing back
 * to a private draft. */
export async function photoAsDataUrl(relativePath: string): Promise<string> {
  const ext = path.extname(relativePath).slice(1);
  const bytes = await fs.readFile(absolute(relativePath));
  return `data:${MIME[ext] ?? "image/jpeg"};base64,${bytes.toString("base64")}`;
}

/** Delete this watch's published photos that `keep` no longer references,
 * and the folder once it is empty. Unpublishing can't reach photos already
 * pushed to git; the editor says so. */
export async function prunePhotos(id: string, keep: string[]): Promise<void> {
  const dir = photoDir(id);
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  const kept = new Set(keep.map((photo) => path.basename(photo)));
  await Promise.all(names.filter((name) => !kept.has(name)).map((name) => fs.rm(path.join(dir, name), { force: true })));
  if (!kept.size) await fs.rm(dir, { recursive: true, force: true });
}
