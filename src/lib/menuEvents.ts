import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

export type MenuAction =
  | "new"
  | "open"
  | "save"
  | "save-as"
  | "export-pdf"
  | "export-pdf-viewer"
  | "export-html"
  | "close-document"
  | "toggle-sidebar"
  | "open-folder";

export function onMenu(
  handler: (action: MenuAction) => void,
): Promise<UnlistenFn> {
  // Global listeners also receive events addressed to other window labels.
  return getCurrentWindow().listen<string>("menu", (event) => {
    handler(event.payload as MenuAction);
  });
}

export function onOpenFile(
  handler: (path: string) => void,
): Promise<UnlistenFn> {
  return getCurrentWindow().listen<string>("open-file", (event) => {
    handler(event.payload);
  });
}
