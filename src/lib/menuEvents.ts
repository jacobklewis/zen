import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type MenuAction =
  | "new"
  | "open"
  | "save"
  | "save-as"
  | "close-document"
  | "toggle-sidebar"
  | "open-folder";

export function onMenu(
  handler: (action: MenuAction) => void,
): Promise<UnlistenFn> {
  return listen<string>("menu", (event) => {
    handler(event.payload as MenuAction);
  });
}

export function onOpenFile(
  handler: (path: string) => void,
): Promise<UnlistenFn> {
  return listen<string>("open-file", (event) => {
    handler(event.payload);
  });
}
