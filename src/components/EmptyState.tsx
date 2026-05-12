import { useCallback, useEffect, useState } from "react";
import {
  basename,
  clearRecentFiles,
  dirname,
  getRecentFiles,
} from "../lib/files";

interface EmptyStateProps {
  onOpen: () => void;
  onNew: () => void;
  onPickRecent: (path: string) => void;
}

const MAX_RECENTS_SHOWN = 8;

export function EmptyState({ onOpen, onNew, onPickRecent }: EmptyStateProps) {
  const [recents, setRecents] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    const list = await getRecentFiles();
    setRecents(list.slice(0, MAX_RECENTS_SHOWN));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleClear = useCallback(async () => {
    await clearRecentFiles();
    setRecents([]);
  }, []);

  return (
    <div className="empty-state">
      <div className="empty-state-card">
        <h1>Zen</h1>
        <p>A beautified WYSIWYG editor for your markdown files.</p>
        <div className="empty-state-actions">
          <button type="button" className="primary" onClick={onOpen}>
            Open File
            <span className="kbd">{"\u2318"}O</span>
          </button>
          <button type="button" onClick={onNew}>
            New Document
            <span className="kbd">{"\u2318"}N</span>
          </button>
        </div>
      </div>

      {recents.length > 0 ? (
        <div className="welcome-recents">
          <div className="welcome-recents-header">
            <span className="welcome-recents-title">Recent</span>
            <button
              type="button"
              className="welcome-recents-clear"
              onClick={() => {
                void handleClear();
              }}
            >
              Clear
            </button>
          </div>
          <ul className="welcome-recents-grid">
            {recents.map((path) => (
              <li key={path}>
                <button
                  type="button"
                  className="welcome-recent-tile"
                  onClick={() => onPickRecent(path)}
                  title={path}
                >
                  <span className="welcome-recent-name">{basename(path)}</span>
                  <span className="welcome-recent-dir">{dirname(path)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
