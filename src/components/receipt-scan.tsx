"use client";

import { useRef, useState, useTransition } from "react";
import { IconCamera } from "@/components/ui";
import type { ScanResult } from "@/lib/receipt-scan";

// Phone photos are 2–8MB; server actions cap the request body. Downscaling
// to 1600px JPEG lands around 150–450KB and reads just as well.
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.8;
// If we can't re-encode locally, only originals this small go up as-is.
const PASSTHROUGH_LIMIT = 900 * 1024;
const PASSTHROUGH_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"];
// Mirrors scanInputSchema's base64 ceiling.
const MAX_BASE64_CHARS = 2_800_000;

interface Upload {
  mimeType: string;
  base64: string;
}

async function compressToJpeg(file: File): Promise<Upload | null> {
  try {
    // createImageBitmap also decodes HEIC on Safari, normalizing iPhone
    // photos to JPEG for the API.
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    return { mimeType: "image/jpeg", base64: dataUrl.slice(dataUrl.indexOf(",") + 1) };
  } catch {
    return null;
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = reader.result as string;
      resolve(s.slice(s.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function prepareUpload(file: File): Promise<Upload | { error: string }> {
  const compressed = await compressToJpeg(file);
  if (compressed) return compressed;
  if (file.size > PASSTHROUGH_LIMIT || !PASSTHROUGH_TYPES.includes(file.type)) {
    return { error: "Couldn't process that photo here — try a screenshot or a smaller image" };
  }
  try {
    return { mimeType: file.type, base64: await fileToBase64(file) };
  } catch {
    return { error: "Couldn't read that file — try another photo" };
  }
}

export function ReceiptScanButton({
  scanAction,
  onResult,
}: {
  scanAction: (input: unknown) => Promise<{ result?: ScanResult; error?: string }>;
  onResult: (result: ScanResult) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleFile = (file: File) => {
    setError(null);
    startTransition(async () => {
      const upload = await prepareUpload(file);
      if ("error" in upload) {
        setError(upload.error);
        return;
      }
      if (upload.base64.length > MAX_BASE64_CHARS) {
        setError("That photo is too large — try a smaller one");
        return;
      }
      const res = await scanAction(upload);
      if (!res.result) {
        setError(res.error ?? "Something went wrong — try again");
        return;
      }
      onResult(res.result);
    });
  };

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Reset so re-picking the same photo fires onChange again.
          e.target.value = "";
          if (file) handleFile(file);
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={pending}
        className="btn btn-ghost min-h-10 px-4 text-sm"
      >
        <IconCamera className="size-4" />
        {pending ? "Reading receipt…" : "Scan a receipt photo"}
      </button>
      {error && (
        <p role="alert" className="mt-1.5 text-sm text-neg">
          {error}
        </p>
      )}
    </div>
  );
}
