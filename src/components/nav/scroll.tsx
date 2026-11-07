"use client";

import { createContext, useContext, useEffect, useState } from "react";

export const ScrollCtx = createContext<HTMLElement | null>(null);

/** 0..1 progress of the main scroll container past `start`..`end` pixels. */
export function useScrollProgress(start = 0, end = 200): number {
  const el = useContext(ScrollCtx);
  const [p, setP] = useState(0);
  useEffect(() => {
    if (!el) return;
    const on = () => setP(Math.min(1, Math.max(0, (el.scrollTop - start) / Math.max(1, end - start))));
    on();
    el.addEventListener("scroll", on, { passive: true });
    return () => el.removeEventListener("scroll", on);
  }, [el, start, end]);
  return p;
}

export function useScrollElement() {
  return useContext(ScrollCtx);
}
