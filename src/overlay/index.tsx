import "./index.css";
import { invoke } from "@tauri-apps/api/core";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { ClipOverlay } from "./clip-overlay";
import {
  displaysState,
  Screenshot,
  screenshotMetaState,
  screenshotsState,
} from "./clip-state";
import { Display } from "./cord-trans";

function drawScreenshot(
  canvas: HTMLCanvasElement,
  screen: Screenshot
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    canvas.width = screen.width;
    canvas.height = screen.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      reject(new Error("Failed to get canvas context"));
      return;
    }

    const img = new Image();
    img.src = `data:image/jpeg;base64,${screen.image_data}`;
    img.onload = () => {
      ctx.drawImage(img, 0, 0, screen.width, screen.height);
      resolve();
    };
    img.onerror = (error) => {
      reject(error);
    };
  });
}

function Overlay() {
  const [screenshot, setScreenshot] = useState<Screenshot>();

  const getScreenshot = async () => {
    const webviewWindow = getCurrentWebviewWindow();
    const screenshots = await invoke<Record<string, Screenshot>>(
      "get_screenshots_data"
    );
    const currentScreenshot = screenshots[webviewWindow.label];

    setScreenshot(currentScreenshot);
    screenshotMetaState.setState({
      id: currentScreenshot.id,
      name: currentScreenshot.name,
      x: currentScreenshot.x,
      y: currentScreenshot.y,
      width: currentScreenshot.width,
      height: currentScreenshot.height,
      format: currentScreenshot.format,
    });
    screenshotsState.setState(screenshots);
  };
  const getAllDisplays = async () => {
    const displays = await invoke<Display[]>("get_displays_data");
    displaysState.setState(displays);
  };
  useEffect(() => {
    getScreenshot();
    getAllDisplays();
  }, []);

  const overlayWindow = async () => {
    if (!screenshot) return;

    const webviewWindow = getCurrentWebviewWindow();
    const tasks = [
      webviewWindow.setDecorations(false),
      webviewWindow.setPosition(
        new LogicalPosition(screenshot.x, screenshot.y)
      ),
      webviewWindow.setSize(
        new LogicalSize(screenshot.width, screenshot.height)
      ),
      webviewWindow.setFullscreen(true),
      webviewWindow.setResizable(false),
    ];
    await Promise.all(tasks);
    await drawScreenshot(
      document.getElementById("screenshot-canvas") as HTMLCanvasElement,
      screenshot
    );
    await webviewWindow.show();
  };
  useEffect(() => {
    overlayWindow();
  }, [screenshot]);

  if (!screenshot) {
    return <div>Waiting for screenshot...</div>;
  }

  return (
    <>
      <canvas
        id="screenshot-canvas"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: "100%",
          height: "100%",
        }}
        draggable={false}
      />
      <ClipOverlay />
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <Overlay />
);
