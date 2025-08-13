use std::{collections::HashMap, sync::Mutex};

use anyhow::Result;
use base64::{engine::general_purpose, Engine};
use image::{codecs::jpeg::JpegEncoder, DynamicImage};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

#[derive(Serialize, Clone)]
pub struct Screenshot {
    id: u32,
    name: String,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    image_data: String, // Base64 encoded data
    format: String,
}
#[derive(Serialize, Clone)]
pub struct Display {
    id: u32,
    name: String,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}
#[derive(Serialize, Deserialize, Clone)]
pub struct Point {
    x: i32,
    y: i32,
}

pub struct AppState {
    screenshots: HashMap<String, Screenshot>,
    displays: Vec<Display>,
}

async fn capture_all_screens() -> Result<Vec<Screenshot>> {
    let monitors = xcap::Monitor::all()?;

    let mut screenshots = Vec::new();

    for monitor in monitors {
        let img = monitor.capture_image()?;

        let rgb_img = DynamicImage::ImageRgba8(img.clone()).to_rgb8();
        let mut jpeg_buf = Vec::new();
        let mut encoder = JpegEncoder::new_with_quality(&mut jpeg_buf, 85);
        encoder.encode(
            &rgb_img,
            rgb_img.width(),
            rgb_img.height(),
            image::ExtendedColorType::Rgb8,
        )?;

        let base64_data = general_purpose::STANDARD.encode(&jpeg_buf);

        screenshots.push(Screenshot {
            id: monitor.id()?,
            name: monitor.name()?,
            x: monitor.x()?,
            y: monitor.y()?,
            width: monitor.width()?,
            height: monitor.height()?,
            image_data: base64_data,
            format: "jpeg".into(),
        });
    }

    Ok(screenshots)
}

async fn handle_screenshot(app: tauri::AppHandle) -> Result<()> {
    let screenshots = capture_all_screens().await?;
    let state = app.state::<Mutex<AppState>>();

    for (idx, screenshot) in screenshots.iter().enumerate() {
        let window_label = format!("screenshot_overlay_{}", idx);
        {
            let mut state = state.lock().unwrap();
            state
                .screenshots
                .insert(window_label.clone(), screenshot.clone());
        }

        // 创建覆盖窗口, 先隐藏, 前端收到数据后自己展开
        let window = tauri::WebviewWindowBuilder::new(
            &app,
            window_label.clone(),
            tauri::WebviewUrl::App("overlay.html".into()),
        )
        .title("Screenshot Overlay")
        .visible(false)
        .build()?;

        let app_clone = app.clone();
        window.on_window_event(move |e| {
            if let tauri::WindowEvent::Destroyed = e {
                println!(
                    "Window destroyed, cleaning up screenshot data for: {}",
                    window_label
                );
                let state = app_clone.state::<Mutex<AppState>>();
                let mut state = state.lock().unwrap();
                state.screenshots.remove(&window_label);
                println!("Screenshot data removed for: {}", window_label);
            }
        });
    }

    Ok(())
}

#[tauri::command]
async fn freeze_screens() -> Result<Vec<Screenshot>, String> {
    capture_all_screens().await.map_err(|e| e.to_string())
}

#[tauri::command]
fn get_screenshot_data(
    webview_window: tauri::WebviewWindow,
    app_handler: tauri::AppHandle,
) -> Result<Screenshot, String> {
    let window_label = webview_window.label().to_string();
    let state = app_handler.state::<Mutex<AppState>>();
    let state = state.lock().unwrap();
    state
        .screenshots
        .get(&window_label)
        .cloned()
        .ok_or_else(|| format!("No screenshot found for window: {}", window_label))
}

#[tauri::command]
fn get_screenshots_data(
    app_handler: tauri::AppHandle,
) -> Result<HashMap<String, Screenshot>, String> {
    let state = app_handler.state::<Mutex<AppState>>();
    let state = state.lock().unwrap();
    Ok(state.screenshots.clone())
}

#[tauri::command]
async fn get_displays_data(app: tauri::AppHandle) -> Result<Vec<Display>, String> {
    let state = app.state::<Mutex<AppState>>();
    let state = state.lock().unwrap();
    Ok(state.displays.clone())
}

#[tauri::command]
fn clip_start(app: tauri::AppHandle) -> Result<(), String> {
    app.emit("clip-start", ()).map_err(|e| e.to_string())
}

#[tauri::command]
fn clip_end(app: tauri::AppHandle, display_id: i32) -> Result<(), String> {
    app.emit("clip-end", display_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn clip_cancel(app: tauri::AppHandle) -> Result<(), String> {
    app.emit("clip-cancel", ()).map_err(|e| e.to_string())
}

#[cfg(desktop)]
fn setup_desktop_shortcuts(app: &mut tauri::App) -> Result<()> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

    app.handle()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())?;

    app.global_shortcut()
        .on_shortcut("CmdOrCtrl+Shift+S", |app, _shortcut, event| {
            if let ShortcutState::Pressed = event.state {
                println!("Capturing screenshot...");
                let app_handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = handle_screenshot(app_handle).await {
                        println!("Error capturing screenshot: {}", e);
                    }
                });
            }
        })?;

    Ok(())
}

#[cfg(desktop)]
fn get_all_displays() -> Result<Vec<Display>> {
    let monitors = xcap::Monitor::all()?;
    let mut displays = Vec::with_capacity(monitors.len());
    for m in monitors {
        displays.push(Display {
            id: m.id()?,
            name: m.name()?,
            x: m.x()?,
            y: m.y()?,
            width: m.width()?,
            height: m.height()?,
        });
    }
    Ok(displays)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            #[cfg(desktop)]
            {
                app.manage(Mutex::new(AppState {
                    screenshots: HashMap::new(),
                    displays: get_all_displays()?,
                }));
                setup_desktop_shortcuts(app)?;

                let app_clone = app.handle().clone();
                std::thread::spawn(move || {
                    let _ = rdev::listen(move |e| {
                        if let rdev::EventType::MouseMove { x, y } = e.event_type {
                            let _ = app_clone.emit(
                                "mouse-move",
                                Point {
                                    x: x as i32,
                                    y: y as i32,
                                },
                            );
                        }
                    });
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            freeze_screens,
            get_screenshot_data,
            get_screenshots_data,
            get_displays_data,
            clip_start,
            clip_end,
            clip_cancel,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
