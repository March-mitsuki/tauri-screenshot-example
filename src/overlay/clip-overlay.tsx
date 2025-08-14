import { useEffect, useState } from "react";
import { Image as TauriImage } from "@tauri-apps/api/image";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import coordTrans, { Point } from "./cord-trans";
import {
  clipToolState,
  ClipToolStateData,
  clipState,
  displaysState,
  mousePointState,
  Screenshot,
  screenshotMetaState,
  screenshotsState,
  ClipToolLineData,
  ClipToolHelper,
  ClipToolRectData,
  drawnToolState,
} from "./clip-state";
import { ScreenLogRenderer, screenLogSignal } from "../components/screen-log";
import {
  detectArea,
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
} from "../components/icons";
import { writeImage } from "@tauri-apps/plugin-clipboard-manager";
import { DotSpinner } from "../components/dot-spinner";
import { TauriBroadcast } from "../common/tauri-broadcast";
import { listen } from "@tauri-apps/api/event";

const STYLES_CONSTS = {
  toolsContainerPaddingX: 4,
  toolsContainerPaddingY: 4,
};

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
  const clipArea = detectArea(
    clipState.data.startPointGlobalNotNormalized,
    clipState.data.endPointGlobalNotNormalized
  );
  if (!clipArea) {
    screenLogSignal.emit("clip area is empty, not clipping");
    throw new Error("Clip area is empty");
  }
  const screenshotRecord = screenshotsState.data;
  const screenshots = Object.values(screenshotRecord);

  // create result canvas that will hold all screenshots
  const resultCanvas = document.createElement("canvas");
  const desktopBounds = coordTrans.getDesktopBounds(
    screenshots.map(coordTrans.screenshotToDisplay)
  );
  resultCanvas.width = desktopBounds.width;
  resultCanvas.height = desktopBounds.height;
  const resultCanvasCtx = resultCanvas.getContext("2d");
  if (!resultCanvasCtx) {
    screenLogSignal.emit("failed to get canvas context");
    throw new Error("Failed to get canvas context");
  }

  // draw all screenshots in a single canvas
  const draw = (s: Screenshot) => {
    return new Promise<void>((resolve) => {
      const normalizedPoint = coordTrans.globalToNormalized(
        { x: s.x, y: s.y },
        displaysState.data
      );
      const img = new Image();
      img.src = `data:image/jpeg;base64,${s.image_data}`;
      img.onload = () => {
        resultCanvasCtx.drawImage(
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

  // draw tools result to screenshot result canvas
  const drawnResults = drawnToolState.data;
  for (const toolResult of drawnResults) {
    switch (toolResult.tool) {
      case "line": {
        const data = toolResult.data as ClipToolLineData;
        resultCanvasCtx.save();

        resultCanvasCtx.lineWidth = data.lineWidth;
        resultCanvasCtx.strokeStyle = data.strokeStyle;
        const normalizedStartP = coordTrans.globalToNormalized(
          data.startPoint!,
          displaysState.data
        );
        const normalizedEndP = coordTrans.globalToNormalized(
          data.endPoint!,
          displaysState.data
        );
        screenLogSignal.emit(
          `drew line from ${normalizedStartP.x},${normalizedStartP.y} to ${
            normalizedEndP.x
          },${normalizedEndP.y}.
          global: ${data.startPoint!.x},${data.startPoint!.y} to ${
            data.endPoint!.x
          },${data.endPoint!.y}
          `
        );

        resultCanvasCtx.beginPath();
        resultCanvasCtx.moveTo(normalizedStartP.x, normalizedStartP.y);
        resultCanvasCtx.lineTo(normalizedEndP.x, normalizedEndP.y);
        resultCanvasCtx.stroke();
        resultCanvasCtx.closePath();

        resultCanvasCtx.restore();
        break;
      }
      case "rect": {
        const data = toolResult.data as ClipToolRectData;
        resultCanvasCtx.save();

        resultCanvasCtx.lineWidth = data.lineWidth;
        resultCanvasCtx.strokeStyle = data.strokeStyle;
        const normalizedStartP = coordTrans.globalToNormalized(
          data.startPoint!,
          displaysState.data
        );
        const normalizedEndP = coordTrans.globalToNormalized(
          data.endPoint!,
          displaysState.data
        );
        const area = detectArea(normalizedStartP, normalizedEndP);
        if (!area) {
          resultCanvasCtx.restore();
          return;
        }

        resultCanvasCtx.strokeRect(area.x, area.y, area.width, area.height);
        resultCanvasCtx.restore();
        break;
      }
      default: {
        break;
      }
    }
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
    resultCanvas,
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
  const toolsContainer = document.getElementById("clip-tools-container");
  toolsContainer!.style.visibility = "hidden";
  clipToolState.setState((prev) => ({
    ...prev,
    tool: undefined,
  }));
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

  clipState.setState((prev) => {
    const clientEndP = coordTrans.globalToClient(
      globalPoint,
      { displayId: screenshotMetaState.data!.id },
      displaysState.data
    );
    const normalizedGlobalEndP = coordTrans.globalToNormalized(
      globalPoint,
      displaysState.data
    );
    const clipArea = detectArea(prev.startPoint, clientEndP);
    return {
      ...prev,
      isClipping: false,
      isUserSelected: clipArea ? true : false,
      endPoint: clientEndP,
      endPointGlobalNotNormalized: normalizedGlobalEndP,
    };
  });
}

function onClipEnd() {
  const clipArea = detectArea(
    clipState.data.startPoint,
    clipState.data.endPoint
  );
  if (!clipArea) return;

  const toolsContainer = document.getElementById(
    "clip-tools-container"
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

function isMouseInsideUI(e: MouseEvent): boolean {
  const isUserSelected = clipState.data.isUserSelected;
  const toolsContainer = document.getElementById(
    "clip-tools-container"
  ) as HTMLDivElement;
  const toolsContainerRect = toolsContainer.getBoundingClientRect();
  if (
    isUserSelected &&
    e.clientX >= toolsContainerRect.left &&
    e.clientX <= toolsContainerRect.right &&
    e.clientY >= toolsContainerRect.top &&
    e.clientY <= toolsContainerRect.bottom
  ) {
    return true;
  }
  const toolSettingsContainer = document.getElementById(
    "clip-tool-settings-container"
  ) as HTMLDivElement;
  const toolSettingsContainerRect =
    toolSettingsContainer.getBoundingClientRect();
  if (
    isUserSelected &&
    e.clientX >= toolSettingsContainerRect.left &&
    e.clientX <= toolSettingsContainerRect.right &&
    e.clientY >= toolSettingsContainerRect.top &&
    e.clientY <= toolSettingsContainerRect.bottom
  ) {
    return true;
  }
  return false;
}

/**
 * 如果有需要就 invoke clip_tool_start 事件
 *
 * 返回一个 boolean, 表示是否需要提前返回
 */
function handleInvokeClipToolStart(): boolean {
  if (
    clipState.data.isUserSelected &&
    typeof clipToolState.data.tool !== "undefined"
  ) {
    const payload: ClipToolStateData = {};
    switch (clipToolState.data.tool) {
      case "line": {
        const stateData = clipToolState.data.data as ClipToolLineData;
        payload.tool = "line";
        payload.data = {
          startPoint: mousePointState.data,
          endPoint: undefined,
          strokeStyle: stateData.strokeStyle,
          lineWidth: stateData.lineWidth,
        } as ClipToolLineData;
        break;
      }
      case "rect": {
        const stateData = clipToolState.data.data as ClipToolRectData;
        payload.tool = "rect";
        payload.data = {
          startPoint: mousePointState.data,
          endPoint: undefined,
          strokeStyle: stateData.strokeStyle,
          lineWidth: stateData.lineWidth,
        } as ClipToolRectData;
        break;
      }
      default: {
        screenLogSignal.emit("Unknown clip tool type");
        return true;
      }
    }
    // invoke("clip_tool_start", {
    //   payload: JSON.stringify(payload),
    // });
    TauriBroadcast.broadcast("clip-tool-start", payload);
    return true;
  }
  return false;
}

/**
 * 如果有需要就 invoke clip_tool_end 事件
 *
 * 返回一个 boolean, 表示是否需要提前返回
 */
function handleInvokeClipToolEnd(): boolean {
  if (
    clipState.data.isUserSelected &&
    typeof clipToolState.data.tool !== "undefined"
  ) {
    const payload: ClipToolStateData = {};
    switch (clipToolState.data.tool) {
      case "line": {
        const stateData = clipToolState.data.data as ClipToolLineData;
        payload.tool = "line";
        payload.data = {
          startPoint: undefined,
          endPoint: mousePointState.data,
          strokeStyle: stateData.strokeStyle,
          lineWidth: stateData.lineWidth,
        } as ClipToolLineData;
        break;
      }
      case "rect": {
        const stateData = clipToolState.data.data as ClipToolRectData;
        payload.tool = "rect";
        payload.data = {
          startPoint: undefined,
          endPoint: mousePointState.data,
          strokeStyle: stateData.strokeStyle,
          lineWidth: stateData.lineWidth,
        } as ClipToolRectData;
        break;
      }
      default: {
        screenLogSignal.emit("Unknown clip tool type");
        return true;
      }
    }
    // invoke("clip_tool_end", {
    //   payload: JSON.stringify(payload),
    // });
    TauriBroadcast.broadcast("clip-tool-end", payload);
    return true;
  }
  return false;
}

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
TauriBroadcast.listen("clip-start", () => {
  setClipStartState();
});
TauriBroadcast.listen("clip-end", (data) => {
  setClipEndState();
  if (data.displayId === screenshotMetaState.data?.id) {
    onClipEnd();
  }
});
TauriBroadcast.listen("clip-tool-start", (data) => {
  clipToolState.setState(data);
  screenLogSignal.emit(`
    Tool started: ${data.tool}, ${JSON.stringify(data, null, 2)}
  `);
});
TauriBroadcast.listen("clip-tool-end", (data) => {
  clipToolState.setState((prev) => {
    const newState = {
      tool: data.tool,
      data: {
        ...prev.data,
        ...data.data,
      },
    } as ClipToolStateData;
    screenLogSignal.emit(
      `Tool ended: ${data.tool}, new: ${JSON.stringify(newState, null, 2)}`
    );
    drawnToolState.setState((prev) => [
      ...prev,
      {
        tool: newState.tool!,
        data: newState.data!,
      },
    ]);
    return newState;
  });
});

export function ClipOverlay() {
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (isMouseInsideUI(e)) {
        return;
      }
      const needReturn = handleInvokeClipToolStart();
      if (needReturn) return;
      // invoke("clip_start");
      TauriBroadcast.broadcast("clip-start");
    };
    const handleMouseUp = (e: MouseEvent) => {
      if (isMouseInsideUI(e)) {
        return;
      }
      const needReturn = handleInvokeClipToolEnd();
      if (needReturn) return;
      // invoke("clip_end", { displayId: screenshotMetaState.data!.id });
      TauriBroadcast.broadcast("clip-end", {
        displayId: screenshotMetaState.data!.id,
      });
    };
    // 用 requestAnimationFrame 和浏览器帧同步, 减少计算次数
    const frameClipStateChange = () => {
      try {
        // ===== draw clip area overlay =====
        const clipData = clipState.data;
        if (!clipData) return;

        const area = detectArea(clipData.startPoint, clipData.endPoint);
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
        // ===== draw clip area overlay end =====

        // ===== handle clip tool =====
        if (clipToolState.data.tool) {
          const clipToolCanvas = document.getElementById(
            "clip-tool-tmp-canvas"
          ) as HTMLCanvasElement;
          const ctx = clipToolCanvas.getContext("2d");
          if (!ctx) {
            screenLogSignal.emit("Failed to get clip-tool-tmp-canvas context");
            return;
          }
          // 如果有设置 tool 那么根据 tool 检查 data 查看是否已经开始绘图
          switch (clipToolState.data.tool) {
            case "line": {
              const data = clipToolState.data.data as ClipToolLineData;
              // 如果只有 startPoint 没有 endPoint 表示正在绘制中
              if (data.startPoint && !data.endPoint) {
                ClipToolHelper.clearCanvas(ctx, clipToolCanvas);
                ClipToolHelper.drawLine(ctx, data);
                break;
              }
              // 如果两个都有则表示绘制结束
              if (data.startPoint && data.endPoint) {
                ClipToolHelper.clearCanvas(ctx, clipToolCanvas);
                break;
              }
              break;
            }
            case "rect": {
              const data = clipToolState.data.data as ClipToolRectData;
              // 绘制中
              if (data.startPoint && !data.endPoint) {
                ClipToolHelper.clearCanvas(ctx, clipToolCanvas);
                ClipToolHelper.drawRect(ctx, data);
                break;
              }
              // 绘制结束
              if (data.startPoint && data.endPoint) {
                ClipToolHelper.clearCanvas(ctx, clipToolCanvas);
                break;
              }
              break;
            }
            default: {
              break;
            }
          }
        }
        // ===== handle clip tool end =====
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
          zIndex: 20,
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
        id="clip-tools-container"
        style={{
          visibility: "hidden",
          cursor: "default",
          position: "absolute",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 20,
          backgroundColor: "var(--toolbar-bg)",
          borderRadius: "8px",
          padding: `${STYLES_CONSTS.toolsContainerPaddingY}px ${STYLES_CONSTS.toolsContainerPaddingX}px`,
        }}
      >
        <ToolBtn
          name="line"
          tooltip="Draw Line"
          onClick={async (reqSelect) => {
            if (reqSelect) {
              const data: ClipToolLineData = {
                lineWidth: ClipToolHelper.getDefaultLineWidth(),
                strokeStyle: ClipToolHelper.getDefaultStrokeStyle(),
              };
              return {
                tool: "line",
                data,
              };
            } else {
              return { tool: undefined, data: undefined };
            }
          }}
        >
          <LineIcon />
        </ToolBtn>
        <ToolBtn
          name="rect"
          tooltip="Draw Rectangle"
          onClick={async (reqSelect) => {
            if (reqSelect) {
              const data: ClipToolRectData = {
                lineWidth: ClipToolHelper.getDefaultLineWidth(),
                strokeStyle: ClipToolHelper.getDefaultStrokeStyle(),
              };
              return {
                tool: "rect",
                data,
              };
            } else {
              return { tool: undefined, data: undefined };
            }
          }}
        >
          <RectIcon />
        </ToolBtn>

        <div className="clip-tool-separator" />

        <button
          className="clip-tool-btn clip-tool-btn-tip"
          data-tooltip="Save"
          onClick={async () => {
            try {
              const clippedImg = await getClippedImage("dataUrl");
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
              await writeFile(targetPath, dataUrlToBytes(clippedImg));
              // await invoke("clip_cancel");
              TauriBroadcast.broadcast("clip-cancel");
            } catch (error) {
              screenLogSignal.emit(`Failed to save clipped image: ${error}`);
            }
          }}
        >
          <DownloadIcon />
        </button>
        <button
          className="clip-tool-btn clip-tool-btn-tip"
          data-tooltip="Cancel"
          onClick={async () => {
            // await invoke("clip_cancel");
            TauriBroadcast.broadcast("clip-cancel");
          }}
        >
          <CrossIcon />
        </button>
        <CopyToClipboardBtn />
      </div>
      <ToolSettings />
    </>
  );
}

type CircleProps = {
  r: number;
  style?: React.CSSProperties;
};
function Circle({ r, style }: CircleProps) {
  return (
    <div
      style={{
        display: "inline-block",
        width: `${r * 2}px`,
        height: `${r * 2}px`,
        borderRadius: "50%",
        backgroundColor: "var(--toolbar-color-text)",
        ...style,
      }}
    />
  );
}

function LineToolSettings() {
  const [selectedLineWidth, setSelectedLineWidth] = useState<number>(
    ClipToolHelper.getDefaultLineWidth()
  );

  useEffect(() => {
    const listenToolState = (state: ClipToolStateData) => {
      if (state.data && state.tool === "line" && state.data.lineWidth) {
        setSelectedLineWidth(state.data.lineWidth);
      }
    };
    clipToolState.subscribe(listenToolState);

    return () => {
      clipToolState.unsubscribe(listenToolState);
    };
  }, []);

  const setLineWidth = (width: number) => {
    clipToolState.setState((prev) => {
      const data: ClipToolLineData = prev.data
        ? {
            ...(prev.data as ClipToolLineData),
            lineWidth: width,
          }
        : {
            strokeStyle: ClipToolHelper.getDefaultStrokeStyle(),
            lineWidth: width,
          };
      return {
        ...prev,
        data,
      };
    });
  };

  return (
    <>
      <button
        className={
          selectedLineWidth === 2 ? "clip-tool-btn hover" : "clip-tool-btn"
        }
        onClick={() => setLineWidth(2)}
      >
        <Circle r={2} />
      </button>
      <button
        className={
          selectedLineWidth === 4 ? "clip-tool-btn hover" : "clip-tool-btn"
        }
        onClick={() => setLineWidth(4)}
      >
        <Circle r={4} />
      </button>
      <button
        className={
          selectedLineWidth === 6 ? "clip-tool-btn hover" : "clip-tool-btn"
        }
        onClick={() => setLineWidth(6)}
      >
        <Circle r={6} />
      </button>
      <div className="clip-tool-separator" />
      <input
        type="color"
        defaultValue={ClipToolHelper.getDefaultStrokeStyle()}
        onChange={(e) => {
          const color = e.currentTarget.value;
          if (color) {
            screenLogSignal.emit(`line tool color changed: ${color}`);
            clipToolState.setState((prev) => {
              const data: ClipToolLineData = prev.data
                ? {
                    ...(prev.data as ClipToolLineData),
                    strokeStyle: color,
                  }
                : {
                    lineWidth: ClipToolHelper.getDefaultLineWidth(),
                    strokeStyle: color,
                  };
              return {
                ...prev,
                data,
              };
            });
          }
        }}
      />
    </>
  );
}

function RectToolSettings() {
  const [selectedLineWidth, setSelectedLineWidth] = useState<number>(
    ClipToolHelper.getDefaultLineWidth()
  );

  useEffect(() => {
    const listenToolState = (state: ClipToolStateData) => {
      if (state.data && state.tool === "rect" && state.data.lineWidth) {
        setSelectedLineWidth(state.data.lineWidth);
      }
    };
    clipToolState.subscribe(listenToolState);

    return () => {
      clipToolState.unsubscribe(listenToolState);
    };
  }, []);

  const setLineWidth = (width: number) => {
    clipToolState.setState((prev) => {
      const data: ClipToolLineData = prev.data
        ? {
            ...(prev.data as ClipToolLineData),
            lineWidth: width,
          }
        : {
            strokeStyle: ClipToolHelper.getDefaultStrokeStyle(),
            lineWidth: width,
          };
      return {
        ...prev,
        data,
      };
    });
  };

  return (
    <>
      <button
        className={
          selectedLineWidth === 2 ? "clip-tool-btn hover" : "clip-tool-btn"
        }
        onClick={() => setLineWidth(2)}
      >
        <Circle r={2} />
      </button>
      <button
        className={
          selectedLineWidth === 4 ? "clip-tool-btn hover" : "clip-tool-btn"
        }
        onClick={() => setLineWidth(4)}
      >
        <Circle r={4} />
      </button>
      <button
        className={
          selectedLineWidth === 6 ? "clip-tool-btn hover" : "clip-tool-btn"
        }
        onClick={() => setLineWidth(6)}
      >
        <Circle r={6} />
      </button>
      <div className="clip-tool-separator" />
      <input
        type="color"
        defaultValue={ClipToolHelper.getDefaultStrokeStyle()}
        onChange={(e) => {
          const color = e.currentTarget.value;
          if (color) {
            screenLogSignal.emit(`line tool color changed: ${color}`);
            clipToolState.setState((prev) => {
              const data: ClipToolLineData = prev.data
                ? {
                    ...(prev.data as ClipToolLineData),
                    strokeStyle: color,
                  }
                : {
                    lineWidth: ClipToolHelper.getDefaultLineWidth(),
                    strokeStyle: color,
                  };
              return {
                ...prev,
                data,
              };
            });
          }
        }}
      />
    </>
  );
}

function ToolSettings() {
  const [currentTool, setCurrentTool] = useState<ClipToolStateData["tool"]>();
  useEffect(() => {
    const listenToolState = (data: ClipToolStateData) => {
      setCurrentTool(data.tool);

      // visible settings container and set current btn style
      const settingsContainer = document.getElementById(
        "clip-tool-settings-container"
      ) as HTMLDivElement;
      const clipToolsContainer = document.getElementById(
        "clip-tools-container"
      );
      if (data.tool && clipToolsContainer?.style.visibility === "visible") {
        // 如果 data.tool 有值并且当前窗口的 clipToolsContainer 是可见的
        // 那么说明有工具在当前窗口被选中
        // 则 visible settings container
        // 并且设置当前工具为 hover 属性, 其他工具为非 hover 属性
        if (settingsContainer.style.visibility === "visible") {
          // 如果已经是 visible 了那么跳过
          return;
        }
        settingsContainer.style.visibility = "visible";
        const toolBtn = document.getElementById(
          ClipToolHelper.makeClipToolBtnId(data.tool)
        ) as HTMLButtonElement;
        toolBtn.className = "clip-tool-btn clip-tool-btn-tip hover";
        const otherBtns = ClipToolHelper.getOtherToolElems(data.tool);
        otherBtns.forEach((btn) => {
          btn.className = "clip-tool-btn clip-tool-btn-tip";
        });

        const toolBtnRect = toolBtn.getBoundingClientRect();
        screenLogSignal.emit(
          `visible tool: ${data.tool}, rect: ${JSON.stringify(
            toolBtnRect,
            null,
            2
          )}`
        );
        settingsContainer.style.left = `${
          toolBtnRect.left - STYLES_CONSTS.toolsContainerPaddingX
        }px`;
        settingsContainer.style.top = `${
          toolBtnRect.top +
          toolBtnRect.height +
          STYLES_CONSTS.toolsContainerPaddingY +
          4
        }px`;
      } else {
        const otherBtns = ClipToolHelper.getOtherToolElems(data.tool);
        otherBtns.forEach((btn) => {
          btn.className = "clip-tool-btn clip-tool-btn-tip";
        });
        settingsContainer.style.visibility = "hidden";
      }
    };
    clipToolState.subscribe(listenToolState);

    return () => {
      clipToolState.unsubscribe(listenToolState);
    };
  }, []);

  const contents = () => {
    switch (currentTool) {
      case "line":
        return <LineToolSettings />;
      case "rect":
        return <RectToolSettings />;
      default:
        return null;
    }
  };

  return (
    <div
      id="clip-tool-settings-container"
      style={{
        visibility: "hidden",
        zIndex: 20,
        position: "absolute",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "8px",
        backgroundColor: "var(--toolbar-bg)",
        padding: `${STYLES_CONSTS.toolsContainerPaddingY}px ${STYLES_CONSTS.toolsContainerPaddingX}px`,
      }}
    >
      {contents()}
    </div>
  );
}

type ToolBtnProps = {
  name: Exclude<ClipToolStateData["tool"], undefined>;
  tooltip: string;
  children: React.ReactNode;
  onClick: (reqSelect: boolean) => Promise<ClipToolStateData>;
};
function ToolBtn({ name, tooltip, children, onClick }: ToolBtnProps) {
  return (
    <button
      id={`clip-tool-btn-${name}`}
      className="clip-tool-btn clip-tool-btn-tip"
      data-tooltip={tooltip}
      onClick={async () => {
        if (clipToolState.data.tool === name) {
          // if prev tool state is the same as current, request deselect tool
          clipToolState.setState(await onClick(false));
        } else {
          // if prev tool state is different from current, request select tool
          const data = await onClick(true);
          clipToolState.setState(data);
        }
      }}
    >
      {children}
    </button>
  );
}

function CopyToClipboardBtn() {
  const [loading, setLoading] = useState(false);

  return (
    <button
      className="clip-tool-btn clip-tool-btn-tip"
      data-tooltip="Copy to clipboard"
      disabled={loading}
      onClick={async () => {
        if (loading) return;

        try {
          setLoading(true);
          const clippedImg = await getClippedImage("tauri-img");
          if (!clippedImg) {
            return;
          }
          await writeImage(clippedImg);
          // await invoke("clip_cancel");
          await TauriBroadcast.broadcast("clip-cancel");
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
