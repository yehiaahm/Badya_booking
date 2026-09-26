import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import "./styles/index.css";
import { queryClient } from "./lib/queries";
import { useLanguage } from "./i18n/store";
import { App } from "./App";

/** Switching language re-renders every screen in the new language and direction. */
function Root() {
  const lang = useLanguage((s) => s.lang);
  return <App key={lang} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">
        <Root />
      </MotionConfig>
    </QueryClientProvider>
  </StrictMode>,
);
