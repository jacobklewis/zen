import { invoke } from "@tauri-apps/api/core";

export type PdfStyle = "document" | "viewer";

/** Export the live rendered document, including edits not yet saved to disk. */
export async function exportPdf(style: PdfStyle = "document"): Promise<void> {
  const editor = document.querySelector(".crepe-host .ProseMirror");
  if (!editor) throw new Error("The document is still loading. Please try again.");

  // The native print sheet renders asynchronously after invoke returns. Keep
  // this print-only preference until the next export instead of clearing it early.
  document.documentElement.dataset.pdfStyle = style;
  await document.fonts.ready;
  // Decoding waits for images already in flight without hanging on broken URLs.
  await Promise.all(
    Array.from(editor.querySelectorAll("img"), (image) =>
      image.decode().catch(() => undefined),
    ),
  );
  // Let font/image layout settle before WebKit measures the printed pages.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await invoke("export_pdf");
}
