use std::{collections::HashMap, io::Cursor, sync::Mutex};

use anyhow::Result;
use base64::{engine::general_purpose, Engine};
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
    scale: f32,
}
#[derive(Serialize, Clone)]
pub struct Display {
    id: u32,
    name: String,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    scale: f32,
}
#[derive(Serialize, Deserialize, Clone)]
pub struct Point {
    x: i32,
    y: i32,
}
#[derive(Serialize, Clone)]
pub struct AppState {
    screenshots: HashMap<String, Screenshot>,
    displays: Vec<Display>,
    is_screenshotting: bool,
    screenshot_format: String,
}

async fn capture_all_screens(screenshot_format: String) -> Result<Vec<Screenshot>> {
    let monitors = xcap::Monitor::all()?;

    let mut screenshots = Vec::new();

    for monitor in monitors {
        let img = monitor.capture_image()?;

        let base64_data: String;
        match screenshot_format.as_str() {
            "jpeg" => {
                let rgb_img = image::DynamicImage::ImageRgba8(img.clone()).to_rgb8();
                let mut jpeg_buf = Cursor::new(Vec::new());
                rgb_img.write_to(&mut jpeg_buf, image::ImageFormat::Jpeg)?;
                base64_data = general_purpose::STANDARD.encode(&jpeg_buf.into_inner());
            }
            "png" => {
                let mut png_buf = Cursor::new(Vec::new());
                img.write_to(&mut png_buf, image::ImageFormat::Png)?;
                base64_data = general_purpose::STANDARD.encode(&png_buf.into_inner());
            }
            _ => {
                return Err(anyhow::anyhow!("Unsupported screenshot format"));
            }
        }

        screenshots.push(Screenshot {
            id: monitor.id()?,
            name: monitor.name()?,
            x: monitor.x()?,
            y: monitor.y()?,
            width: img.width(),   // 使用实际捕获的像素尺寸
            height: img.height(), // 使用实际捕获的像素尺寸
            image_data: base64_data,
            format: screenshot_format.clone(),
            scale: monitor.scale_factor()?,
        });
    }

    Ok(screenshots)
}

async fn handle_screenshot(app: tauri::AppHandle) -> Result<()> {
    let state = app.state::<Mutex<AppState>>();
    let screenshot_format = state.lock().unwrap().screenshot_format.clone();
    let screenshots = capture_all_screens(screenshot_format).await?;

    for (idx, screenshot) in screenshots.iter().enumerate() {
        let window_label = format!("screenshot_overlay_{}", idx);
        {
            let mut state = state.lock().unwrap();
            state
                .screenshots
                .insert(window_label.clone(), screenshot.clone());
        }

        let window: tauri::WebviewWindow;
        if let Some(existing_window) = app.get_webview_window(&window_label) {
            // 如果窗口已存在, 则使用现有窗口
            window = existing_window;
        } else {
            // 创建覆盖窗口, 先隐藏, 前端收到数据后自己展开
            window = tauri::WebviewWindowBuilder::new(
                &app,
                window_label.clone(),
                tauri::WebviewUrl::App("overlay.html".into()),
            )
            .title("Screenshot Overlay")
            .visible(false)
            .build()?;
        }

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
                state.is_screenshotting = false;
                println!("Screenshot data removed for: {}", window_label);
            }
        });
    }

    Ok(())
}

#[tauri::command]
fn get_screenshot_format(app: tauri::AppHandle) -> Result<String, String> {
    let state = app.state::<Mutex<AppState>>();
    let state = state.lock().unwrap();
    Ok(state.screenshot_format.clone())
}

#[tauri::command]
fn set_screenshot_format(app: tauri::AppHandle, format: String) -> Result<String, String> {
    let state = app.state::<Mutex<AppState>>();
    let mut state = state.lock().unwrap();
    if format != "jpeg" && format != "png" {
        return Err("Unsupported screenshot format".to_string());
    }
    state.screenshot_format = format.clone();
    Ok(format)
}

#[tauri::command]
async fn freeze_screens(app: tauri::AppHandle) -> Result<Vec<Screenshot>, String> {
    let screenshot_format = app
        .state::<Mutex<AppState>>()
        .lock()
        .unwrap()
        .screenshot_format
        .clone();
    capture_all_screens(screenshot_format)
        .await
        .map_err(|e| e.to_string())
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
fn broadcast(app: tauri::AppHandle, event: String, payload: String) -> Result<(), String> {
    app.emit(&event, payload).map_err(|e| e.to_string())
}

#[cfg(desktop)]
fn setup_desktop_shortcuts(app: &mut tauri::App) -> Result<()> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

    app.handle()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())?;

    app.global_shortcut()
        .on_shortcut("CmdOrCtrl+Shift+S", |app, _shortcut, event| {
            if let ShortcutState::Pressed = event.state {
                println!("Global shortcut CmdOrCtrl+Shift+S pressed");
                let state = app.state::<Mutex<AppState>>();
                let mut state = state.lock().unwrap();
                if state.is_screenshotting {
                    return;
                }
                println!("Capturing screenshot...");
                state.is_screenshotting = true;
                let app_handle = app.clone();
                let app_handle_2 = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = handle_screenshot(app_handle).await {
                        // If error, reset is_screenshotting state here
                        // If ok, is_screenshotting will be reset inside handle_screenshot()
                        let state = app_handle_2.state::<Mutex<AppState>>();
                        let mut state = state.lock().unwrap();
                        state.is_screenshotting = false;
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
            scale: m.scale_factor()?,
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
                    is_screenshotting: false,
                    screenshot_format: String::from("jpeg"),
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
            get_screenshot_format,
            set_screenshot_format,
            freeze_screens,
            get_screenshot_data,
            get_screenshots_data,
            get_displays_data,
            broadcast,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
