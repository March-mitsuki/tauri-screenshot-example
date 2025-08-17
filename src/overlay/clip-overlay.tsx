import { cloneElement, useEffect, useState } from "react";
import { Image as TauriImage } from "@tauri-apps/api/image";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile, remove, BaseDirectory } from "@tauri-apps/plugin-fs";
import coordTrans, { Point } from "./cord-trans";
import {
  clipToolState,
  ClipToolStateData,
  clipState,
  displaysState,
  mousePointState,
  screenshotMetaState,
  ClipToolLineData,
  ClipToolHelper,
  ClipToolRectData,
  drawnToolState,
  ClipToolName,
  screenshotsState,
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
import { Tooltip } from "../components/tooltip";
import { getClipResult } from "./draw-result";
import { cacheDir, join } from "@tauri-apps/api/path";
import { randomToken } from "../common/random";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

const STYLES_CONSTS = {
  toolsContainerPaddingX: 4,
  toolsContainerPaddingY: 4,
  toolSettingsContainerSpacing: 4,
  overflowPadding: 8,
};

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",")[1];
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function setClipStartState() {
  const globalPoint = mousePointState.data;
  if (!globalPoint) return;
  const toolsContainer = document.getElementById("clip-tools-container");
  toolsContainer!.style.visibility = "hidden";
  clipToolState.setState((prev) => ({
    ...prev,
    currentTool: undefined,
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
    startPointGlobal: globalPoint,
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
      endPointGlobal: globalPoint,
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
  const rightBottom: Point = {
    x: clipArea.x + clipArea.width,
    y: clipArea.y + clipArea.height,
  };
  const rightBottomGlobal = coordTrans.clientToGlobal(
    rightBottom,
    { displayId: screenshotMetaState.data!.id },
    displaysState.data
  );
  const hitDisplay = coordTrans.hitTestDisplay(
    rightBottomGlobal,
    displaysState.data
  );
  if (!hitDisplay) {
    screenLogSignal.emit(
      `onClipEnd: hitDisplay is null | clipArea: ${JSON.stringify(
        clipArea,
        null,
        2
      )} | rightBottom: ${JSON.stringify(
        rightBottom,
        null,
        2
      )} | rightBottomGlobal: ${JSON.stringify(
        rightBottomGlobal,
        null,
        2
      )} | Displays: ${JSON.stringify(displaysState.data, null, 2)}`
    );
    return;
  }
  if (hitDisplay.id === screenshotMetaState.data!.id) {
    visibleToolsContainer();
  } else {
    TauriBroadcast.broadcast("clip-end-current-display", {
      displayId: hitDisplay?.id,
      globalRightBottom: rightBottomGlobal,
    });
  }
}

function visibleToolsContainer() {
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

  const toolSettingsContainer = document.getElementById(
    "clip-tool-settings-container"
  ) as HTMLDivElement;
  const toolSettingsContainerRect =
    toolSettingsContainer.getBoundingClientRect();

  const containerLeftTop: Point = {
    x: clipArea.x + clipArea.width - toolsContainerRect.width,
    y: clipArea.y + clipArea.height + STYLES_CONSTS.overflowPadding,
  };
  if (containerLeftTop.x < 0) {
    containerLeftTop.x = STYLES_CONSTS.overflowPadding;
  }
  if (containerLeftTop.y < 0) {
    containerLeftTop.y = STYLES_CONSTS.overflowPadding;
  }
  if (containerLeftTop.x + toolsContainerRect.width > window.innerWidth) {
    containerLeftTop.x = window.innerWidth - toolsContainerRect.width;
  }
  if (
    containerLeftTop.y +
      toolsContainerRect.height +
      toolSettingsContainerRect.height +
      STYLES_CONSTS.toolSettingsContainerSpacing >
    window.innerHeight
  ) {
    // 如果下面展示不下, 那么尝试放到选区上面
    const positionOnTopY =
      clipArea.y - toolsContainerRect.height - STYLES_CONSTS.overflowPadding;
    if (positionOnTopY - toolSettingsContainerRect.height > 0) {
      containerLeftTop.y = positionOnTopY;
    } else {
      // 如果上面也展示不下, 例如截取整个高度, 那么放到选取里的右下角
      containerLeftTop.y =
        clipArea.y +
        clipArea.height -
        toolsContainerRect.height -
        STYLES_CONSTS.overflowPadding;
      containerLeftTop.x =
        clipArea.x +
        clipArea.width -
        toolsContainerRect.width -
        STYLES_CONSTS.overflowPadding;
    }
    // 放到上面和选区里的右下角时
    // 设置 popup-placement 给 settings-container 并提前返回
    toolSettingsContainer.setAttribute("popup-placement", "top");
    toolsContainer.style.left = `${containerLeftTop.x}px`;
    toolsContainer.style.top = `${containerLeftTop.y}px`;
    return;
  }
  // 其他情况则设置弹出到底部
  toolSettingsContainer.setAttribute("popup-placement", "bottom");
  toolsContainer.style.left = `${containerLeftTop.x}px`;
  toolsContainer.style.top = `${containerLeftTop.y}px`;
}

function isMouseInsideUI(globalPoint?: Point): boolean {
  if (!globalPoint) return false;

  const isUserSelected = clipState.data.isUserSelected;
  const toolsContainer = document.getElementById(
    "clip-tools-container"
  ) as HTMLDivElement;
  const toolsContainerRect = toolsContainer.getBoundingClientRect();
  const clientP = coordTrans.globalToClient(
    globalPoint,
    { displayId: screenshotMetaState.data!.id },
    displaysState.data
  );
  if (
    isUserSelected &&
    clientP.x >= toolsContainerRect.left &&
    clientP.x <= toolsContainerRect.right &&
    clientP.y >= toolsContainerRect.top &&
    clientP.y <= toolsContainerRect.bottom
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
    clientP.x >= toolSettingsContainerRect.left &&
    clientP.x <= toolSettingsContainerRect.right &&
    clientP.y >= toolSettingsContainerRect.top &&
    clientP.y <= toolSettingsContainerRect.bottom
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
    typeof clipToolState.data.currentTool !== "undefined"
  ) {
    const payload = clipToolState.data;
    payload.toolData[clipToolState.data.currentTool] = {
      ...payload.toolData[clipToolState.data.currentTool],
      startPoint: mousePointState.data,
      endPoint: undefined,
    };
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
    typeof clipToolState.data.currentTool !== "undefined"
  ) {
    const payload = clipToolState.data;
    payload.toolData[clipToolState.data.currentTool] = {
      ...payload.toolData[clipToolState.data.currentTool],
      endPoint: mousePointState.data,
    };
    TauriBroadcast.broadcast("clip-tool-end", payload);
    return true;
  }
  return false;
}

listen("mouse-move", async (e) => {
  const p = e.payload as Point;
  const desktopBounds = displaysState.desktopBounds;
  if (!desktopBounds) return;
  if (
    p.x < desktopBounds.originX ||
    p.y < desktopBounds.originY ||
    p.x > desktopBounds.originX + desktopBounds.width ||
    p.y > desktopBounds.originY + desktopBounds.height
  ) {
    return;
  }

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
  const hitDisplay = coordTrans.hitTestDisplay(p, displaysState.data);
  if (!hitDisplay) {
    screenLogSignal.emit(
      `onMouseMove: hitDisplay is null | mousePoint: ${JSON.stringify(
        p,
        null,
        2
      )} | displays: ${JSON.stringify(displaysState.data, null, 2)}`
    );
    return;
  }
  if (!screenshotMetaState.data) {
    screenLogSignal.emit("onMouseMove: screenshotMetaState.data is null");
    return;
  }
  if (hitDisplay.id === screenshotMetaState.data.id) {
    const webviewWindow = getCurrentWebviewWindow();
    const isFocused = await webviewWindow.isFocused();
    if (!isFocused) {
      screenLogSignal.emit(
        `onMouseMove: will focus ${screenshotMetaState.data.name}`
      );
      try {
        await webviewWindow.setFocus();
      } catch (error) {
        screenLogSignal.emit(
          `onMouseMove: failed to focus ${screenshotMetaState.data.name} | error: ${error}`
        );
      }
    }
  }
});
type MouseButton = "left" | "right";
listen("mouse-btn-press", (e) => {
  const button = e.payload as MouseButton;
  if (button === "left") {
    if (!mousePointState.data || !screenshotMetaState.data) {
      screenLogSignal.emit(
        "mouse-btn-press: invalid mousePoint or screenshotMeta"
      );
      return;
    }
    if (
      !coordTrans.isGlobalPointInDisplay(
        mousePointState.data,
        coordTrans.screenshotToDisplay(screenshotMetaState.data)
      )
    ) {
      screenLogSignal.emit("mouse-btn-press: outside this display, ignore");
      return;
    }
    if (isMouseInsideUI(mousePointState.data)) {
      screenLogSignal.emit("mouse-btn-press: mouse inside UI, ignore");
      return;
    }
    const needReturn = handleInvokeClipToolStart();
    if (needReturn) {
      screenLogSignal.emit(
        "mouse-btn-press: clip tool start invoked and return early"
      );
      return;
    }
    screenLogSignal.emit("mouse-btn-press: clip start");
    TauriBroadcast.broadcast("clip-start");
  }
});
listen("mouse-btn-release", (e) => {
  const button = e.payload as MouseButton;
  if (button === "left") {
    if (!mousePointState.data || !screenshotMetaState.data) {
      screenLogSignal.emit(
        "mouse-btn-release: invalid mousePoint or screenshotMeta"
      );
      return;
    }
    if (
      !coordTrans.isGlobalPointInDisplay(
        mousePointState.data,
        coordTrans.screenshotToDisplay(screenshotMetaState.data)
      )
    ) {
      screenLogSignal.emit("mouse-btn-release: outside this display, ignore");
      return;
    }
    if (isMouseInsideUI(mousePointState.data)) {
      screenLogSignal.emit("mouse-btn-release: mouse inside UI, ignore");
      return;
    }
    const needReturn = handleInvokeClipToolEnd();
    if (needReturn) {
      screenLogSignal.emit(
        "mouse-btn-release: clip tool end invoked and return early"
      );
      return;
    }
    screenLogSignal.emit("mouse-btn-release: clip end");
    TauriBroadcast.broadcast("clip-end", {
      displayId: screenshotMetaState.data!.id,
    });
  }
});
TauriBroadcast.listen("clip-start", () => {
  setClipStartState();
});
TauriBroadcast.listen("clip-end", (data) => {
  setClipEndState();
  // displayId 是用户点击的屏幕的 ID
  // 这里过滤掉其他的是因为只需要做一次计算就够了
  if (data.displayId === screenshotMetaState.data?.id) {
    onClipEnd();
  }
});
TauriBroadcast.listen("clip-end-current-display", (data) => {
  // displayId 是用户选定区域最终右下角坐标所在的显示器的 ID
  if (data.displayId !== screenshotMetaState.data?.id) {
    return;
  }
  visibleToolsContainer();
});
TauriBroadcast.listen("clip-tool-select", (data) => {
  clipToolState.setState({
    currentTool: data.currentTool,
    toolData: data.toolData,
  });
});
TauriBroadcast.listen("clip-tool-start", (data) => {
  clipToolState.setState(data);
  screenLogSignal.emit(`
    Tool started: ${data.currentTool}, ${JSON.stringify(data, null, 2)}
  `);
});
TauriBroadcast.listen("clip-tool-end", (data) => {
  clipToolState.setState((prev) => {
    const newState = {
      currentTool: data.currentTool,
      toolData: {
        ...prev.toolData,
        ...data.toolData,
      },
    } as ClipToolStateData;
    screenLogSignal.emit(
      `Tool ended: ${data.currentTool}, new: ${JSON.stringify(
        newState,
        null,
        2
      )}`
    );
    drawnToolState.setState((prev) => [
      ...prev,
      {
        tool: newState.currentTool!,
        data: newState.toolData[newState.currentTool!],
      },
    ]);
    return newState;
  });
});

export function ClipOverlay() {
  useEffect(() => {
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
        if (clipToolState.data.currentTool) {
          const clipToolCanvas = document.getElementById(
            "clip-tool-tmp-canvas"
          ) as HTMLCanvasElement;
          const ctx = clipToolCanvas.getContext("2d");
          if (!ctx) {
            screenLogSignal.emit("Failed to get clip-tool-tmp-canvas context");
            return;
          }
          // 如果有设置 tool 那么根据 tool 检查 data 查看是否已经开始绘图
          switch (clipToolState.data.currentTool) {
            case "line": {
              const data = clipToolState.data.toolData.line as ClipToolLineData;
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
              const data = clipToolState.data.toolData.rect as ClipToolRectData;
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
  }, []);

  return (
    <>
      {/* For debug */}
      <CoordInfo />

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
  return (
    <>
      <PixelInfo />

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
          boxShadow: "0px 0px 15px -5px #000000",
        }}
      >
        <ToolBtn
          name="line"
          tooltip="Draw Line"
          onClick={async (reqSelect) => {
            if (reqSelect) {
              return {
                currentTool: "line",
                toolData: {
                  ...clipToolState.data.toolData,
                },
              };
            } else {
              return {
                currentTool: undefined,
                toolData: {
                  ...clipToolState.data.toolData,
                },
              };
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
              return {
                currentTool: "rect",
                toolData: {
                  ...clipToolState.data.toolData,
                },
              };
            } else {
              return {
                currentTool: undefined,
                toolData: {
                  ...clipToolState.data.toolData,
                },
              };
            }
          }}
        >
          <RectIcon />
        </ToolBtn>

        <div className="clip-tool-separator" />

        <SaveLocalBtn />
        <TooltipBtn tooltip="Cancel">
          <button
            className="clip-tool-btn"
            onClick={async () => {
              TauriBroadcast.broadcast("clip-cancel");
            }}
          >
            <CrossIcon />
          </button>
        </TooltipBtn>
        <CopyToClipboardBtn />
      </div>
      <ToolSettings />
    </>
  );
}

function PixelInfo() {
  const [rgbContent, setRgbContent] = useState<React.ReactNode>();
  const [hexContent, setHexContent] = useState<React.ReactNode>();

  useEffect(() => {
    const drawPixelInfo = () => {
      try {
        const desktopBounds = displaysState.desktopBounds!;
        const container = document.getElementById(
          "pixel-info-container"
        ) as HTMLDivElement;
        if (clipState.data.isUserSelected) {
          container.style.visibility = "hidden";
          return;
        }

        const globalPoint = mousePointState.data;
        if (!globalPoint) return;

        const thisDisplayData = coordTrans.screenshotToDisplay(
          screenshotMetaState.data!
        );
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

        const screenshotCanvas = document.getElementById(
          "screenshot-canvas"
        ) as HTMLCanvasElement;
        const [mousePointRGB, aroundAreaImgUrl, scaledCanvasWH] =
          getMouseAroundArea(screenshotCanvas, clientPoint, 15, 5);

        aroundAreaImg.src = aroundAreaImgUrl;
        aroundAreaImg.width = scaledCanvasWH.width;
        aroundAreaImg.height = scaledCanvasWH.height;

        container.style.width = `${scaledCanvasWH.width}px`;
        let containerLeft = clientPoint.x + STYLES_CONSTS.overflowPadding;
        let containerTop = clientPoint.y + STYLES_CONSTS.overflowPadding;
        let containerRight = containerLeft + scaledCanvasWH.width;
        let containerBottom =
          containerTop + container.getBoundingClientRect().height;

        if (containerRight > window.innerWidth) {
          containerLeft =
            clientPoint.x -
            scaledCanvasWH.width -
            STYLES_CONSTS.overflowPadding;
        }
        if (containerBottom > window.innerHeight) {
          containerTop =
            clientPoint.y -
            container.getBoundingClientRect().height -
            STYLES_CONSTS.overflowPadding;
        }

        container.style.left = `${containerLeft}px`;
        container.style.top = `${containerTop}px`;

        mousePointDiv.textContent = `(${globalPoint.x}, ${globalPoint.y})`;
        setRgbContent(
          <>
            <div>RGB:</div>
            <Circle
              r={5}
              style={{
                backgroundColor: `rgb(${mousePointRGB.r}, ${mousePointRGB.g}, ${mousePointRGB.b})`,
              }}
            />
            <div>
              {mousePointRGB.r}, {mousePointRGB.g}, {mousePointRGB.b}
            </div>
          </>
        );
        setHexContent(
          <>
            <div>HEX:</div>
            <Circle
              r={5}
              style={{
                backgroundColor: rgbToHex(mousePointRGB),
              }}
            />
            <div>{rgbToHex(mousePointRGB)}</div>
          </>
        );
      } catch (error) {
        screenLogSignal.emit(`drawPixelInfo error: ${error}`);
      } finally {
        requestAnimationFrame(drawPixelInfo);
      }
    };
    requestAnimationFrame(drawPixelInfo);
  }, []);

  return (
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
      <div
        id="mouse-point-rgb-div"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "4px",
        }}
      >
        {rgbContent}
      </div>
      <div
        id="mouse-point-hex-div"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "4px",
          paddingBottom: "4px",
        }}
      >
        {hexContent}
      </div>
    </div>
  );
}

function TooltipBtn({
  children,
  tooltip,
}: {
  children: React.ReactElement<any>;
  tooltip: React.ReactElement<any> | string;
}) {
  const [isHover, setIsHover] = useState(false);
  const content = typeof tooltip === "string" ? <>{tooltip}</> : tooltip;

  return (
    <Tooltip visible={isHover} content={content}>
      {cloneElement(children, {
        onMouseEnter: (e: MouseEvent) => {
          setIsHover(true);
          children.props.onMouseEnter?.(e);
        },
        onMouseLeave: (e: MouseEvent) => {
          setIsHover(false);
          children.props.onMouseLeave?.(e);
        },
      })}
    </Tooltip>
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
    clipToolState.data.toolData.line.lineWidth
  );

  useEffect(() => {
    const listenToolState = (state: ClipToolStateData) => {
      if (state.currentTool === "line") {
        setSelectedLineWidth(state.toolData.line.lineWidth);
      }
    };
    clipToolState.subscribe(listenToolState);

    return () => {
      clipToolState.unsubscribe(listenToolState);
    };
  }, []);

  const setLineWidth = (width: number) => {
    TauriBroadcast.broadcast("clip-tool-select", {
      currentTool: "line",
      toolData: {
        ...clipToolState.data.toolData,
        line: {
          ...clipToolState.data.toolData.line,
          lineWidth: width,
        },
      },
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
        defaultValue={clipToolState.data.toolData.line.strokeStyle}
        onChange={(e) => {
          const color = e.currentTarget.value;
          if (color) {
            TauriBroadcast.broadcast("clip-tool-select", {
              currentTool: "line",
              toolData: {
                ...clipToolState.data.toolData,
                line: {
                  ...clipToolState.data.toolData.line,
                  strokeStyle: color,
                },
              },
            });
          }
        }}
      />
    </>
  );
}

function RectToolSettings() {
  const [selectedLineWidth, setSelectedLineWidth] = useState<number>(
    clipToolState.data.toolData.rect.lineWidth
  );

  useEffect(() => {
    const listenToolState = (state: ClipToolStateData) => {
      if (state.currentTool === "rect") {
        setSelectedLineWidth(state.toolData.rect.lineWidth);
      }
    };
    clipToolState.subscribe(listenToolState);

    return () => {
      clipToolState.unsubscribe(listenToolState);
    };
  }, []);

  const setLineWidth = (width: number) => {
    TauriBroadcast.broadcast("clip-tool-select", {
      currentTool: "rect",
      toolData: {
        ...clipToolState.data.toolData,
        rect: {
          ...clipToolState.data.toolData.rect,
          lineWidth: width,
        },
      },
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
        defaultValue={clipToolState.data.toolData.rect.strokeStyle}
        onChange={(e) => {
          const color = e.currentTarget.value;
          if (color) {
            TauriBroadcast.broadcast("clip-tool-select", {
              currentTool: "rect",
              toolData: {
                ...clipToolState.data.toolData,
                rect: {
                  ...clipToolState.data.toolData.rect,
                  strokeStyle: color,
                },
              },
            });
          }
        }}
      />
    </>
  );
}

function ToolSettings() {
  const [currentTool, setCurrentTool] =
    useState<ClipToolStateData["currentTool"]>();
  useEffect(() => {
    const listenToolState = (data: ClipToolStateData) => {
      setCurrentTool(data.currentTool);

      // visible settings container and set current btn style
      const settingsContainer = document.getElementById(
        "clip-tool-settings-container"
      ) as HTMLDivElement;
      const clipToolsContainer = document.getElementById(
        "clip-tools-container"
      ) as HTMLDivElement;
      if (
        data.currentTool &&
        clipToolsContainer?.style.visibility === "visible"
      ) {
        // 如果 data.tool 有值并且当前窗口的 clipToolsContainer 是可见的
        // 那么说明有工具在当前窗口被选中
        // 则 visible settings container
        // 并且设置当前工具为 hover 属性, 其他工具为非 hover 属性
        settingsContainer.style.visibility = "visible";
        const toolBtn = document.getElementById(
          ClipToolHelper.makeClipToolBtnId(data.currentTool)
        ) as HTMLButtonElement;
        toolBtn.classList.add("hover");
        const otherBtns = ClipToolHelper.getOtherToolElems(data.currentTool);
        otherBtns.forEach((btn) => {
          btn.classList.remove("hover");
        });

        const toolBtnRect = toolBtn.getBoundingClientRect();
        screenLogSignal.emit(
          `visible tool: ${data.currentTool}, rect: ${JSON.stringify(
            toolBtnRect,
            null,
            2
          )}`
        );
        const popupPlacement =
          settingsContainer.getAttribute("popup-placement");
        const clipToolsContainerRect =
          clipToolsContainer.getBoundingClientRect();
        const settingsContainerRect = settingsContainer.getBoundingClientRect();
        let left = toolBtnRect.left - STYLES_CONSTS.toolsContainerPaddingX;
        if (left + settingsContainerRect.width > window.innerWidth) {
          left = window.innerWidth - settingsContainerRect.width;
        }
        if (popupPlacement === "top") {
          let top =
            clipToolsContainerRect.top -
            settingsContainerRect.height -
            STYLES_CONSTS.toolSettingsContainerSpacing;

          settingsContainer.style.left = `${left}px`;
          settingsContainer.style.top = `${top}px`;
        } else {
          let top =
            clipToolsContainerRect.bottom +
            STYLES_CONSTS.toolSettingsContainerSpacing;

          settingsContainer.style.left = `${left}px`;
          settingsContainer.style.top = `${top}px`;
        }
      } else {
        const otherBtns = ClipToolHelper.getOtherToolElems(data.currentTool);
        otherBtns.forEach((btn) => {
          btn.classList.remove("hover");
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
        // 默认回复一个占位符, 用来显示 tools container 是计算位置用到
        // 这里约定每个 tool settings 的高度都一样, 并且只有一行 (宽度无所谓)
        return <LineToolSettings />;
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
        boxShadow: "0px 0px 15px -5px #000000",
      }}
    >
      {contents()}
    </div>
  );
}

type ToolBtnProps = {
  name: ClipToolName;
  tooltip: string;
  children: React.ReactNode;
  onClick: (reqSelect: boolean) => Promise<ClipToolStateData>;
};
function ToolBtn({ name, tooltip, children, onClick }: ToolBtnProps) {
  const [isHover, setIsHover] = useState(false);
  useEffect(() => {
    const toolBtn = document.getElementById(
      ClipToolHelper.makeClipToolBtnId(name)
    ) as HTMLButtonElement;
    if (!toolBtn) {
      screenLogSignal.emit(`Tool button with name ${name} not found`);
      return;
    }
    if (isHover) {
      toolBtn.classList.add("hover");
    } else {
      toolBtn.classList.remove("hover");
    }
  }, [isHover]);

  return (
    <Tooltip visible={isHover} content={tooltip}>
      <button
        id={`clip-tool-btn-${name}`}
        className="clip-tool-btn"
        data-tooltip={tooltip}
        onClick={async () => {
          const requestSelect = clipToolState.data.currentTool !== name;
          const data = await onClick(requestSelect);
          TauriBroadcast.broadcast("clip-tool-select", {
            ...data,
          });
        }}
        onMouseEnter={() => {
          setIsHover(true);
        }}
        onMouseLeave={() => {
          setIsHover(false);
        }}
      >
        {children}
      </button>
    </Tooltip>
  );
}

function SaveLocalBtn() {
  const [loading, setLoading] = useState(false);

  return (
    <TooltipBtn tooltip="Save">
      <button
        className="clip-tool-btn"
        onClick={async () => {
          try {
            setLoading(true);
            const clipResult = await getClipResult({
              screenshots: Object.values(screenshotsState.data),
              clipStateData: clipState.data,
              screenshotMetaData: screenshotMetaState.data!,
              toolResults: drawnToolState.data,
            });
            const targetPath = await save({
              defaultPath: `${Date.now()}`,
              filters: [
                {
                  name: "Image File",
                  extensions: [screenshotMetaState.data!.format],
                },
              ],
            });
            if (!targetPath) return;
            await writeFile(targetPath, dataUrlToBytes(clipResult.dataUrl));
            TauriBroadcast.broadcast("clip-cancel");
          } catch (error) {
            screenLogSignal.emit(`Failed to save clipped image: ${error}`);
          } finally {
            setLoading(false);
          }
        }}
      >
        {loading ? <DotSpinner /> : <DownloadIcon />}
      </button>
    </TooltipBtn>
  );
}

function CopyToClipboardBtn() {
  const [loading, setLoading] = useState(false);

  return (
    <TooltipBtn tooltip="Copy to clipboard">
      <button
        className="clip-tool-btn"
        disabled={loading}
        onClick={async () => {
          if (loading) return;

          try {
            setLoading(true);
            const clipResult = await getClipResult({
              screenshots: Object.values(screenshotsState.data),
              clipStateData: clipState.data,
              screenshotMetaData: screenshotMetaState.data!,
              toolResults: drawnToolState.data,
            });

            const filename = `screenshot-tmp-clip-${Date.now()}-${randomToken()}.png`;
            await writeFile(filename, dataUrlToBytes(clipResult.dataUrl), {
              baseDir: BaseDirectory.Cache,
            });
            const clippedImg = await TauriImage.fromPath(
              await join(await cacheDir(), filename)
            );
            await remove(filename, { baseDir: BaseDirectory.Cache });

            await writeImage(clippedImg);
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
    </TooltipBtn>
  );
}

function CoordInfo() {
  const [globalPoint, setGlobalPoint] = useState<Point>({ x: 0, y: 0 });
  const [clientPoint, setClientPoint] = useState<Point>({ x: 0, y: 0 });
  const [localPoint, setLocalPoint] = useState<Point>({ x: 0, y: 0 });

  useEffect(() => {
    const listenMouseState = (point?: Point) => {
      if (!point) return;
      setGlobalPoint(point);
      setClientPoint(
        coordTrans.globalToClient(
          point,
          { displayId: screenshotMetaState.data!.id },
          displaysState.data
        )
      );
    };
    const listenMouseMove = (e: MouseEvent) => {
      setLocalPoint({ x: e.clientX, y: e.clientY });
    };

    mousePointState.subscribe(listenMouseState);
    window.addEventListener("mousemove", listenMouseMove);

    return () => {
      mousePointState.unsubscribe(listenMouseState);
      window.removeEventListener("mousemove", listenMouseMove);
    };
  }, []);

  return (
    <div
      style={{
        position: "absolute",
        zIndex: 30,
        left: "5rem",
        top: "5rem",
        color: "orange",
      }}
    >
      <div>Name: {screenshotMetaState.data?.name}</div>
      <div>Global: {`(${globalPoint.x}, ${globalPoint.y})`}</div>
      <div>Client: {`(${clientPoint.x}, ${clientPoint.y})`}</div>
      <div>Local: {`(${localPoint.x}, ${localPoint.y})`}</div>
    </div>
  );
}
