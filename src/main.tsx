import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "@fontsource/press-start-2p/400.css";
import "@fontsource/tiny5/400.css";
import "./styles/index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
