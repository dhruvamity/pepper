"use client";

import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/client/auth";
import { useUI } from "@/lib/client/ui";
import { ChevronLeftIcon, ChevronRightIcon } from "../icons";
import { PlayButton } from "../ui/play-button";
import { useScrollProgress } from "./scroll";

export function Avatar({ size = 32, className = "" }: { size?: number; className?: string }) {
  const { user } = useAuth();
  const initial = (user?.name ?? "?").trim().charAt(0).toUpperCase();
  return user?.photoURL ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={user.photoURL} alt="" referrerPolicy="no-referrer" className={`rounded-full object-cover ${className}`} style={{ width: size, height: size }} />
  ) : (
    <span className={`inline-flex items-center justify-center rounded-full bg-[#ff7d4d] font-bold text-black ${className}`} style={{ width: size, height: size, fontSize: size * 0.45 }}>
      {initial}
    </span>
  );
}

/**
 * Sticky page header. Transparent over the page gradient, fading to `color` as you scroll and
 * revealing the page title (+ a compact play button), like the web player.
 */
export function TopBar({
  title,
  color = "#121212",
  onPlay,
  playing,
  showBack = true,
  children,
  fadeStart = 180,
  fadeEnd = 280,
}: {
  title?: string;
  color?: string;
  onPlay?: () => void;
  playing?: boolean;
  showBack?: boolean;
  children?: React.ReactNode;
  fadeStart?: number;
  fadeEnd?: number;
}) {
  const router = useRouter();
  const p = useScrollProgress(fadeStart, fadeEnd);
  const { user } = useAuth();
  const openProfile = useUI((s) => s.setProfileOpen);
  return (
    <div className="sticky top-0 z-30 safe-top">
      <div className="absolute inset-0 transition-opacity" style={{ backgroundColor: color, opacity: p, backgroundImage: "linear-gradient(rgb(0 0 0 / 0.35), rgb(0 0 0 / 0.35))" }} />
      <div className="relative flex h-14 items-center gap-2 px-4 sm:h-16 sm:px-6">
        {showBack && (
          <>
            <button type="button" aria-label="Go back" onClick={() => router.back()} className="flex h-8 w-8 items-center justify-center rounded-full bg-black/70 text-white">
              <ChevronLeftIcon size={18} />
            </button>
            <button type="button" aria-label="Go forward" onClick={() => router.forward()} className="hidden h-8 w-8 items-center justify-center rounded-full bg-black/70 text-white md:flex">
              <ChevronRightIcon size={18} />
            </button>
          </>
        )}
        <div className="flex min-w-0 flex-1 items-center gap-3 transition-opacity" style={{ opacity: title ? p : 1 }}>
          {onPlay && title && p > 0.5 && <PlayButton size={40} playing={playing} onClick={onPlay} />}
          {title ? <span className="truncate text-xl font-bold sm:text-2xl">{title}</span> : children}
        </div>
        <button
          type="button"
          onClick={() => openProfile(true)}
          className="hidden items-center gap-2 rounded-full bg-black/70 p-0.5 pr-3 text-sm font-bold text-white transition hover:bg-[#282828] md:flex"
          aria-label="Account"
        >
          <Avatar size={28} />
          <span className="max-w-[140px] truncate">{user?.name}</span>
        </button>
      </div>
    </div>
  );
}
