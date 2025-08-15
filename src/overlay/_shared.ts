import { Screenshot, screenshotMetaState } from "./clip-state";
import { Point } from "./cord-trans";

export type Area2D = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type RGB = {
  r: number;
  g: number;
  b: number;
};

export function drawScreenshot(
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

    if (screen.format === "jpeg" || screen.format === "png") {
      const img = new Image();
      img.src = `data:image/${screen.format};base64,${screen.image_data}`;
      img.onload = () => {
        ctx.drawImage(img, 0, 0, screen.width, screen.height);
        resolve();
      };
      img.onerror = (error) => {
        reject(error);
      };
    } else {
      reject(new Error("Unsupported screenshot format"));
    }
  });
}

export function drawGrayOverlay(
  canvas: HTMLCanvasElement,
  screenMeta: Omit<Screenshot, "image_data">,
  userSelection?: Area2D
): Promise<void> {
  return new Promise<void>((resolve) => {
    canvas.width = screenMeta.width;
    canvas.height = screenMeta.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      resolve();
      return;
    }

    ctx.fillStyle = "rgba(50, 50, 50, 0.5)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (userSelection) {
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "rgba(0, 0, 0, 1)";
      ctx.fillRect(
        userSelection.x,
        userSelection.y,
        userSelection.width,
        userSelection.height
      );
      // reset composite operation
      ctx.globalCompositeOperation = "source-over";
    }

    resolve();
  });
}

/**
 * Get logical area around mouse point.
 * Will auto-adjust for canvas scaling.
 */
export function getMouseAroundArea(
  canvas: HTMLCanvasElement,
  point: Point,
  padding: number,
  scale: number = 3
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get canvas context");

  // 像素对齐
  const px = Math.floor(point.x);
  const py = Math.floor(point.y);

  const monitorScaleFactor = screenshotMetaState.data!.scale;
  const physicalArea = {
    x: px * monitorScaleFactor - padding * monitorScaleFactor,
    y: py * monitorScaleFactor - padding * monitorScaleFactor,
    width: padding * 2 * monitorScaleFactor,
    height: padding * 2 * monitorScaleFactor,
  };
  const logicalArea = {
    x: px - padding,
    y: py - padding,
    width: padding * 2,
    height: padding * 2,
  };

  const pointPixel = ctx.getImageData(px, py, 1, 1);
  const pointPixelRGB: RGB = {
    r: pointPixel.data[0],
    g: pointPixel.data[1],
    b: pointPixel.data[2],
  };

  // 1) 先取原尺寸 ImageData
  const areaData = ctx.getImageData(
    physicalArea.x,
    physicalArea.y,
    physicalArea.width,
    physicalArea.height
  );

  // 2) 原尺寸临时画布
  const srcCanvas = document.createElement("canvas");
  srcCanvas.width = physicalArea.width;
  srcCanvas.height = physicalArea.height;
  srcCanvas.getContext("2d")!.putImageData(areaData, 0, 0);

  // 3) 目标（放大）画布
  const aroundAreaCanvas = document.createElement("canvas");
  aroundAreaCanvas.width = logicalArea.width * scale;
  aroundAreaCanvas.height = logicalArea.height * scale;

  const aroundAreaCtx = aroundAreaCanvas.getContext("2d")!;
  aroundAreaCtx.imageSmoothingEnabled = false; // 关键：关闭插值
  aroundAreaCtx.drawImage(
    srcCanvas,
    0,
    0,
    physicalArea.width,
    physicalArea.height, // 源区域
    0,
    0,
    logicalArea.width * scale,
    logicalArea.height * scale // 目标区域（放大）
  );

  // 4) 画 1px 实心十字线（放大后画，更锐利）
  aroundAreaCtx.save();
  aroundAreaCtx.globalAlpha = 1;
  aroundAreaCtx.fillStyle = "red";

  // 注意：此时坐标用“放大后”的宽高
  const W = aroundAreaCanvas.width;
  const H = aroundAreaCanvas.height;
  // 让十字线对齐中心像素
  const cx = Math.floor(W / 2);
  const cy = Math.floor(H / 2);

  // 垂直线（1px 宽，整高）
  aroundAreaCtx.fillRect(cx, 0, 1, H);
  // 水平线（1px 高，整宽）
  aroundAreaCtx.fillRect(0, cy, W, 1);
  aroundAreaCtx.restore();

  const aroundAreaDataUrl = aroundAreaCanvas.toDataURL();

  return [
    pointPixelRGB,
    aroundAreaDataUrl,
    {
      width: aroundAreaCanvas.width,
      height: aroundAreaCanvas.height,
    },
  ] as const;
}

export function rgbToHex(rgb: RGB): string {
  const toHex = (value: number) => {
    const hex = value.toString(16);
    return hex.length === 1 ? "0" + hex : hex;
  };
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

/**
 * Detects the area between two points.
 * @param start Start Point
 * @param end End Point
 * @returns Area2D or undefined
 */
export function detectArea(
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
