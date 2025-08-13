import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { Image as TauriImage } from "@tauri-apps/api/image";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import coordTrans, { Point } from "./cord-trans";
import {
  clipState,
  displaysState,
  mousePointState,
  Screenshot,
  screenshotMetaState,
  screenshotsState,
} from "./clip-state";
import { ScreenLogRenderer, screenLogSignal } from "../components/screen-log";
import {
  Area2D,
  drawGrayOverlay,
  getMouseAroundArea,
  rgbToHex,
} from "./_shared";
import {
  CheckIcon,
  CrossIcon,
  DownloadIcon,
  LineIcon,
  RectIcon,
} from "../components/icons/line";
import { writeImage } from "@tauri-apps/plugin-clipboard-manager";
import { DotSpinner } from "../components/dot-spinner";

const STYLES_CONSTS = {
  toolsContainerPaddingX: 4,
  toolsContainerPaddingY: 4,
};

function detectClipArea(
  start?: { x: number; y: number },
  end?: { x: number; y: number }
): Area2D | undefined {
  if (!start || !end) return undefined;

  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(start.x - end.x);
  const height = Math.abs(start.y - end.y);

  if (width < 2 || height < 2) return undefined;

  return { x, y, width, height };
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",")[1];
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function getClippedImage(mode: "dataUrl"): Promise<string>;
async function getClippedImage(mode: "buffer"): Promise<ArrayBuffer>;
async function getClippedImage(mode: "tauri-img"): Promise<TauriImage>;
async function getClippedImage(mode: "dataUrl" | "buffer" | "tauri-img") {
  const clipArea = detectClipArea(
    clipState.data.startPointGlobalNotNormalized,
    clipState.data.endPointGlobalNotNormalized
  );
  if (!clipArea) {
    screenLogSignal.emit("clip area is empty, not clipping");
    throw new Error("Clip area is empty");
  }
  const screenshotRecord = screenshotsState.data;
  const screenshots = Object.values(screenshotRecord);
  const canvas = document.createElement("canvas");
  const desktopBounds = coordTrans.getDesktopBounds(
    screenshots.map(coordTrans.screenshotToDisplay)
  );
  canvas.width = desktopBounds.width;
  canvas.height = desktopBounds.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    screenLogSignal.emit("failed to get canvas context");
    throw new Error("Failed to get canvas context");
  }

  const draw = (s: Screenshot) => {
    return new Promise<void>((resolve) => {
      const normalizedPoint = coordTrans.globalToNormalized(
        { x: s.x, y: s.y },
        displaysState.data
      );
      const img = new Image();
      img.src = `data:image/jpeg;base64,${s.image_data}`;
      img.onload = () => {
        ctx.drawImage(
          img,
          normalizedPoint.x,
          normalizedPoint.y,
          s.width,
          s.height
        );
        resolve();
      };
    });
  };
  for (const s of screenshots) {
    await draw(s);
  }

  const clipCanvas = document.createElement("canvas");
  clipCanvas.width = clipArea.width;
  clipCanvas.height = clipArea.height;
  const clipCtx = clipCanvas.getContext("2d");
  if (!clipCtx) {
    screenLogSignal.emit("failed to get clip canvas context");
    throw new Error("Failed to get clip canvas context");
  }

  clipCtx.drawImage(
    canvas,
    clipArea.x,
    clipArea.y,
    clipArea.width,
    clipArea.height,
    0,
    0,
    clipArea.width,
    clipArea.height
  );

  if (mode === "dataUrl") {
    const clippedImgUrl = clipCanvas.toDataURL("image/jpeg");
    return clippedImgUrl;
  }
  if (mode === "buffer") {
    return clipCtx.getImageData(0, 0, clipArea.width, clipArea.height).data
      .buffer;
  }
  if (mode === "tauri-img") {
    const imageData = clipCtx.getImageData(
      0,
      0,
      clipArea.width,
      clipArea.height
    );
    return TauriImage.new(
      imageData.data.buffer,
      clipArea.width,
      clipArea.height
    );
  }

  throw new Error("Invalid mode, must be 'dataUrl' or 'buffer'");
}

function setClipStartState() {
  const globalPoint = mousePointState.data;
  if (!globalPoint) return;
  const toolsContainer = document.getElementById("screenshot-tools-container");
  toolsContainer!.style.visibility = "hidden";
  clipState.setState({
    isClipping: true,
    isUserSelected: false,
    endPoint: undefined,
    startPoint: coordTrans.globalToClient(
      globalPoint,
      { displayId: screenshotMetaState.data!.id },
      displaysState.data
    ),
    startPointGlobalNotNormalized: coordTrans.globalToNormalized(
      globalPoint,
      displaysState.data
    ),
  });
}

function setClipEndState() {
  const globalPoint = mousePointState.data;
  if (!globalPoint) return;

  clipState.setState((prev) => ({
    ...prev,
    isClipping: false,
    isUserSelected: true,
    endPoint: coordTrans.globalToClient(
      globalPoint,
      { displayId: screenshotMetaState.data!.id },
      displaysState.data
    ),
    endPointGlobalNotNormalized: coordTrans.globalToNormalized(
      globalPoint,
      displaysState.data
    ),
  }));
}

function onClipEnd() {
  const clipArea = detectClipArea(
    clipState.data.startPoint,
    clipState.data.endPoint
  );
  if (!clipArea) return;

  const toolsContainer = document.getElementById(
    "screenshot-tools-container"
  ) as HTMLDivElement;
  const toolsContainerRect = toolsContainer.getBoundingClientRect();
  toolsContainer.style.visibility = "visible";
  const containerPos = {
    x: clipArea.x + clipArea.width - toolsContainerRect.width,
    y: clipArea.y + clipArea.height + 10,
  };
  toolsContainer.style.left = `${containerPos.x}px`;
  toolsContainer.style.top = `${containerPos.y}px`;
}

listen("clip-start", (e) => {
  screenLogSignal.emit("get clip-start:" + JSON.stringify(e.payload));
  setClipStartState();
});
listen("clip-end", (e) => {
  screenLogSignal.emit("get clip-end:" + JSON.stringify(e.payload));
  setClipEndState();
  const display_id = e.payload as number;
  if (display_id === screenshotMetaState.data?.id) {
    onClipEnd();
    screenLogSignal.emit("Clipped image");
  }
});
listen("mouse-move", (e) => {
  const p = e.payload as Point;
  mousePointState.setState(p);
  if (clipState.isClipping && clipState.startPoint) {
    clipState.setClipEnd(
      coordTrans.globalToClient(
        p,
        { displayId: screenshotMetaState.data!.id },
        displaysState.data
      )
    );
  }
});

export function ClipOverlay() {
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      const isUserSelected = clipState.data.isUserSelected;
      const toolsContainer = document.getElementById(
        "screenshot-tools-container"
      ) as HTMLDivElement;
      const toolsContainerRect = toolsContainer.getBoundingClientRect();
      if (
        isUserSelected &&
        e.clientX >= toolsContainerRect.left &&
        e.clientX <= toolsContainerRect.right &&
        e.clientY >= toolsContainerRect.top &&
        e.clientY <= toolsContainerRect.bottom
      ) {
        // skip if inside tools container
        return;
      }
      invoke("clip_start");
    };
    const handleMouseUp = (e: MouseEvent) => {
      const isUserSelected = clipState.data.isUserSelected;
      const toolsContainer = document.getElementById(
        "screenshot-tools-container"
      ) as HTMLDivElement;
      const toolsContainerRect = toolsContainer.getBoundingClientRect();
      if (
        isUserSelected &&
        e.clientX >= toolsContainerRect.left &&
        e.clientX <= toolsContainerRect.right &&
        e.clientY >= toolsContainerRect.top &&
        e.clientY <= toolsContainerRect.bottom
      ) {
        // skip if inside tools container
        return;
      }
      invoke("clip_end", { displayId: screenshotMetaState.data!.id });
    };
    // 用 requestAnimationFrame 和浏览器帧同步, 减少计算次数
    const frameClipStateChange = () => {
      try {
        const clipData = clipState.data;
        if (!clipData) return;

        const area = detectClipArea(clipData.startPoint, clipData.endPoint);
        const selection = document.getElementById(
          "clip-selection"
        ) as HTMLDivElement;
        const overlayCanvas = document.getElementById(
          "clip-overlay-canvas"
        ) as HTMLCanvasElement;
        if (!area) {
          selection.style.width = "0px";
          selection.style.height = "0px";
          selection.style.outline = "none";
          drawGrayOverlay(overlayCanvas, screenshotMetaState.data!);
          return;
        }

        drawGrayOverlay(overlayCanvas, screenshotMetaState.data!, area);
        selection.style.left = `${area.x}px`;
        selection.style.top = `${area.y}px`;
        selection.style.width = `${area.width}px`;
        selection.style.height = `${area.height}px`;
        selection.style.outline = "1px solid rgba(0, 153, 255, 1)";
      } finally {
        requestAnimationFrame(frameClipStateChange);
      }
    };
    requestAnimationFrame(frameClipStateChange);

    drawGrayOverlay(
      document.getElementById("clip-overlay-canvas") as HTMLCanvasElement,
      screenshotMetaState.data!
    );
    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  return (
    <>
      <canvas
        id="clip-overlay-canvas"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
        }}
      />
      <div
        id="clip-selection"
        style={{
          position: "absolute",
          boxSizing: "border-box",
        }}
      />
      <ScreenLogRenderer />
      <ScreenshotUI />
    </>
  );
}

function ScreenshotUI() {
  useEffect(() => {
    // ===== pixel info =====
    const desktopBounds = coordTrans.getDesktopBounds(displaysState.data);
    const drawPixelInfo = () => {
      try {
        const container = document.getElementById(
          "pixel-info-container"
        ) as HTMLDivElement;
        if (clipState.data.isUserSelected) {
          container.style.visibility = "hidden";
          return;
        }

        const globalPoint = mousePointState.data;
        if (!globalPoint) return;

        const thisDisplayData = screenshotMetaState.data!;
        const clientPoint = coordTrans.globalToClient(
          globalPoint,
          { displayId: thisDisplayData.id },
          displaysState.data
        );

        if (globalPoint.x < desktopBounds.originX) {
          globalPoint.x = desktopBounds.originX;
        }
        if (globalPoint.x > desktopBounds.originX + desktopBounds.width) {
          globalPoint.x = desktopBounds.originX + desktopBounds.width;
        }
        if (globalPoint.y < desktopBounds.originY) {
          globalPoint.y = desktopBounds.originY;
        }
        if (globalPoint.y > desktopBounds.originY + desktopBounds.height) {
          globalPoint.y = desktopBounds.originY + desktopBounds.height;
        }
        const isInThisDisplay = coordTrans.isGlobalPointInDisplay(
          globalPoint,
          thisDisplayData
        );
        if (!isInThisDisplay) {
          container.style.visibility = "hidden";
          return;
        } else {
          container.style.visibility = "visible";
        }

        // 处理绘制时的边界
        if (clientPoint.x < 0) clientPoint.x = 0;
        if (clientPoint.y < 0) clientPoint.y = 0;
        if (clientPoint.x > window.innerWidth)
          clientPoint.x = window.innerWidth;
        if (clientPoint.y > window.innerHeight)
          clientPoint.y = window.innerHeight;

        const aroundAreaImg = document.getElementById(
          "mouse-around-area-img"
        ) as HTMLImageElement;
        const mousePointDiv = document.getElementById(
          "mouse-point-div"
        ) as HTMLDivElement;
        const mousePointRgbDiv = document.getElementById(
          "mouse-point-rgb-div"
        ) as HTMLDivElement;
        const mousePointHexDiv = document.getElementById(
          "mouse-point-hex-div"
        ) as HTMLDivElement;

        const screenshotCanvas = document.getElementById(
          "screenshot-canvas"
        ) as HTMLCanvasElement;
        const [mousePointRGB, aroundAreaImgUrl, scaledCanvasWH] =
          getMouseAroundArea(screenshotCanvas, clientPoint, 15, 5);

        aroundAreaImg.src = aroundAreaImgUrl;
        aroundAreaImg.width = scaledCanvasWH.width;
        aroundAreaImg.height = scaledCanvasWH.height;

        container.style.width = `${scaledCanvasWH.width}px`;
        let containerLeft = clientPoint.x + 10;
        let containerTop = clientPoint.y + 10;
        let containerRight = containerLeft + scaledCanvasWH.width;
        let containerBottom =
          containerTop + container.getBoundingClientRect().height;

        if (containerRight > window.innerWidth) {
          containerLeft = clientPoint.x - scaledCanvasWH.width - 10;
        }
        if (containerBottom > window.innerHeight) {
          containerTop =
            clientPoint.y - container.getBoundingClientRect().height - 10;
        }

        container.style.left = `${containerLeft}px`;
        container.style.top = `${containerTop}px`;

        mousePointDiv.textContent = `(${globalPoint.x}, ${globalPoint.y})`;
        mousePointRgbDiv.textContent = `RGB: ${mousePointRGB.r}, ${mousePointRGB.g}, ${mousePointRGB.b}`;
        mousePointHexDiv.textContent = `HEX: ${rgbToHex(mousePointRGB)}`;
      } finally {
        requestAnimationFrame(drawPixelInfo);
      }
    };
    requestAnimationFrame(drawPixelInfo);
  }, []);

  return (
    <>
      <div
        id="pixel-info-container"
        style={{
          position: "absolute",
          visibility: "hidden",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          fontSize: "12px",
          zIndex: 10,
          width: "100px",
          backgroundColor: "rgba(43, 43, 43, 1)",
          color: "whitesmoke",
        }}
      >
        <img id="mouse-around-area-img" />
        <div id="mouse-point-div" />
        <div id="mouse-point-rgb-div" />
        <div id="mouse-point-hex-div" />
      </div>

      {/* Tool bar rendering will be handle in onClipEnd function */}
      <div
        id="screenshot-tools-container"
        style={{
          visibility: "hidden",
          cursor: "default",
          position: "absolute",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 10,
          backgroundColor: "var(--tool-bar-bg)",
          borderRadius: "8px",
          padding: `${STYLES_CONSTS.toolsContainerPaddingY}px ${STYLES_CONSTS.toolsContainerPaddingX}px`,
        }}
      >
        <button
          className="screenshot-tool-btn"
          data-tooltip="Draw Line"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <LineIcon />
        </button>
        <button
          className="screenshot-tool-btn"
          data-tooltip="Draw Rectangle"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <RectIcon />
        </button>

        <div className="screenshot-tool-separator" />

        <button
          className="screenshot-tool-btn"
          data-tooltip="Save"
          onClick={async () => {
            try {
              const clippedImg = await getClippedImage("dataUrl");
              if (!clippedImg) {
                screenLogSignal.emit("Failed to get clipped image");
                return;
              }
              const targetPath = await save({
                defaultPath: `${Date.now()}.jpg`,
                filters: [
                  {
                    name: "JPEG Image",
                    extensions: ["jpg", "jpeg"],
                  },
                ],
              });
              if (!targetPath) return;
              screenLogSignal.emit(`clipped image saved to: ${targetPath}`);
              await writeFile(targetPath, dataUrlToBytes(clippedImg));
              clipState.setState({
                isClipping: false,
                isUserSelected: false,
              });
              await invoke("clip_cancel");
            } catch (error) {
              screenLogSignal.emit(`Failed to save clipped image: ${error}`);
            }
          }}
        >
          <DownloadIcon />
        </button>
        <button
          className="screenshot-tool-btn"
          data-tooltip="Cancel"
          onClick={async () => {
            await invoke("clip_cancel");
          }}
        >
          <CrossIcon />
        </button>
        <CopyToClipbordBtn />
      </div>
    </>
  );
}

function CopyToClipbordBtn() {
  const [loading, setLoading] = useState(false);

  return (
    <button
      className="screenshot-tool-btn"
      data-tooltip="Copy to clipboard"
      disabled={loading}
      onClick={async () => {
        if (loading) return;

        try {
          setLoading(true);
          const clippedImg = await getClippedImage("tauri-img");
          if (!clippedImg) {
            screenLogSignal.emit("Failed to get clipped image");
            return;
          }
          await writeImage(clippedImg);
          screenLogSignal.emit("Clipped image copied to clipboard");
          await invoke("clip_cancel");
        } catch (error) {
          screenLogSignal.emit(`Failed to copy clipped image: ${error}`);
        } finally {
          setLoading(false);
        }
      }}
    >
      {loading ? <DotSpinner /> : <CheckIcon />}
    </button>
  );
}
