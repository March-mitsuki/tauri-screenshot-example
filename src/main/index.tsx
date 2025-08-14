import ReactDOM from "react-dom/client";
import { openUrl } from "@tauri-apps/plugin-opener";
import "./index.css";

function Main() {
  return (
    <div className="main-container">
      <div className="screenshot-icon">📸</div>
      <h1>Tauri screenshot example</h1>
      <p className="subtitle">
        A screenshot tool example with a good multi-display support.
      </p>

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
