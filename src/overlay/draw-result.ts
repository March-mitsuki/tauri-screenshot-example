import { detectArea } from "./_shared";
import type {
  ClipStateData,
  ClipToolLineData,
  ClipToolRectData,
  DrawnToolStateData,
  Screenshot,
} from "./clip-state";
import coordTrans, { type Display } from "./cord-trans";

export async function getClipResult(
  param: Omit<
    Parameters<typeof drawClipResult>[0],
    "resultCanvas" | "clipCanvas"
  >
) {
  const resultCanvas = document.createElement("canvas") as HTMLCanvasElement;
  const clipCanvas = document.createElement("canvas") as HTMLCanvasElement;
  await drawClipResult({
    resultCanvas,
    clipCanvas,
    ...param,
  });
  return {
    dataUrl: clipCanvas.toDataURL(),
    width: clipCanvas.width,
    height: clipCanvas.height,
  };
}

export async function drawClipResult({
  resultCanvas,
  clipCanvas,
  screenshots,
  screenshotMetaData,
  clipStateData,
  toolResults,
}: {
  resultCanvas: HTMLCanvasElement;
  clipCanvas: HTMLCanvasElement;
  screenshots: Screenshot[];
  clipStateData: ClipStateData;
  screenshotMetaData: Omit<Screenshot, "image_data">;
  toolResults: DrawnToolStateData;
}) {
  const clipArea = detectArea(
    coordTrans.scalePoint(
      clipStateData.startPointGlobalNotNormalized,
      screenshotMetaData.scale
    ),
    coordTrans.scalePoint(
      clipStateData.endPointGlobalNotNormalized,
      screenshotMetaData.scale
    )
  );
  if (!clipArea) {
    throw new Error("Failed to detect clipping area");
  }

  const displays = screenshots.map(coordTrans.screenshotToDisplay);
  const desktopBounds = coordTrans.getDesktopBounds(displays);
  resultCanvas.width = desktopBounds.width;
  resultCanvas.height = desktopBounds.height;
  const resultCanvasCtx = resultCanvas.getContext("2d");
  if (!resultCanvasCtx) {
    throw new Error("Failed to get result canvas context");
  }
  for (const screenshot of screenshots) {
    await drawScreenshot(resultCanvasCtx, screenshot, displays);
  }

  for (const toolResult of toolResults) {
    switch (toolResult.tool) {
      case "line": {
        const data = toolResult.data as ClipToolLineData;
        resultCanvasCtx.save();

        resultCanvasCtx.lineWidth = data.lineWidth * screenshotMetaData.scale;
        resultCanvasCtx.strokeStyle = data.strokeStyle;
        const normalizedStartP = coordTrans.globalToNormalized(
          data.startPoint!,
          displays
        );
        const normalizedEndP = coordTrans.globalToNormalized(
          data.endPoint!,
          displays
        );
        const scaledNormalizedStartP = coordTrans.scalePoint(
          normalizedStartP,
          screenshotMetaData.scale
        )!;
        const scaledNormalizedEndP = coordTrans.scalePoint(
          normalizedEndP,
          screenshotMetaData.scale
        )!;

        resultCanvasCtx.beginPath();
        resultCanvasCtx.moveTo(
          scaledNormalizedStartP.x,
          scaledNormalizedStartP.y
        );
        resultCanvasCtx.lineTo(scaledNormalizedEndP.x, scaledNormalizedEndP.y);
        resultCanvasCtx.stroke();

        resultCanvasCtx.restore();
        break;
      }
      case "rect": {
        const data = toolResult.data as ClipToolRectData;
        resultCanvasCtx.save();

        resultCanvasCtx.lineWidth = data.lineWidth * screenshotMetaData.scale;
        resultCanvasCtx.strokeStyle = data.strokeStyle;
        const normalizedStartP = coordTrans.globalToNormalized(
          data.startPoint!,
          displays
        );
        const normalizedEndP = coordTrans.globalToNormalized(
          data.endPoint!,
          displays
        );

        const area = detectArea(
          coordTrans.scalePoint(normalizedStartP, screenshotMetaData.scale),
          coordTrans.scalePoint(normalizedEndP, screenshotMetaData.scale)
        );
        if (!area) {
          resultCanvasCtx.restore();
          break;
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

  clipCanvas.width = clipArea.width;
  clipCanvas.height = clipArea.height;
  const clipCanvasCtx = clipCanvas.getContext("2d");
  if (!clipCanvasCtx) {
    throw new Error("Failed to get clip canvas context");
  }
  clipCanvasCtx.drawImage(
    resultCanvas,
    // src area from resultCanvas
    clipArea.x,
    clipArea.y,
    clipArea.width,
    clipArea.height,
    // target area to clipCanvas
    0,
    0,
    clipArea.width,
    clipArea.height
  );
}

async function drawScreenshot(
  ctx: CanvasRenderingContext2D,
  screenshot: Screenshot,
  displays: Display[]
) {
  const normalizedLeftTop = coordTrans.globalToNormalized(
    { x: screenshot.x, y: screenshot.y },
    displays
  );
  const url = `data:image/${screenshot.format};base64,${screenshot.image_data}`;
  const res = await fetch(url);
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob);
  ctx.drawImage(
    bitmap,
    normalizedLeftTop.x,
    normalizedLeftTop.y,
    screenshot.width,
    screenshot.height
  );
}
