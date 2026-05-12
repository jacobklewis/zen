use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder},
    AppHandle, Emitter, Manager, RunEvent, State, TitleBarStyle, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, Wry,
};

const MAX_RECENTS: usize = 10;
const RECENTS_FILE: &str = "recent.json";

const WINDOW_DEFAULT_WIDTH: f64 = 980.0;
const WINDOW_DEFAULT_HEIGHT: f64 = 720.0;
const WINDOW_MIN_WIDTH: f64 = 480.0;
const WINDOW_MIN_HEIGHT: f64 = 360.0;

#[derive(Default)]
struct PendingFiles(Mutex<Vec<String>>);

#[derive(Default)]
struct WindowCounter(AtomicUsize);

#[tauri::command]
fn take_pending_files(state: State<'_, PendingFiles>) -> Vec<String> {
    let mut buf = state.0.lock().expect("pending files mutex poisoned");
    std::mem::take(&mut *buf)
}

struct Recents {
    paths: Mutex<Vec<String>>,
    file_path: PathBuf,
}

impl Recents {
    fn load(app: &AppHandle) -> Self {
        let dir = app
            .path()
            .app_config_dir()
            .unwrap_or_else(|_| PathBuf::from("."));
        let _ = fs::create_dir_all(&dir);
        let file_path = dir.join(RECENTS_FILE);
        let paths: Vec<String> = fs::read_to_string(&file_path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        Self {
            paths: Mutex::new(paths),
            file_path,
        }
    }

    fn save_to_disk(&self) {
        let snapshot = self
            .paths
            .lock()
            .expect("recents mutex poisoned")
            .clone();
        if let Ok(json) = serde_json::to_string_pretty(&snapshot) {
            let _ = fs::write(&self.file_path, json);
        }
    }

    fn add(&self, path: String) {
        let mut paths = self.paths.lock().expect("recents mutex poisoned");
        paths.retain(|p| p != &path);
        paths.insert(0, path);
        paths.truncate(MAX_RECENTS);
        drop(paths);
        self.save_to_disk();
    }

    fn clear(&self) {
        self.paths.lock().expect("recents mutex poisoned").clear();
        self.save_to_disk();
    }

    fn list(&self) -> Vec<String> {
        self.paths
            .lock()
            .expect("recents mutex poisoned")
            .clone()
    }
}

#[tauri::command]
fn add_recent_file(path: String, app: AppHandle) -> Result<(), String> {
    app.state::<Recents>().add(path);
    rebuild_menu(&app).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_recent_files(state: State<'_, Recents>) -> Vec<String> {
    state.list()
}

#[tauri::command]
fn clear_recent_files(app: AppHandle) -> Result<(), String> {
    app.state::<Recents>().clear();
    rebuild_menu(&app).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_window_with_file(path: String, app: AppHandle) -> Result<(), String> {
    spawn_editor_window(&app, Some(path))
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn open_new_window(app: AppHandle) -> Result<(), String> {
    spawn_editor_window(&app, None)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

fn next_window_label(app: &AppHandle) -> String {
    let counter = app.state::<WindowCounter>();
    let n = counter.0.fetch_add(1, Ordering::SeqCst) + 1;
    format!("editor-{n}")
}

fn spawn_editor_window(app: &AppHandle, file: Option<String>) -> tauri::Result<WebviewWindow> {
    let label = next_window_label(app);

    // Pass the initial file via an injected global so the React app can pick
    // it up on mount without dealing with URL escaping in the hash.
    let init_script = if let Some(ref path) = file {
        let json = serde_json::to_string(path).unwrap_or_else(|_| "null".to_string());
        format!("window.__INITIAL_FILE__ = {json};")
    } else {
        "window.__INITIAL_FILE__ = null;".to_string()
    };

    let mut builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title("Zen")
        .inner_size(WINDOW_DEFAULT_WIDTH, WINDOW_DEFAULT_HEIGHT)
        .min_inner_size(WINDOW_MIN_WIDTH, WINDOW_MIN_HEIGHT)
        .center()
        .initialization_script(init_script);

    #[cfg(target_os = "macos")]
    {
        builder = builder
            .title_bar_style(TitleBarStyle::Overlay)
            .hidden_title(true);
    }

    let window = builder.build()?;
    Ok(window)
}

fn focused_window_label(app: &AppHandle) -> Option<String> {
    let windows = app.webview_windows();
    for (label, window) in &windows {
        if window.is_focused().unwrap_or(false) {
            return Some(label.clone());
        }
    }
    // No focused window (e.g. another app focused). Fall back to main, then
    // any window we can find.
    if windows.contains_key("main") {
        return Some("main".to_string());
    }
    windows.keys().next().cloned()
}

fn emit_to_focused<S: serde::Serialize + Clone>(app: &AppHandle, event: &str, payload: S) {
    if let Some(label) = focused_window_label(app) {
        let _ = app.emit_to(label.as_str(), event, payload);
    }
}

fn display_label(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|n| n.to_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| path.to_string())
}

fn build_recent_submenu(
    app: &AppHandle,
    recents: &[String],
) -> tauri::Result<tauri::menu::Submenu<Wry>> {
    let mut builder = SubmenuBuilder::new(app, "Open Recent");

    if recents.is_empty() {
        let placeholder = MenuItemBuilder::new("(No Recent Files)")
            .id("recent::placeholder")
            .enabled(false)
            .build(app)?;
        builder = builder.item(&placeholder);
    } else {
        for (idx, path) in recents.iter().enumerate() {
            let item = MenuItemBuilder::new(display_label(path))
                .id(format!("recent::{idx}"))
                .build(app)?;
            builder = builder.item(&item);
        }
        builder = builder.separator();
        let clear_item = MenuItemBuilder::new("Clear Menu")
            .id("recent::clear")
            .build(app)?;
        builder = builder.item(&clear_item);
    }

    builder.build()
}

fn build_menu(app: &AppHandle, recents: &[String]) -> tauri::Result<tauri::menu::Menu<Wry>> {
    let app_name = app.package_info().name.clone();

    let app_submenu = SubmenuBuilder::new(app, &app_name)
        .item(&PredefinedMenuItem::about(app, None, None)?)
        .separator()
        .item(&PredefinedMenuItem::services(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, None)?)
        .build()?;

    let new_item = MenuItemBuilder::new("New")
        .id("new")
        .accelerator("CmdOrCtrl+N")
        .build(app)?;
    let open_item = MenuItemBuilder::new("Open\u{2026}")
        .id("open")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;
    let recent_submenu = build_recent_submenu(app, recents)?;
    let save_item = MenuItemBuilder::new("Save")
        .id("save")
        .accelerator("CmdOrCtrl+S")
        .build(app)?;
    let save_as_item = MenuItemBuilder::new("Save As\u{2026}")
        .id("save-as")
        .accelerator("CmdOrCtrl+Shift+S")
        .build(app)?;
    let close_doc_item = MenuItemBuilder::new("Close Document")
        .id("close-document")
        .accelerator("CmdOrCtrl+W")
        .build(app)?;

    let file_submenu = SubmenuBuilder::new(app, "File")
        .item(&new_item)
        .item(&open_item)
        .item(&recent_submenu)
        .separator()
        .item(&save_item)
        .item(&save_as_item)
        .separator()
        .item(&close_doc_item)
        .build()?;

    let edit_submenu = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .build()?;

    let toggle_sidebar_item = MenuItemBuilder::new("Toggle Sidebar")
        .id("toggle-sidebar")
        .accelerator("CmdOrCtrl+B")
        .build(app)?;
    let open_folder_item = MenuItemBuilder::new("Open Folder\u{2026}")
        .id("open-folder")
        .accelerator("CmdOrCtrl+Shift+O")
        .build(app)?;

    let view_submenu = SubmenuBuilder::new(app, "View")
        .item(&toggle_sidebar_item)
        .item(&open_folder_item)
        .separator()
        .item(&PredefinedMenuItem::fullscreen(app, None)?)
        .build()?;

    let window_submenu = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::maximize(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::close_window(app, None)?)
        .build()?;

    MenuBuilder::new(app)
        .item(&app_submenu)
        .item(&file_submenu)
        .item(&edit_submenu)
        .item(&view_submenu)
        .item(&window_submenu)
        .build()
}

fn rebuild_menu(app: &AppHandle) -> tauri::Result<()> {
    let recents = app.state::<Recents>().list();
    let menu = build_menu(app, &recents)?;
    app.set_menu(menu)?;
    Ok(())
}

/// Returns true when the window is at least partially visible on a connected
/// monitor. Used to recover from stale window-state-plugin data after the user
/// disconnects an external display.
fn window_is_on_screen(window: &WebviewWindow) -> bool {
    let Ok(monitors) = window.available_monitors() else {
        return true;
    };
    let Ok(pos) = window.outer_position() else {
        return true;
    };
    let Ok(size) = window.outer_size() else {
        return true;
    };

    let win_left = pos.x;
    let win_top = pos.y;
    let win_right = pos.x + size.width as i32;
    let win_bottom = pos.y + size.height as i32;

    monitors.iter().any(|monitor| {
        let mp = monitor.position();
        let ms = monitor.size();
        let mon_left = mp.x;
        let mon_top = mp.y;
        let mon_right = mp.x + ms.width as i32;
        let mon_bottom = mp.y + ms.height as i32;

        // Standard AABB intersection test.
        win_left < mon_right
            && win_right > mon_left
            && win_top < mon_bottom
            && win_bottom > mon_top
    })
}

fn handle_opened_urls(app: &AppHandle, urls: Vec<tauri::Url>) {
    let paths: Vec<String> = urls
        .into_iter()
        .filter_map(|url| url.to_file_path().ok())
        .filter_map(|path| path.to_str().map(|s| s.to_string()))
        .collect();

    if paths.is_empty() {
        return;
    }

    // Always buffer so cold-start "Open With..." cases (where the frontend
    // listener isn't attached yet) are recovered by the main window's
    // take_pending_files call on mount.
    if let Some(state) = app.try_state::<PendingFiles>() {
        let mut buf = state.0.lock().expect("pending files mutex poisoned");
        buf.extend(paths.iter().cloned());
    }

    // While the app is running, route the first file to the focused window
    // (which performs the smart-open dance) and spawn dedicated windows for
    // any additional files dropped on the dock at once.
    let mut iter = paths.into_iter();
    if let Some(first) = iter.next() {
        emit_to_focused(app, "open-file", first);
    }
    for extra in iter {
        let _ = spawn_editor_window(app, Some(extra));
    }
}

fn handle_menu_id(app: &AppHandle, id: &str) {
    if let Some(rest) = id.strip_prefix("recent::") {
        if rest == "clear" {
            app.state::<Recents>().clear();
            let _ = rebuild_menu(app);
            return;
        }
        if rest == "placeholder" {
            return;
        }
        if let Ok(idx) = rest.parse::<usize>() {
            let recents = app.state::<Recents>().list();
            if let Some(path) = recents.get(idx) {
                emit_to_focused(app, "open-file", path.clone());
            }
        }
        return;
    }
    emit_to_focused(app, "menu", id.to_string());
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_window_state::Builder::new().build());
    }

    let app = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .manage(PendingFiles::default())
        .manage(WindowCounter::default())
        .invoke_handler(tauri::generate_handler![
            take_pending_files,
            add_recent_file,
            get_recent_files,
            clear_recent_files,
            open_window_with_file,
            open_new_window,
        ])
        .setup(|app| {
            let recents = Recents::load(app.handle());
            let initial_list = recents.list();
            app.manage(recents);

            let menu = build_menu(app.handle(), &initial_list)?;
            app.set_menu(menu)?;
            app.on_menu_event(|app, event| {
                handle_menu_id(app, event.id().0.as_str());
            });

            if let Some(window) = app.get_webview_window("main") {
                if !window_is_on_screen(&window) {
                    let _ = window.center();
                }
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app_handle, _event| {
        #[cfg(target_os = "macos")]
        match _event {
            RunEvent::Opened { urls } => {
                handle_opened_urls(_app_handle, urls);
            }
            RunEvent::Reopen {
                has_visible_windows,
                ..
            } if !has_visible_windows => {
                let _ = spawn_editor_window(_app_handle, None);
            }
            _ => {}
        }
    });
}
