import { State } from "../common/state";
import { Display, Point } from "./cord-trans";

export type Screenshot = {
  id: number;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  image_data: string;
  format: string;
};

export type ClipStateData = {
  isClipping: boolean;
  isUserSelected: boolean;
  startPoint?: Point;
  startPointGlobalNotNormalized?: Point;
  endPoint?: Point;
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
