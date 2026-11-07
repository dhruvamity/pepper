"use client";

import { PauseIcon, PlayIcon } from "../icons";

/** The big green circular play button. */
export function PlayButton({
  playing,
  onClick,
  size = 56,
  className = "",
  label,
}: {
  playing?: boolean;
  onClick: (e: React.MouseEvent) => void;
  size?: number;
  className?: string;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onClick(e);
      }}
      aria-label={label ?? (playing ? "Pause" : "Play")}
      className={`flex shrink-0 items-center justify-center rounded-full bg-accent text-black shadow-[0_8px_8px_rgb(0_0_0/0.3)] transition hover:scale-105 hover:bg-accent-hover active:scale-95 active:bg-accent-press ${className}`}
      style={{ width: size, height: size }}
    >
      {playing ? <PauseIcon size={size * 0.43} /> : <PlayIcon size={size * 0.43} />}
    </button>
  );
}

export function IconButton({
  label,
  onClick,
  active,
  className = "",
  children,
  disabled,
}: {
  label: string;
  onClick?: (e: React.MouseEvent) => void;
  active?: boolean;
  className?: string;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(e);
      }}
      className={`relative inline-flex items-center justify-center rounded-full transition disabled:opacity-40 ${
        active ? "text-accent hover:text-accent-hover" : "text-subdued hover:text-white"
      } ${className}`}
    >
      {children}
      {active && <span className="absolute -bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-accent" />}
    </button>
  );
}
