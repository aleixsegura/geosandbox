import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/400-italic.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/caveat/500.css";
import "@fontsource/caveat/600.css";
import "./index.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { useStore } from "./state/store";
import { applyTheme, THEMES } from "./theme/themes";
import { connect } from "./ws/client";

applyTheme(THEMES[useStore.getState().theme]);

// deck.gl builds text atlases from loaded fonts: wait for the canvas fonts first.
Promise.all([
  document.fonts.load('600 32px "Caveat"'),
  document.fonts.load('400 12px "JetBrains Mono"'),
]).finally(() => {
  connect();
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
