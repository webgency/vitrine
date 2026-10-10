"use client";

import { useCallback, useId, useRef, useState } from "react";

const MAX_DIMENSION = 1000; // px — downscale the longest edge to keep JSON small
const JPEG_QUALITY = 0.82;

/**
 * Reads an image File, downscales it on a canvas, and returns a JPEG data URL.
 * Storing the image inline (rather than scraping a retailer or writing files to
 * disk) keeps the whole collection in the version-controlled watches.json and
 * works in the static GitHub Pages export with no server.
 */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That file isn't a readable image."));
      img.onload = () => {
        const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas not available."));
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export default function ImageDropzone({
  value,
  onChange,
}: {
  value: string;
  onChange: (dataUrl: string) => void;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showUrl, setShowUrl] = useState(false);

  const handleFile = useCallback(
    async (file: File | undefined | null) => {
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        setError("Please drop an image file.");
        return;
      }
      setError(null);
      setBusy(true);
      try {
        onChange(await fileToDataUrl(file));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load that image.");
      } finally {
        setBusy(false);
      }
    },
    [onChange]
  );

  return (
    <div className="space-y-2">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFile(e.dataTransfer.files?.[0]);
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        className={`relative flex min-h-[10rem] cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-lg border-2 border-dashed p-4 text-center transition-colors ${
          dragOver ? "border-cocoa-900 bg-cocoa-50" : "border-cocoa-300 hover:border-cocoa-400"
        }`}
      >
        {value ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={value} alt="Watch preview" className="max-h-44 w-auto rounded object-contain" />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange("");
              }}
              className="absolute right-2 top-2 rounded-full bg-white/90 px-2 py-1 text-xs font-medium text-cocoa-700 shadow-sm hover:bg-white"
            >
              Remove
            </button>
          </>
        ) : (
          <>
            <span className="text-2xl" aria-hidden>
              🖼️
            </span>
            <p className="text-sm font-medium text-cocoa-600">
              {busy ? "Processing…" : "Drag & drop an image, or click to choose"}
            </p>
            <p className="text-xs text-cocoa-400">JPG, PNG or WebP — downscaled and saved with the watch</p>
          </>
        )}
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="text-xs">
        {showUrl ? (
          <input
            className="input"
            value={value.startsWith("data:") ? "" : value}
            onChange={(e) => onChange(e.target.value.trim())}
            placeholder="https://…/watch.jpg"
          />
        ) : (
          <button
            type="button"
            onClick={() => setShowUrl(true)}
            className="text-cocoa-500 underline hover:text-cocoa-700"
          >
            …or paste an image URL instead
          </button>
        )}
      </div>
    </div>
  );
}
