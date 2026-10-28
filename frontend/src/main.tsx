import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import { App } from "./App";
import { BrowserGate } from "./components/BrowserGate";
import { AuthProvider } from "./context/AuthContext";
import { SessionProvider } from "./context/SessionContext";

const container = document.getElementById("root");
if (!container) throw new Error("Root element was not found.");

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <BrowserGate>
        <AuthProvider>
          <SessionProvider>
            <App />
          </SessionProvider>
        </AuthProvider>
      </BrowserGate>
    </BrowserRouter>
  </StrictMode>,
);
