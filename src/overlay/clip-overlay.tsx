import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import coordTrans, { Point } from "./cord-trans";
import {
  clipState,
  ClipStateData,
  displaysState,
  mousePointState,
  Screenshot,
  screenshotMetaState,
  screenshotsState,
} from "./clip-state";
import { ScreenLogRenderer, screenLogSignal } from "../components/screen-log";

type Area2D = {
  x: number;
  y: number;
  width: number;
  height: number;
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

async function clipImage() {
  const clipArea = detectClipArea(
    clipState.data.startPointGlobalNotNormalized,
    clipState.data.endPointGlobalNotNormalized
  );
  if (!clipArea) {
    screenLogSignal.emit("clip area is empty, not clipping");
    return;
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
    return;
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
    return;
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

  const clippedImgUrl = clipCanvas.toDataURL("image/jpeg");
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
  await writeFile(targetPath, dataUrlToBytes(clippedImgUrl));
  clipState.setState({
    isClipping: false,
  });
  screenLogSignal.emit("clipped image written to file successfully");
}

function setClipStartState() {
  clipState.setState({
    isClipping: true,
    endPoint: undefined,
    startPoint: coordTrans.globalToClient(
      mousePointState.data,
      { displayId: screenshotMetaState.data!.id },
      displaysState.data
    ),
    startPointGlobalNotNormalized: coordTrans.globalToNormalized(
      mousePointState.data,
      displaysState.data
    ),
  });
}

function setClipEndState() {
  clipState.setState((prev) => ({
    ...prev,
    isClipping: false,
    endPoint: coordTrans.globalToClient(
      mousePointState.data,
      { displayId: screenshotMetaState.data!.id },
      displaysState.data
    ),
    endPointGlobalNotNormalized: coordTrans.globalToNormalized(
      mousePointState.data,
      displaysState.data
    ),
  }));
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
    clipImage();
  }
});
listen("mouse-move", (e) => {
  const { x, y } = e.payload as Point;
  mousePointState.setState({ x, y });
});

export function ClipOverlay() {
  const [mousemovePoint, setMousemovePoint] = useState<Point>();
  const [clientMousemovePoint, setClientMousemovePoint] = useState<Point>();
  const [isClipping, setIsClipping] = useState(false);
  // const [clipArea, setClipArea] = useState<Area2D>();

  useEffect(() => {
    const handleMouseDown = () => {
      invoke("clip_start");
    };
    const handleMouseUp = () => {
      invoke("clip_end", { displayId: screenshotMetaState.data!.id });
    };
    const handleClipStateChange = (data: ClipStateData) => {
      // setClipArea(detectClipArea(data.startPoint, data.endPoint));
      setIsClipping(data.isClipping);
      const area = detectClipArea(data.startPoint, data.endPoint);
      const overlay = document.getElementById("clip-overlay");
      if (!overlay) return;
      if (!area) {
        overlay.style.width = "0px";
        overlay.style.height = "0px";
        return;
      }

      overlay.style.left = `${area.x}px`;
      overlay.style.top = `${area.y}px`;
      overlay.style.width = `${area.width}px`;
      overlay.style.height = `${area.height}px`;
    };
    const handleMouseMove = (p: Point) => {
      setMousemovePoint(p);
      setClientMousemovePoint(
        coordTrans.globalToClient(
          p,
          { displayId: screenshotMetaState.data!.id },
          displaysState.data
        )
      );
      if (clipState.isClipping && clipState.startPoint) {
        clipState.setClipEnd(
          coordTrans.globalToClient(
            p,
            { displayId: screenshotMetaState.data!.id },
            displaysState.data
          )
        );
      }
    };

    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mouseup", handleMouseUp);
    clipState.subscribe(handleClipStateChange);
    mousePointState.subscribe(handleMouseMove);

    return () => {
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mouseup", handleMouseUp);
      clipState.unsubscribe(handleClipStateChange);
      mousePointState.unsubscribe(handleMouseMove);
    };
  }, []);

  return (
    <>
      <div
        id="clip-overlay"
        style={
          // clipArea
          //   ? {
          //       position: "absolute",
          //       backgroundColor: "rgba(255, 255, 255, 0.5)",
          //       border: "1px dashed rgba(0, 0, 0, 0.5)",
          //       left: `${clipArea.x}px`,
          //       top: `${clipArea.y}px`,
          //       width: `${clipArea.width}px`,
          //       height: `${clipArea.height}px`,
          //     }
          //   : undefined
          {
            position: "absolute",
            backgroundColor: "rgba(255, 255, 255, 0.5)",
            border: "1px dashed rgba(0, 0, 0, 0.5)",
          }
        }
      ></div>
      {mousemovePoint && (
        <div
          style={{
            position: "absolute",
            zIndex: 10,
            left: "5rem",
            top: "5rem",
            color: "pink",
          }}
        >
          {`(${mousemovePoint.x}, ${mousemovePoint.y})`}
        </div>
      )}
      {clientMousemovePoint && (
        <div
          style={{
            position: "absolute",
            zIndex: 10,
            left: "5rem",
            top: "8rem",
            color: "orange",
          }}
        >
          {`(${clientMousemovePoint.x}, ${clientMousemovePoint.y})`}
        </div>
      )}
      {isClipping && (
        <div
          style={{
            position: "absolute",
            zIndex: 10,
            left: "5rem",
            top: "2rem",
            color: "red",
          }}
        >
          Clipping...
        </div>
      )}
      <ScreenLogRenderer />
    </>
  );
}
