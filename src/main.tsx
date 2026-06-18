import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import "./styles.css";

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason instanceof Error ? event.reason.message : String(event.reason || "");
  if (reason.includes("[canceled]") || reason.includes("signal is aborted")) {
    event.preventDefault();
  }
});

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
