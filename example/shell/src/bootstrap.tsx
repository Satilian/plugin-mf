import { createRoot, hydrateRoot } from "react-dom/client";
import App from "./App";
import { initializeMFReleases } from "plugin-mf/client";

export async function bootstrap() {
  await initializeMFReleases();
  const rootEl = document.getElementById("root");
  if (rootEl) {
    if (!rootEl.innerHTML.trim()) createRoot(rootEl).render(<App />);
    else hydrateRoot(rootEl, <App />);
  }
}
