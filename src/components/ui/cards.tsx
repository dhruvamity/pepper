"use client";

import Link from "next/link";
import type { ImageSet } from "@/lib/types";
import { Collage, Cover } from "./cover";
import { PlayButton } from "./play-button";

/** Spotify-style card: artwork, bold title, grey description, hover play button. */
export function MediaCard({
  href,
  title,
  subtitle,
  image,
  images,
  round,
  playing,
  onPlay,
  badge,
}: {
  href: string;
  title: string;
  subtitle?: React.ReactNode;
  image?: ImageSet;
  images?: (ImageSet | undefined)[];
  round?: boolean;
  playing?: boolean;
  onPlay?: () => void;
  badge?: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group relative flex w-[150px] shrink-0 flex-col gap-2 rounded-card p-0 transition-colors sm:w-auto sm:bg-card sm:p-3 sm:hover:bg-card-hover"
    >
      <div className="relative">
        {images ? (
          <Collage images={images} className="aspect-square w-full shadow-cover" rounded="rounded-md" />
        ) : (
          <Cover image={image} kind={round ? "artist" : "track"} className="aspect-square w-full shadow-cover" rounded={round ? "rounded-full" : "rounded-md"} />
        )}
        {badge}
        {onPlay && (
          <div
            className={`absolute bottom-2 right-2 hidden transition-all duration-300 sm:block ${
              playing ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100"
            }`}
          >
            <PlayButton playing={playing} onClick={onPlay} size={48} />
          </div>
        )}
      </div>
      <div className="min-w-0 sm:min-h-[62px]">
        <div className={`truncate text-[15px] font-bold leading-snug ${playing ? "text-accent" : "text-white"} ${round ? "sm:text-center" : ""}`}>{title}</div>
        {subtitle && <div className={`mt-1 line-clamp-2 text-[13px] leading-snug text-subdued sm:text-sm ${round ? "sm:text-center" : ""}`}>{subtitle}</div>}
      </div>
    </Link>
  );
}

/** Compact tile used in the 2-column "Good evening" grid. */
export function ShortcutTile({
  href,
  title,
  image,
  images,
  gradient,
  playing,
  onPlay,
}: {
  href: string;
  title: string;
  image?: ImageSet;
  images?: (ImageSet | undefined)[];
  gradient?: string;
  playing?: boolean;
  onPlay?: () => void;
}) {
  return (
    <Link
      href={href}
      className="group relative flex h-14 items-center gap-2 overflow-hidden rounded-[4px] bg-white/10 pr-2 transition-colors hover:bg-white/20 sm:h-16 sm:gap-4 sm:rounded-md"
    >
      {gradient ? (
        <div className="flex h-14 w-14 shrink-0 items-center justify-center sm:h-16 sm:w-16" style={{ background: gradient }}>
          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-white" aria-hidden="true">
            <path d="M15.724 4.22A4.313 4.313 0 0 0 12.192.814a4.269 4.269 0 0 0-3.622 1.13.837.837 0 0 1-1.14 0 4.272 4.272 0 0 0-6.21 5.855l5.916 7.05a1.128 1.128 0 0 0 1.727 0l5.916-7.05a4.228 4.228 0 0 0 .945-3.58z" transform="translate(4 4.5)" />
          </svg>
        </div>
      ) : images ? (
        <Collage images={images} className="h-14 w-14 shrink-0 shadow-[0_8px_24px_rgb(0_0_0/0.5)] sm:h-16 sm:w-16" rounded="" />
      ) : (
        <Cover image={image} className="h-14 w-14 shrink-0 shadow-[0_8px_24px_rgb(0_0_0/0.5)] sm:h-16 sm:w-16" rounded="" />
      )}
      <span className={`line-clamp-2 flex-1 text-[13px] font-bold leading-tight sm:text-base ${playing ? "text-accent" : "text-white"}`}>{title}</span>
      {onPlay && (
        <div className={`hidden pr-2 transition-opacity sm:block ${playing ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
          <PlayButton playing={playing} onClick={onPlay} size={40} />
        </div>
      )}
    </Link>
  );
}

/** Section with title + "Show all"; horizontal scroller on phones, grid on larger screens. */
export function Section({
  title,
  subtitle,
  href,
  children,
  grid = true,
}: {
  title: React.ReactNode;
  subtitle?: string;
  href?: string;
  children: React.ReactNode;
  grid?: boolean;
}) {
  return (
    <section className="mt-6 sm:mt-8">
      <div className="mb-3 flex items-end justify-between gap-4 px-4 sm:mb-4 sm:px-6">
        <div className="min-w-0">
          <h2 className="truncate text-[22px] font-bold leading-tight tracking-tight text-white sm:text-2xl">
            {href ? (
              <Link href={href} className="hover:underline">
                {title}
              </Link>
            ) : (
              title
            )}
          </h2>
          {subtitle && <p className="mt-0.5 text-[13px] text-subdued">{subtitle}</p>}
        </div>
        {href && (
          <Link href={href} className="shrink-0 text-[13px] font-bold text-subdued hover:underline sm:text-sm">
            Show all
          </Link>
        )}
      </div>
      {grid ? (
        <div className="no-scrollbar flex gap-4 overflow-x-auto px-4 pb-1 sm:grid sm:grid-cols-[repeat(auto-fill,minmax(170px,1fr))] sm:gap-6 sm:overflow-visible sm:px-6 [&>*:nth-child(n+13)]:sm:hidden">
          {children}
        </div>
      ) : (
        <div className="px-2 sm:px-2">{children}</div>
      )}
    </section>
  );
}
