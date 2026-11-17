import { invoke } from "@tauri-apps/api/core";
import { dirname, isAbsolute, resolve } from "@tauri-apps/api/path";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { buildInteractiveHtml, dataUrl, type DocumentNode } from "./document";

const MAX_IMAGE_BYTES = 32 * 1024 * 1024;

function imageMime(bytes: Uint8Array): string {
  const head = new TextDecoder().decode(bytes.subarray(0, 1024));
  if (bytes[0] === 0x89 && head.slice(1, 4) === "PNG") return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (head.startsWith("GIF8")) return "image/gif";
  if (head.startsWith("RIFF") && head.slice(8, 12) === "WEBP") return "image/webp";
  if (head.slice(4, 8) === "ftyp" && /avif|avis/.test(head.slice(8, 32))) return "image/avif";
  if (head.startsWith("BM")) return "image/bmp";
  if (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0) return "image/x-icon";
  if (/^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(head)) return "image/svg+xml";
  throw new Error("Unsupported image format");
}

async function embedImage(source: string, documentPath: string | null): Promise<string> {
  let bytes: Uint8Array;
  if (/^(https?:|data:|blob:)/i.test(source)) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(source, { signal: controller.signal, credentials: "omit", referrerPolicy: "no-referrer" });
      if (!response.ok || Number(response.headers.get("content-length")) > MAX_IMAGE_BYTES) throw new Error("Image could not be loaded");
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Image could not be loaded");
      const chunks: Uint8Array[] = [];
      let length = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > MAX_IMAGE_BYTES) { await reader.cancel(); throw new Error("Image exceeds the 32 MB export limit"); }
        chunks.push(value);
      }
      bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    } finally { clearTimeout(timeout); }
  } else {
    if (!documentPath) throw new Error("Save the Markdown document before exporting local images");
    let path: string;
    if (/^file:/i.test(source)) {
      const url = new URL(source);
      if (url.hostname && url.hostname !== "localhost") throw new Error("Unsupported image location");
      path = decodeURIComponent(url.pathname).replace(/^\/([a-z]:\/)/i, "$1");
    } else {
      path = decodeURIComponent(source.split(/[?#]/)[0]);
      if (!(await isAbsolute(path))) path = await resolve(await dirname(documentPath), path);
    }
    bytes = new Uint8Array(await invoke<number[]>("read_export_image", { imagePath: path, documentPath }));
  }
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error("Image exceeds the 32 MB export limit");
  return dataUrl(bytes, imageMime(bytes));
}

export async function exportInteractiveHtml(doc: DocumentNode, documentPath: string | null): Promise<void> {
  const defaultPath = documentPath ? documentPath.replace(/\.(md|markdown|mdx)$/i, "") + ".html" : "Untitled.html";
  const path = await save({ defaultPath, filters: [{ name: "Interactive HTML", extensions: ["html"] }] });
  if (!path) return;
  if (path === documentPath) throw new Error("Choose an HTML filename different from the Markdown document.");
  const firstTitle = doc.content?.find((node) => node.type === "heading" && node.attrs?.level === 1);
  const title = firstTitle?.content?.map((node) => node.text ?? "").join("") || defaultPath.split(/[\\/]/).pop()!.replace(/\.html$/i, "");
  const html = await buildInteractiveHtml(doc, { title, loadImage: (source) => embedImage(source, documentPath) });
  await writeTextFile(path, html);
}
