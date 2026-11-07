"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";

/** Bottom sheet on phones, centred dialog on larger screens. */
export function Sheet({ open, onClose, children, label, wide }: { open: boolean; onClose: () => void; children: React.ReactNode; label: string; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={label}>
      <button type="button" aria-label="Close" className="absolute inset-0 animate-fade-in bg-black/70" onClick={onClose} />
      <div
        className={`relative max-h-[88dvh] w-full animate-slide-up overflow-y-auto rounded-t-2xl bg-elevated pb-[max(16px,env(safe-area-inset-bottom))] shadow-float sm:animate-fade-in sm:rounded-xl sm:pb-2 ${
          wide ? "sm:max-w-2xl" : "sm:max-w-md"
        }`}
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-white/25 sm:hidden" />
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function SheetItem({ icon, children, onClick, danger }: { icon?: React.ReactNode; children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-4 px-5 py-3 text-left text-[15px] font-medium transition-colors hover:bg-white/10 active:bg-white/5 ${
        danger ? "text-danger" : "text-white"
      }`}
    >
      <span className="flex w-6 justify-center text-subdued">{icon}</span>
      <span className="flex-1">{children}</span>
    </button>
  );
}
