"use client";

import { useEffect } from "react";

/* Registers the shell cache (MOO-529). Renders nothing. Failure is silent by
 * design — a worker that won't install must never stop the app from loading,
 * and there is nothing the user could do about it anyway. */
export function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
