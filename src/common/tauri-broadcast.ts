import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ClipToolStateData } from "../overlay/clip-state";

type BroadcastEvent = {
  "clip-start": undefined;
  "clip-end": { displayId: number };
  "clip-cancel": undefined;
  "clip-tool-select": ClipToolStateData & { displayId: string };
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
