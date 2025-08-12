import ReactDOM from "react-dom/client";

function Main() {
  return (
    <div>
      <h1>Hello, world!</h1>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <Main />
);
