import { invoke } from "@tauri-apps/api/core";
import { open, save, ask } from "@tauri-apps/plugin-dialog";
import { readDir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

const MARKDOWN_FILTERS = [
  { name: "Markdown", extensions: ["md", "markdown", "mdx"] },
];

export interface LoadedFile {
  path: string;
  content: string;
}

export async function pickFileToOpen(): Promise<LoadedFile | null> {
  const selected = await open({
    multiple: false,
    directory: false,
    filters: MARKDOWN_FILTERS,
  });
  if (!selected || typeof selected !== "string") return null;
  return readFile(selected);
}

export async function readFile(path: string): Promise<LoadedFile> {
  const content = await readTextFile(path);
  return { path, content };
}

export async function writeFile(path: string, content: string): Promise<void> {
  await writeTextFile(path, content);
}

export async function pickFileToSaveAs(
  content: string,
  defaultPath?: string | null,
): Promise<string | null> {
  const path = await save({
    defaultPath: defaultPath ?? "Untitled.md",
    filters: MARKDOWN_FILTERS,
  });
  if (!path) return null;
  await writeTextFile(path, content);
  return path;
}

export type DirtyDecision = "save" | "discard" | "cancel";

export async function confirmDiscardChanges(
  filename: string,
): Promise<DirtyDecision> {
  // The macOS-style three-button prompt isn't available in @tauri-apps/plugin-dialog
  // (only ask/confirm with two buttons). We use a two-step flow that mirrors
  // the native experience: first ask whether to save, then offer cancel.
  const wantsToSave = await ask(
    `Do you want to save the changes to "${filename}"?\n\nYour changes will be lost if you don't save them.`,
    {
      title: "Unsaved Changes",
      kind: "warning",
      okLabel: "Save",
      cancelLabel: "Don't Save",
    },
  );
  if (wantsToSave) return "save";

  const reallyDiscard = await ask("Discard changes and continue?", {
    title: "Discard Changes?",
    kind: "warning",
    okLabel: "Discard",
    cancelLabel: "Cancel",
  });
  return reallyDiscard ? "discard" : "cancel";
}

export function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export async function recordRecentFile(path: string): Promise<void> {
  try {
    await invoke("add_recent_file", { path });
  } catch (err) {
    console.error("add_recent_file failed", path, err);
  }
}

export async function getRecentFiles(): Promise<string[]> {
  try {
    return await invoke<string[]>("get_recent_files");
  } catch (err) {
    console.error("get_recent_files failed", err);
    return [];
  }
}

export async function clearRecentFiles(): Promise<void> {
  try {
    await invoke("clear_recent_files");
  } catch (err) {
    console.error("clear_recent_files failed", err);
  }
}

export function dirname(path: string): string {
  const sep = path.includes("\\") && !path.includes("/") ? "\\" : "/";
  const idx = path.lastIndexOf(sep);
  return idx <= 0 ? "" : path.slice(0, idx);
}

function joinPath(parent: string, name: string): string {
  if (!parent) return name;
  const sep = parent.includes("\\") && !parent.includes("/") ? "\\" : "/";
  return parent.endsWith(sep) ? parent + name : parent + sep + name;
}

const MARKDOWN_EXTENSIONS = new Set(["md", "markdown", "mdx"]);

export function hasMarkdownExtension(name: string): boolean {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return false;
  return MARKDOWN_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

export interface TreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: TreeNode[];
}

export async function pickFolder(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    directory: true,
  });
  if (!selected || typeof selected !== "string") return null;
  return selected;
}

/**
 * Walks `folder` and returns a tree containing only `.md`/`.markdown`/`.mdx`
 * files. Empty directories are pruned. Hidden entries (leading `.`) and
 * common heavy folders (`node_modules`, `.git`) are skipped.
 */
export async function listMarkdownFiles(folder: string): Promise<TreeNode[]> {
  return walk(folder);
}

async function walk(folder: string): Promise<TreeNode[]> {
  let entries;
  try {
    entries = await readDir(folder);
  } catch (err) {
    console.error("readDir failed", folder, err);
    return [];
  }

  const dirs: TreeNode[] = [];
  const files: TreeNode[] = [];

  for (const entry of entries) {
    if (!entry.name || entry.name.startsWith(".")) continue;
    if (entry.isDirectory) {
      if (entry.name === "node_modules") continue;
      const childPath = joinPath(folder, entry.name);
      const children = await walk(childPath);
      if (children.length === 0) continue;
      dirs.push({
        name: entry.name,
        path: childPath,
        isDirectory: true,
        children,
      });
    } else if (entry.isFile && hasMarkdownExtension(entry.name)) {
      files.push({
        name: entry.name,
        path: joinPath(folder, entry.name),
        isDirectory: false,
      });
    }
  }

  const cmp = (a: TreeNode, b: TreeNode) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  dirs.sort(cmp);
  files.sort(cmp);
  return [...dirs, ...files];
}
