"use client";

import { create } from "zustand";

export interface Toast {
  id: number;
  text: string;
  tone: "info" | "error";
}

interface ToastState {
  toasts: Toast[];
  push(text: string, tone?: Toast["tone"]): void;
  dismiss(id: number): void;
}

let seq = 0;

export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push(text, tone = "info") {
    const id = ++seq;
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id, text, tone }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), tone === "error" ? 5000 : 2600);
  },
  dismiss(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

export function toast(text: string, tone: Toast["tone"] = "info") {
  useToasts.getState().push(text, tone);
}
