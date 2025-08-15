import ReactDOM from "react-dom/client";
import { openUrl } from "@tauri-apps/plugin-opener";
import "./index.css";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

function Main() {
  const [screenshotFmt, setScreenshotFmt] = useState<string>();

  const getScreenshotFormat = async () => {
    const fmt = await invoke<string>("get_screenshot_format");
    setScreenshotFmt(fmt);
  };
  useEffect(() => {
    getScreenshotFormat();
  }, []);

  return (
    <div className="main-container">
      <div className="screenshot-icon">📸</div>
      <h1>Tauri screenshot example</h1>
      <p className="subtitle">
        A screenshot tool example with a good multi-display support.
      </p>

      <div>Screenshot Format: {screenshotFmt}</div>
      <div>
        <select
          name="screenshot_format"
          id="screenshot_format"
          value={screenshotFmt}
          onChange={async (e) => {
            try {
              const newFormat = e.target.value;
              const result = await invoke<string>("set_screenshot_format", {
                format: newFormat,
              });
              setScreenshotFmt(result);
            } catch (error) {
              console.error("Error setting screenshot format:", error);
            }
          }}
        >
          <option value="jpeg">JPEG</option>
          <option value="png">PNG</option>
          <option value="raw">RAW</option>
        </select>
      </div>

      <div className="shortcut-display">
        Press Cmd + Shift + S to take a screenshot <br />
        (or Ctrl + Shift + S on Windows)
      </div>

      <div className="github-section">
        <p>
          If this project is useful to you, please consider giving it a star on{" "}
          <a
            className="github-link"
            href="https://github.com/March-mitsuki/tauri-screenshot-example"
            onClick={(e) => {
              e.preventDefault();
              openUrl(
                "https://github.com/March-mitsuki/tauri-screenshot-example"
              );
            }}
          >
            GitHub ⭐
          </a>{" "}
        </p>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <Main />
);
