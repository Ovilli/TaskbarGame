#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use tauri::{
    include_image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, WindowEvent,
};

#[derive(Serialize, Clone, Debug)]
struct Anchor {
    x: f64,
    y: f64,
}

fn toggle_window(app: &AppHandle, anchor: Option<Anchor>) {
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    let visible = win.is_visible().unwrap_or(false);
    if visible {
        let _ = win.hide();
        return;
    }

    if let Some(a) = anchor {
        let size = win.outer_size().ok();
        let scale = win.scale_factor().unwrap_or(1.0);
        let (w, h) = match size {
            Some(s) => (s.width as f64, s.height as f64),
            None => (360.0 * scale, 480.0 * scale),
        };
        let monitor = win.current_monitor().ok().flatten();
        let (mw, mh) = monitor
            .as_ref()
            .map(|m| (m.size().width as f64, m.size().height as f64))
            .unwrap_or((1920.0, 1080.0));

        let mut x = a.x - w / 2.0;
        let mut y = a.y - h - 12.0;
        if y < 0.0 {
            y = a.y + 12.0;
        }
        x = x.clamp(8.0, (mw - w - 8.0).max(8.0));
        y = y.clamp(8.0, (mh - h - 8.0).max(8.0));
        let _ = win.set_position(PhysicalPosition::new(x, y));
    }

    let _ = win.show();
    let _ = win.set_focus();
}

fn force_show(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.set_focus();
    }
}

#[tauri::command]
fn show_window(app: AppHandle) {
    toggle_window(&app, None);
}

#[tauri::command]
fn hide_window(app: AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.hide();
    }
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn set_window_size(app: AppHandle, width: f64, height: f64) {
    if !width.is_finite() || !height.is_finite() {
        return;
    }
    let w = width.clamp(300.0, 4096.0);
    let h = height.clamp(440.0, 4096.0);
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_size(LogicalSize::new(w, h));
    }
}

fn build_tray_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let show = MenuItem::with_id(app, "show", "Open Garden", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "Hide", true, None::<&str>)?;
    let about = MenuItem::with_id(app, "about", "About", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    Menu::with_items(app, &[&show, &hide, &about, &quit])
}

fn install_panic_logger() {
    let prev = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let path = std::env::temp_dir().join("taskbar-garden-crash.log");
        let msg = format!("[{}] panic: {}\n", epoch_secs(), info);
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
        {
            use std::io::Write;
            let _ = f.write_all(msg.as_bytes());
        }
        prev(info);
    }));
}

fn epoch_secs() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn main() {
    install_panic_logger();
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            show_window,
            hide_window,
            quit_app,
            set_window_size
        ])
        .on_window_event(|win, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = win.hide();
            }
        })
        .setup(|app| {
            let handle = app.handle().clone();
            let menu = build_tray_menu(&handle)?;

            TrayIconBuilder::with_id("main-tray")
                .tooltip("Taskbar Garden")
                .icon(include_image!("icons/32x32.png"))
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => toggle_window(app, None),
                    "hide" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.hide();
                        }
                    }
                    "about" => {
                        force_show(app);
                        let _ = app.emit("menu:about", ());
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        position,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        toggle_window(
                            app,
                            Some(Anchor {
                                x: position.x,
                                y: position.y,
                            }),
                        );
                    }
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Taskbar Garden");
}
