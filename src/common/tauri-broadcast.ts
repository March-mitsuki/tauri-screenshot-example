import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ClipToolStateData } from "../overlay/clip-state";
import { Point } from "../overlay/cord-trans";

type BroadcastEvent = {
  "clip-start": undefined;
  // 当用户结束截图 (mouse up) 时触发
  // displayId 会是用户点击 (mouse down) 的显示器的 ID
  "clip-end": { displayId: number };
  // 触发 clip-end 后计算最终截图区域的右下角坐标落在哪个显示器
  // displayId 是最终右下角坐标所在的显示器的 ID
  "clip-end-current-display": { displayId: number; globalRightBottom: Point };
  "clip-cancel": undefined;
  "clip-tool-select": ClipToolStateData;
  "clip-tool-start": ClipToolStateData;
  "clip-tool-end": ClipToolStateData;
};
export class TauriBroadcast {
  static broadcast<K extends keyof BroadcastEvent>(
    event: K,
    ...args: BroadcastEvent[K] extends undefined
      ? []
      : [payload: BroadcastEvent[K]]
  ) {
    const payload = (args[0] ?? null) as BroadcastEvent[K];
    return invoke<void>("broadcast", {
      event,
      payload: JSON.stringify(payload),
    });
  }

  static listen<K extends keyof BroadcastEvent>(
    event: K,
    callback: (payload: BroadcastEvent[K]) => void
  ) {
    listen(event, (e) => {
      if (typeof e.payload === "string") {
        callback(JSON.parse(e.payload) as BroadcastEvent[K]);
      } else {
        console.error(`Event ${event} payload is not a string:`, e.payload);
      }
    });
  }
}
