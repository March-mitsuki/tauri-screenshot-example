import "./overlay.css";
import { invoke } from "@tauri-apps/api/core";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";

type Screenshot = {
  id: number;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  image_data: string;
  format: string;
};

listen("test_event", (e) => {
  console.log("Received test_event:", e);
});

// 将原始像素数据转换为可显示的图片
function createDisplayImage(screen: Screenshot): string {
  const { image_data, width, height, format } = screen;
  if (format === "jpeg" || format === "jpg") {
    return `data:image/jpeg;base64,${image_data}`;
  }
  // 兼容旧的 rgba/raw 流程
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const binaryString = atob(image_data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++)
    bytes[i] = binaryString.charCodeAt(i);
  const imageData = ctx.createImageData(width, height);
  imageData.data.set(bytes);
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

function Overlay() {
  const [screenshot, setScreenshot] = useState<Screenshot>();

  const getScreenshot = async () => {
    const windowLabel = getCurrentWebviewWindow().label;
    console.log("Getting screenshot for window:", windowLabel);
    const screenshot = await invoke("get_screenshot_data");
    console.log("Received screenshot:", screenshot);
    setScreenshot(screenshot as Screenshot);
  };
  useEffect(() => {
    getScreenshot();
  }, []);

  const overlayWindow = async () => {
    console.log("Overlaying window:", screenshot?.name);
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
    await webviewWindow.show();
  };
  useEffect(() => {
    overlayWindow();
  }, [screenshot]);

  if (!screenshot) {
    return <div>Waiting for screenshot...</div>;
  }

  return (
    <div>
      {screenshot && (
        <img src={createDisplayImage(screenshot)} alt={screenshot.name} />
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <Overlay />
);
