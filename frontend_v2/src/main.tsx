import React from "react";
import ReactDOM from "react-dom/client";
import { AppShell } from "./components/AppShell";
import "./theme.css";
import "./App.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <AppShell />
  </React.StrictMode>
);
