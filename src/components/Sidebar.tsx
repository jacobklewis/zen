import { useEffect, useMemo, useState } from "react";
import {
  basename,
  listMarkdownFiles,
  pickFolder,
  type TreeNode,
} from "../lib/files";

interface SidebarProps {
  folder: string | null;
  currentPath: string | null;
  onFolderChange: (folder: string | null) => void;
  onFileSelect: (path: string) => void;
}

export function Sidebar({
  folder,
  currentPath,
  onFolderChange,
  onFileSelect,
}: SidebarProps) {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!folder) {
      setTree([]);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    listMarkdownFiles(folder)
      .then((nodes) => {
        if (!cancelled) setTree(nodes);
      })
      .catch((err) => {
        if (!cancelled) {
          console.error(err);
          setError("Couldn't read this folder.");
          setTree([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [folder]);

  const handleOpen = async () => {
    const picked = await pickFolder();
    if (picked) onFolderChange(picked);
  };

  const handleClose = () => {
    onFolderChange(null);
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-title">
          {folder ? basename(folder) : "Workspace"}
        </span>
        {folder ? (
          <button
            type="button"
            className="sidebar-icon-btn"
            onClick={handleOpen}
            title="Open another folder"
            aria-label="Open another folder"
          >
            {"\u2026"}
          </button>
        ) : null}
      </div>

      <div className="sidebar-body">
        {!folder && (
          <div className="sidebar-empty">
            <p>Open a folder to browse its markdown files.</p>
            <button type="button" className="primary" onClick={handleOpen}>
              Open Folder
            </button>
          </div>
        )}

        {folder && loading && <div className="sidebar-status">Loading…</div>}
        {folder && error && <div className="sidebar-status error">{error}</div>}
        {folder && !loading && !error && tree.length === 0 && (
          <div className="sidebar-status">No markdown files in this folder.</div>
        )}
        {folder && !loading && !error && tree.length > 0 && (
          <Tree
            nodes={tree}
            currentPath={currentPath}
            onFileSelect={onFileSelect}
          />
        )}
      </div>

      {folder && (
        <button
          type="button"
          className="sidebar-close-folder"
          onClick={handleClose}
        >
          Close Folder
        </button>
      )}
    </aside>
  );
}

interface TreeProps {
  nodes: TreeNode[];
  currentPath: string | null;
  onFileSelect: (path: string) => void;
  depth?: number;
}

function Tree({ nodes, currentPath, onFileSelect, depth = 0 }: TreeProps) {
  return (
    <ul className="tree" style={{ paddingLeft: depth === 0 ? 0 : 12 }}>
      {nodes.map((node) =>
        node.isDirectory ? (
          <DirectoryNode
            key={node.path}
            node={node}
            currentPath={currentPath}
            onFileSelect={onFileSelect}
            depth={depth}
          />
        ) : (
          <FileNode
            key={node.path}
            node={node}
            currentPath={currentPath}
            onFileSelect={onFileSelect}
          />
        ),
      )}
    </ul>
  );
}

interface DirectoryNodeProps {
  node: TreeNode;
  currentPath: string | null;
  onFileSelect: (path: string) => void;
  depth: number;
}

function DirectoryNode({
  node,
  currentPath,
  onFileSelect,
  depth,
}: DirectoryNodeProps) {
  const containsCurrent = useMemo(
    () => (currentPath ? containsPath(node, currentPath) : false),
    [node, currentPath],
  );
  const [open, setOpen] = useState(depth === 0 || containsCurrent);

  useEffect(() => {
    if (containsCurrent) setOpen(true);
  }, [containsCurrent]);

  return (
    <li className="tree-item">
      <button
        type="button"
        className="tree-row tree-dir"
        onClick={() => setOpen((o) => !o)}
      >
        <span className={`tree-chevron ${open ? "open" : ""}`}>
          {"\u203A"}
        </span>
        <span className="tree-label">{node.name}</span>
      </button>
      {open && node.children && (
        <Tree
          nodes={node.children}
          currentPath={currentPath}
          onFileSelect={onFileSelect}
          depth={depth + 1}
        />
      )}
    </li>
  );
}

interface FileNodeProps {
  node: TreeNode;
  currentPath: string | null;
  onFileSelect: (path: string) => void;
}

function FileNode({ node, currentPath, onFileSelect }: FileNodeProps) {
  const isCurrent = currentPath === node.path;
  return (
    <li className="tree-item">
      <button
        type="button"
        className={`tree-row tree-file ${isCurrent ? "current" : ""}`}
        onClick={() => onFileSelect(node.path)}
      >
        <span className="tree-label">{node.name}</span>
      </button>
    </li>
  );
}

function containsPath(node: TreeNode, target: string): boolean {
  if (!node.children) return false;
  for (const child of node.children) {
    if (child.path === target) return true;
    if (child.isDirectory && containsPath(child, target)) return true;
  }
  return false;
}
