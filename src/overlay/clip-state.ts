import { State } from "../common/state";
import { detectArea } from "./_shared";
import coordTrans, { Display, Point } from "./cord-trans";

export type Screenshot = {
  id: number;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  image_data: string;
  format: string;
  scale: number;
};

export type ClipStateData = {
  isClipping: boolean;
  isUserSelected: boolean;
  // client point
  startPoint?: Point;
  startPointGlobal?: Point;
  startPointGlobalNotNormalized?: Point;
  endPoint?: Point;
  endPointGlobal?: Point;
  endPointGlobalNotNormalized?: Point;
};
class ClipState extends State<ClipStateData> {
  constructor() {
    super({
      isClipping: false,
      isUserSelected: false,
      startPoint: { x: 0, y: 0 },
      endPoint: { x: 0, y: 0 },
    });
  }

  get isClipping() {
    return this._state.isClipping;
  }
  setIsClipping(isClipping: boolean) {
    this.setState((prevState) => ({
      ...prevState,
      isClipping,
    }));
  }

  get startPoint() {
    return this._state.startPoint;
  }
  setClipStart(point?: { x: number; y: number }) {
    this.setState((prevState) => ({
      ...prevState,
      startPoint: point,
    }));
  }

  get endPoint() {
    return this._state.endPoint;
  }
  setClipEnd(point?: { x: number; y: number }) {
    this.setState((prevState) => ({
      ...prevState,
      endPoint: point,
    }));
  }

  get isUserSelected() {
    return this._state.isUserSelected;
  }
  setIsUserSelected(isUserSelected: boolean) {
    this.setState((prevState) => ({
      ...prevState,
      isUserSelected,
    }));
  }
}

export const screenshotMetaState = new State<
  Omit<Screenshot, "image_data"> | undefined
>(undefined);
export const screenshotsState = new State<Record<string, Screenshot>>({});
export const mousePointState = new State<Point | undefined>(undefined);
export const displaysState = new State<Display[]>([]);
export const clipState = new ClipState();

export const CLIP_TOOL_NAMES = ["line", "rect"] as const;
export type ClipToolName = (typeof CLIP_TOOL_NAMES)[number];
export type ClipToolLineData = {
  startPoint?: Point;
  endPoint?: Point;
  lineWidth: number;
  strokeStyle: string;
};
export type ClipToolRectData = {
  startPoint?: Point;
  endPoint?: Point;
  lineWidth: number;
  strokeStyle: string;
};
export type ClipToolStateData = {
  currentTool?: ClipToolName;
  toolData: Record<ClipToolName, ClipToolLineData | ClipToolRectData>;
};
export type DrawnToolStateData = {
  tool: ClipToolName;
  data: ClipToolLineData | ClipToolRectData;
}[];
export class ClipToolHelper {
  static makeClipToolBtnId(name: ClipToolName) {
    return `clip-tool-btn-${name}`;
  }

  static getOtherToolNames(name?: ClipToolName): ClipToolName[] {
    if (!name) return CLIP_TOOL_NAMES as unknown as ClipToolName[];
    return CLIP_TOOL_NAMES.filter((tool) => tool !== name);
  }

  static getOtherToolElems(name?: ClipToolName): HTMLButtonElement[] {
    return ClipToolHelper.getOtherToolNames(name).map((toolName) => {
      return document.getElementById(
        ClipToolHelper.makeClipToolBtnId(toolName)
      ) as HTMLButtonElement;
    });
  }

  static getDefaultStrokeStyle(): string {
    return "#0099ff";
  }
  static getDefaultLineWidth(): number {
    return 2;
  }

  static clearCanvas(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  static drawLine(ctx: CanvasRenderingContext2D, data: ClipToolLineData) {
    ctx.save();

    ctx.lineWidth = data.lineWidth;
    ctx.strokeStyle = data.strokeStyle;
    const clientStartP = coordTrans.globalToClient(
      data.startPoint!,
      { displayId: screenshotMetaState.data!.id },
      displaysState.data
    );
    // 如果有 data.endPoint 说明已经绘制完成, 使用 data.endPoint 绘制结果
    // 如果没有则使用当前鼠标位置实时显示绘制结果
    const globalEndP = data.endPoint || mousePointState.data!;
    const clientEndP = coordTrans.globalToClient(
      globalEndP,
      { displayId: screenshotMetaState.data!.id },
      displaysState.data
    );

    ctx.beginPath();
    ctx.moveTo(clientStartP.x, clientStartP.y);
    ctx.lineTo(clientEndP.x, clientEndP.y);
    ctx.stroke();
    ctx.closePath();
    ctx.restore();
  }
  static drawRect(ctx: CanvasRenderingContext2D, data: ClipToolRectData) {
    ctx.save();

    ctx.lineWidth = data.lineWidth;
    ctx.strokeStyle = data.strokeStyle;
    const clientStartP = coordTrans.globalToClient(
      data.startPoint!,
      { displayId: screenshotMetaState.data!.id },
      displaysState.data
    );
    const globalEndP = data.endPoint || mousePointState.data!;
    const clientEndP = coordTrans.globalToClient(
      globalEndP,
      { displayId: screenshotMetaState.data!.id },
      displaysState.data
    );
    const area = detectArea(clientStartP, clientEndP);
    if (!area) {
      ctx.restore();
      return;
    }
    ctx.strokeRect(area.x, area.y, area.width, area.height);
    ctx.restore();
  }
}
export const clipToolState = new State<ClipToolStateData>({
  toolData: {
    line: {
      lineWidth: ClipToolHelper.getDefaultLineWidth(),
      strokeStyle: ClipToolHelper.getDefaultStrokeStyle(),
    },
    rect: {
      lineWidth: ClipToolHelper.getDefaultLineWidth(),
      strokeStyle: ClipToolHelper.getDefaultStrokeStyle(),
    },
  },
});
export const drawnToolState = new State<DrawnToolStateData>([]);
