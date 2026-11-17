import katex from "katex";
import hljs from "highlight.js/lib/common";
import readerCss from "./reader.css?raw";
import readerScript from "./reader.js?raw";
import katexCss from "katex/dist/katex.min.css?raw";

/** A snapshot of the editor's ProseMirror document, independent of its viewport. */
export interface DocumentNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: DocumentNode[];
}

interface Section {
  node: DocumentNode;
  id: string;
  level: number;
  blocks: DocumentNode[];
  sections: Section[];
}

export interface HtmlExportOptions {
  title: string;
  loadImage: (source: string) => Promise<string>;
}

const fontUrls = import.meta.glob<string>("/node_modules/katex/dist/fonts/*.woff2", {
  eager: true,
  query: "?url",
  import: "default",
});

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]!);
}

function textOf(node: DocumentNode): string {
  return node.text ?? node.content?.map(textOf).join("") ?? "";
}

function slug(text: string): string {
  return text.normalize("NFKC").toLowerCase().trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/[\s_]+/g, "-") || "section";
}

function safeLink(value: unknown): string | null {
  const href = String(value ?? "").trim();
  try {
    const url = new URL(href, "https://document.invalid/");
    return ["http:", "https:", "mailto:", "tel:"].includes(url.protocol) ? href : null;
  } catch { return null; }
}

export function dataUrl(bytes: Uint8Array, mime: string): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

let mathStylePromise: Promise<string> | undefined;
function mathStyles(): Promise<string> {
  return mathStylePromise ??= (async () => {
    const fonts = new Map<string, string>();
    await Promise.all(Object.entries(fontUrls).map(async ([path, url]) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error("Could not embed equation fonts.");
      fonts.set(path.split("/").pop()!, dataUrl(new Uint8Array(await response.arrayBuffer()), "font/woff2"));
    }));
    // Embed only WOFF2; remove all fallback URLs so the file has no dependencies.
    return katexCss.replace(/src:([^;]+);/g, (_match, sources: string) => {
      const name = sources.match(/(?:fonts\/)?([^/()"']+\.woff2)/)?.[1];
      const font = name && fonts.get(name);
      if (!font) throw new Error("Could not package an equation font.");
      return `src:url(${font}) format('woff2');`;
    });
  })().catch((error) => { mathStylePromise = undefined; throw error; });
}

/** Build a portable reader. Markdown HTML is treated as text, never executed. */
export async function buildInteractiveHtml(doc: DocumentNode, options: HtmlExportOptions): Promise<string> {
  const sections: Section[] = [];
  const intro: DocumentNode[] = [];
  const stack: Section[] = [];
  const usedIds = new Set<string>();
  const anchors = new Map<string, string>();
  const images = new Map<string, string>();
  let hasMath = false;

  for (const node of doc.content ?? []) {
    if (node.type === "heading") {
      const level = Math.max(1, Math.min(6, Number(node.attrs?.level) || 1));
      const base = slug(textOf(node));
      let id = `section-${base}`;
      let suffix = 2;
      while (usedIds.has(id)) id = `section-${base}-${suffix++}`;
      usedIds.add(id);
      if (!anchors.has(base)) anchors.set(base, id);
      const section: Section = { node, id, level, blocks: [], sections: [] };
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      (stack.length ? stack[stack.length - 1].sections : sections).push(section);
      stack.push(section);
    } else {
      (stack.length ? stack[stack.length - 1].blocks : intro).push(node);
    }
  }

  const sources = new Set<string>();
  function collect(node: DocumentNode) {
    if (node.type === "image" || node.type === "image-block") sources.add(String(node.attrs?.src ?? ""));
    if (node.type === "math_inline" || (node.type === "code_block" && String(node.attrs?.language).toLowerCase() === "latex")) hasMath = true;
    node.content?.forEach(collect);
  }
  collect(doc);
  // Avoid launching an unbounded number of downloads for image-heavy documents.
  const pending = [...sources];
  await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
    while (pending.length) {
      const source = pending.shift()!;
      try {
        const embedded = await options.loadImage(source);
        if (!/^data:image\/(?:png|jpe?g|gif|webp|svg\+xml|avif|bmp|x-icon);base64,[a-z\d+/=]+$/i.test(embedded)) {
          throw new Error("Unsupported image format");
        }
        images.set(source, embedded);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Could not embed image: ${source.slice(0, 180)}. ${reason}. Local images must be in the document folder; remote servers must allow image downloads.`);
      }
    }
  }));

  function render(node: DocumentNode): string {
    const attrs = node.attrs ?? {};
    const children = () => (node.content ?? []).map(render).join("");
    let html: string;
    switch (node.type) {
      case "text": html = escapeHtml(node.text); break;
      case "paragraph": html = `<p>${children()}</p>`; break;
      case "heading": html = `<h${Number(attrs.level) || 2}>${children()}</h${Number(attrs.level) || 2}>`; break;
      case "hardbreak": case "hard_break": html = "<br>"; break;
      case "hr": case "horizontal_rule": html = "<hr>"; break;
      case "blockquote": html = `<blockquote>${children()}</blockquote>`; break;
      case "bullet_list": html = `<ul>${children()}</ul>`; break;
      case "ordered_list": html = `<ol start="${Math.max(1, Number(attrs.order) || 1)}">${children()}</ol>`; break;
      case "list_item": html = typeof attrs.checked === "boolean"
        ? `<li class="task"><input type="checkbox" disabled aria-label="Task status" ${attrs.checked ? "checked" : ""}>${children()}</li>`
        : `<li>${children()}</li>`; break;
      case "table": html = `<div class="table-scroll" tabindex="0" role="region" aria-label="Table"><table>${children()}</table></div>`; break;
      case "table_row": html = `<tr>${children()}</tr>`; break;
      case "table_header": case "table_cell": {
        const tag = node.type === "table_header" ? "th" : "td";
        const align = ["left", "center", "right"].includes(String(attrs.alignment)) ? String(attrs.alignment) : "left";
        html = `<${tag} style="text-align:${align}" colspan="${Math.max(1, Number(attrs.colspan) || 1)}" rowspan="${Math.max(1, Number(attrs.rowspan) || 1)}">${children()}</${tag}>`;
        break;
      }
      case "image": case "image-block": {
        const caption = String(attrs.caption ?? attrs.title ?? "");
        const image = `<img src="${escapeHtml(images.get(String(attrs.src ?? "")))}" alt="${escapeHtml(attrs.alt ?? caption)}" decoding="async">`;
        html = node.type === "image-block" ? `<figure>${image}${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ""}</figure>` : image;
        break;
      }
      case "math_inline": html = katex.renderToString(String(attrs.value ?? ""), { throwOnError: false, trust: false, maxExpand: 1000 }); break;
      case "code_block": {
        const code = textOf(node);
        const language = String(attrs.language ?? "").toLowerCase();
        if (language === "latex") {
          html = `<div class="equation">${katex.renderToString(code, { displayMode: true, throwOnError: false, trust: false, maxExpand: 1000 })}</div>`;
          break;
        }
        const highlighted = language && hljs.getLanguage(language) ? hljs.highlight(code, { language, ignoreIllegals: true }).value : escapeHtml(code);
        html = `<div class="code-block"><div class="code-toolbar"><span>${escapeHtml(language || "Code")}</span><button type="button" class="copy-code enhancement">Copy code</button></div><pre><code>${highlighted}</code></pre></div>`;
        break;
      }
      default: html = node.content ? children() : escapeHtml(node.text ?? attrs.value ?? "");
    }
    for (const mark of node.marks ?? []) {
      const tags: Record<string, string> = { strong: "strong", emphasis: "em", em: "em", inlineCode: "code", code: "code", strike_through: "s", strikethrough: "s" };
      if (tags[mark.type]) html = `<${tags[mark.type]}>${html}</${tags[mark.type]}>`;
      else if (mark.type === "link") {
        let href = safeLink(mark.attrs?.href);
        if (href?.startsWith("#")) {
          try { href = `#${anchors.get(decodeURIComponent(href.slice(1))) ?? href.slice(1)}`; } catch { /* preserve malformed fragment as text */ }
        }
        if (href !== null) html = `<a href="${escapeHtml(href)}" rel="noreferrer noopener">${html}</a>`;
      }
    }
    return html;
  }

  function renderSection(section: Section): string {
    return `<details class="section" open><summary><h${section.level} id="${escapeHtml(section.id)}" tabindex="-1">${section.node.content?.map(render).join("") || "Untitled section"}</h${section.level}></summary><div class="section-body">${section.blocks.map(render).join("")}${section.sections.map(renderSection).join("")}</div></details>`;
  }
  function toc(items: Section[]): string {
    return `<ol>${items.map((section) => `<li><a href="#${escapeHtml(section.id)}">${escapeHtml(textOf(section.node) || "Untitled section")}</a>${section.sections.length ? toc(section.sections) : ""}</li>`).join("")}</ol>`;
  }
  const mathCss = hasMath ? await mathStyles() : "";
  const hash = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(readerScript)))));
  const title = escapeHtml(options.title || "Untitled document");
  return `<!DOCTYPE html>
<html lang="en" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'sha256-${hash}'; base-uri 'none'; form-action 'none'"><meta name="color-scheme" content="light dark"><title>${title}</title><style>${readerCss}\n${mathCss}</style></head>
<body id="document-top"><a class="skip-link" href="#document-content">Skip to document</a><header class="topbar"><a class="document-name" href="#document-top">${title}</a><div class="reader-tools enhancement"><label for="document-search">Search</label><input id="document-search" type="search" placeholder="Find in document" autocomplete="off"><button id="search-prev" type="button" aria-label="Previous match" disabled>↑</button><button id="search-next" type="button" aria-label="Next match" disabled>↓</button><output id="search-status" aria-live="polite"></output><button id="theme-toggle" type="button" aria-label="Switch to dark theme">Dark mode</button></div></header>
<div class="layout"><aside><details class="contents" open><summary>On this page</summary><nav aria-label="Table of contents">${sections.length ? toc(sections) : '<p class="muted">This document has no sections.</p>'}</nav><div class="section-tools enhancement"><button id="expand-all" type="button">Expand all</button><button id="collapse-all" type="button">Collapse all</button></div></details></aside><main id="document-content" tabindex="-1"><article>${intro.map(render).join("")}${sections.map(renderSection).join("")}</article></main></div><div id="reader-status" class="sr-only" role="status"></div><script>${readerScript}</script></body></html>`;
}
