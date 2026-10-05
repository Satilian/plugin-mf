import { createRoot, hydrateRoot } from "react-dom/client";
import App from "./App";

export function bootstrap() {
  const rootEl = document.getElementById("root");
  if (rootEl) {
    if (!rootEl.innerHTML.trim()) createRoot(rootEl).render(<App />);
    else hydrateRoot(rootEl, <App />);
  }
}
