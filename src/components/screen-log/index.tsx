import { useEffect, useState } from "react";
import { Signal } from "../../common/signal";

export const screenLogSignal = new Signal<string>();

export function ScreenLogRenderer() {
  const [logs, setLogs] = useState<string[]>([]);

  useEffect(() => {
    const listener = (data: string) => {
      setLogs((prevLogs) => {
        if (prevLogs.length >= 100) {
          return [...prevLogs.slice(1), data];
        }
        return [...prevLogs, data];
      });
    };
    screenLogSignal.subscribe(listener);
    return () => {
      screenLogSignal.unsubscribe(listener);
    };
  }, []);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        overflowY: "hidden",
        maxHeight: "100vh",
        width: "400px",
        gap: "8px",
        position: "absolute",
        right: 0,
        top: 0,
        color: "violet",
        userSelect: "none",
      }}
    >
      {[...logs].reverse().map((log, index) => (
        <div key={index}>{log}</div>
      ))}
    </div>
  );
}
