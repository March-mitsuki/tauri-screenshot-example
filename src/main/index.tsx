import ReactDOM from "react-dom/client";
import { displaysState } from "../overlay/clip-state";
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Display } from "../overlay/cord-trans";

function Main() {
  useEffect(() => {
    invoke("get_displays_data").then((data) => {
      displaysState.setState(data as Display[]);
    });
  }, []);

  return (
    <div>
      <h1>Hello, world!</h1>
      <button
        onClick={() => {
          console.log(displaysState.data);
        }}
      >
        get displays data
      </button>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <Main />
);
