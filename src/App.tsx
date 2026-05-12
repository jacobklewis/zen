import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { getAllWindows, getCurrentWindow } from "@tauri-apps/api/window";
import { CrepeEditor, type CrepeEditorHandle } from "./components/CrepeEditor";
import { EmptyState } from "./components/EmptyState";
import { Sidebar } from "./components/Sidebar";
import {
  basename,
  confirmDiscardChanges,
  pickFileToOpen,
  pickFileToSaveAs,
  pickFolder,
  readFile,
  recordRecentFile,
  writeFile,
} from "./lib/files";
import { onMenu, onOpenFile, type MenuAction } from "./lib/menuEvents";

declare global {
  interface Window {
    __INITIAL_FILE__?: string | null;
  }
}

interface DocumentState {
  path: string | null;
  content: string;
  // Bumped whenever we want to force the editor to re-mount (new file open).
  loadKey: number;
}

const EMPTY_DOC: DocumentState = { path: null, content: "", loadKey: 0 };

const win = getCurrentWindow();
const WINDOW_LABEL = win.label;
const SIDEBAR_VISIBLE_KEY = `markdown:${WINDOW_LABEL}:sidebar-visible`;
const SIDEBAR_FOLDER_KEY = `markdown:${WINDOW_LABEL}:sidebar-folder`;
const INITIAL_FILE = window.__INITIAL_FILE__ ?? null;

function readBoolFromStorage(key: string, fallback: boolean): boolean {
  try {
    const value = localStorage.getItem(key);
    if (value === null) return fallback;
    return value === "true";
  } catch {
    return fallback;
  }
}

function readStringFromStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeToStorage(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* ignore quota errors */
  }
}

function App() {
  const [doc, setDoc] = useState<DocumentState>(EMPTY_DOC);
  const [dirty, setDirty] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(() =>
    readBoolFromStorage(SIDEBAR_VISIBLE_KEY, false),
  );
  const [sidebarFolder, setSidebarFolder] = useState<string | null>(() =>
    readStringFromStorage(SIDEBAR_FOLDER_KEY),
  );
  const editorRef = useRef<CrepeEditorHandle | null>(null);

  // Mirror state into refs so event listeners always see the latest values.
  const docRef = useRef(doc);
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    docRef.current = doc;
  }, [doc]);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    writeToStorage(SIDEBAR_VISIBLE_KEY, String(sidebarVisible));
  }, [sidebarVisible]);

  useEffect(() => {
    writeToStorage(SIDEBAR_FOLDER_KEY, sidebarFolder);
  }, [sidebarFolder]);

  const filename = useMemo(
    () => (doc.path ? basename(doc.path) : doc.loadKey > 0 ? "Untitled.md" : null),
    [doc.path, doc.loadKey],
  );

  useEffect(() => {
    const base = filename ?? "Zen";
    void win.setTitle(dirty ? `${base} \u2014 Edited` : base);
  }, [filename, dirty]);

  const loadFile = useCallback(async (path: string) => {
    const file = await readFile(path);
    setDoc((prev) => ({
      path: file.path,
      content: file.content,
      loadKey: prev.loadKey + 1,
    }));
    setDirty(false);
    void recordRecentFile(file.path);
  }, []);

  const newDocumentHere = useCallback(() => {
    setDoc((prev) => ({
      path: null,
      content: "",
      loadKey: prev.loadKey + 1,
    }));
    setDirty(false);
  }, []);

  const isWindowEmpty = useCallback(() => {
    return (
      !docRef.current.path &&
      !docRef.current.content &&
      !dirtyRef.current
    );
  }, []);

  /**
   * Smart-open: load the file in this window when it's empty/clean, otherwise
   * spawn a new window for it so the user's current document is never disturbed.
   */
  const openSmart = useCallback(
    async (path: string) => {
      if (isWindowEmpty()) {
        await loadFile(path);
      } else {
        try {
          await invoke("open_window_with_file", { path });
        } catch (err) {
          console.error("open_window_with_file failed", path, err);
        }
      }
    },
    [isWindowEmpty, loadFile],
  );

  const openDialog = useCallback(async () => {
    const file = await pickFileToOpen();
    if (!file) return;
    await openSmart(file.path);
  }, [openSmart]);

  const newWindow = useCallback(async () => {
    if (isWindowEmpty()) {
      newDocumentHere();
      return;
    }
    try {
      await invoke("open_new_window");
    } catch (err) {
      console.error("open_new_window failed", err);
    }
  }, [isWindowEmpty, newDocumentHere]);

  const saveCurrent = useCallback(async (): Promise<boolean> => {
    const editor = editorRef.current;
    if (!editor) return false;
    const content = editor.getMarkdown();
    let path = docRef.current.path;
    if (!path) {
      path = await pickFileToSaveAs(content, "Untitled.md");
      if (!path) return false;
    } else {
      await writeFile(path, content);
    }
    setDoc((prev) => ({ ...prev, path: path!, content }));
    setDirty(false);
    void recordRecentFile(path);
    return true;
  }, []);

  const saveAs = useCallback(async (): Promise<boolean> => {
    const editor = editorRef.current;
    if (!editor) return false;
    const content = editor.getMarkdown();
    const path = await pickFileToSaveAs(
      content,
      docRef.current.path ?? "Untitled.md",
    );
    if (!path) return false;
    setDoc((prev) => ({ ...prev, path, content }));
    setDirty(false);
    void recordRecentFile(path);
    return true;
  }, []);

  const closeDocument = useCallback(async (): Promise<boolean> => {
    if (dirtyRef.current && (docRef.current.path || docRef.current.content)) {
      const decision = await confirmDiscardChanges(
        docRef.current.path ? basename(docRef.current.path) : "Untitled.md",
      );
      if (decision === "cancel") return false;
      if (decision === "save") {
        const saved = await saveCurrent();
        if (!saved) return false;
      }
    }
    setDoc(EMPTY_DOC);
    setDirty(false);
    return true;
  }, [saveCurrent]);

  const openFolderDialog = useCallback(async () => {
    const folder = await pickFolder();
    if (folder) {
      setSidebarFolder(folder);
      setSidebarVisible(true);
    }
  }, []);

  const handleSidebarFileSelect = useCallback(
    async (path: string) => {
      if (path === docRef.current.path) return;
      if (!(await closeDocument())) return;
      try {
        await loadFile(path);
      } catch (err) {
        console.error("sidebar load failed", path, err);
      }
    },
    [closeDocument, loadFile],
  );

  // Wire native menu events.
  useEffect(() => {
    const handler = async (action: MenuAction) => {
      try {
        switch (action) {
          case "new":
            await newWindow();
            break;
          case "open":
            await openDialog();
            break;
          case "save":
            await saveCurrent();
            break;
          case "save-as":
            await saveAs();
            break;
          case "close-document": {
            // If we're already on an empty editor and other windows are
            // open, close this window outright (matches what Cmd+W on an
            // empty doc would otherwise feel like).
            if (isWindowEmpty()) {
              try {
                const all = await getAllWindows();
                if (all.length > 1) {
                  await getCurrentWindow().destroy();
                  return;
                }
              } catch (err) {
                console.error("getAllWindows failed", err);
              }
            }
            await closeDocument();
            break;
          }
          case "toggle-sidebar":
            setSidebarVisible((v) => !v);
            break;
          case "open-folder":
            await openFolderDialog();
            break;
        }
      } catch (err) {
        console.error("menu action failed", action, err);
      }
    };
    const unlisten = onMenu(handler);
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [
    closeDocument,
    isWindowEmpty,
    newWindow,
    openDialog,
    openFolderDialog,
    saveAs,
    saveCurrent,
  ]);

  // Wire OS "Open With..." events (and Open Recent menu, which goes through
  // the same channel from Rust).
  useEffect(() => {
    const unlisten = onOpenFile(async (path) => {
      try {
        await openSmart(path);
      } catch (err) {
        console.error("open-file failed", path, err);
      }
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [openSmart]);

  // On first mount, load the initial file. Spawned windows get one via the
  // injected __INITIAL_FILE__ global; the main window drains the cold-start
  // "Open With..." buffer instead.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (INITIAL_FILE) {
        try {
          await loadFile(INITIAL_FILE);
        } catch (err) {
          console.error("initial file load failed", INITIAL_FILE, err);
        }
        return;
      }
      if (WINDOW_LABEL !== "main") return;
      try {
        const paths = await invoke<string[]>("take_pending_files");
        if (cancelled) return;
        const path = paths[0];
        if (path) await loadFile(path);
      } catch (err) {
        console.error("take_pending_files failed", err);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [loadFile]);

  // Intercept window close when there are unsaved changes.
  useEffect(() => {
    let unlistenFn: (() => void) | undefined;
    void win
      .onCloseRequested(async (event) => {
        try {
          if (!dirtyRef.current) {
            // No-op: onCloseRequested auto-calls window.destroy() if we
            // don't preventDefault.
            return;
          }
          event.preventDefault();
          const decision = await confirmDiscardChanges(
            docRef.current.path
              ? basename(docRef.current.path)
              : "Untitled.md",
          );
          if (decision === "cancel") return;
          if (decision === "save") {
            const saved = await saveCurrent();
            if (!saved) return;
          }
          // Use destroy() to bypass closeRequested and avoid re-prompting.
          await win.destroy();
        } catch (err) {
          console.error("close handler failed", err);
        }
      })
      .then((fn) => {
        unlistenFn = fn;
      });
    return () => {
      unlistenFn?.();
    };
  }, [saveCurrent]);

  const handleEditorChange = useCallback((markdown: string) => {
    if (markdown !== docRef.current.content) {
      setDirty(true);
    }
  }, []);

  const showEditor = doc.loadKey > 0 || doc.path !== null;

  return (
    <div className={`app ${sidebarVisible ? "sidebar-on" : ""}`}>
      <div className="titlebar" data-tauri-drag-region>
        <span className="title" data-tauri-drag-region>
          {filename ?? "Zen"}
        </span>
        <span
          className={`dirty-dot ${dirty ? "visible" : ""}`}
          data-tauri-drag-region
        />
      </div>
      <div className="workspace">
        {sidebarVisible && (
          <Sidebar
            folder={sidebarFolder}
            currentPath={doc.path}
            onFolderChange={setSidebarFolder}
            onFileSelect={handleSidebarFileSelect}
          />
        )}
        <div className="editor-shell">
          {showEditor ? (
            <CrepeEditor
              key={doc.loadKey}
              ref={editorRef}
              defaultValue={doc.content}
              onChange={handleEditorChange}
            />
          ) : (
            <EmptyState
              onOpen={openDialog}
              onNew={newWindow}
              onPickRecent={openSmart}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
