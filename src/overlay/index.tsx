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
import { listen } from "@tauri-apps/api/event";
import { drawScreenshot } from "./_shared";

listen("clip-cancel", async () => {
  const webviewWindow = getCurrentWebviewWindow();
  await webviewWindow.destroy();
});

function Overlay() {
  const [screenshot, setScreenshot] = useState<Screenshot>();

  useEffect(() => {
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
    const listenForKeyDown = async (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        await invoke("clip_cancel");
      }
    };

    getScreenshot();
    getAllDisplays();
    window.addEventListener("keydown", listenForKeyDown);

    return () => {
      window.removeEventListener("keydown", listenForKeyDown);
    };
  }, []);

  const overlayWindow = async () => {
    if (!screenshot) return;

    const webviewWindow = getCurrentWebviewWindow();
    const canvas = document.getElementById(
      "screenshot-canvas"
    ) as HTMLCanvasElement;
    const clipToolCanvas = document.getElementById(
      "clip-tool-tmp-canvas"
    ) as HTMLCanvasElement;
    clipToolCanvas.width = screenshot.width;
    clipToolCanvas.height = screenshot.height;
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
      webviewWindow.setAlwaysOnTop(true),
      drawScreenshot(canvas, screenshot),
    ];
    await Promise.all(tasks);
    await webviewWindow.show();
    // 可能会在不同的 webviewWindow 中被设置多次
    // 但没关系, 最后随便 focus 一个就行
    await webviewWindow.setFocus();
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
      {/* 实时显示当前 tool 绘制结果的的临时画布 */}
      <canvas
        id="clip-tool-tmp-canvas"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          zIndex: 10,
        }}
      />
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <Overlay />
);
