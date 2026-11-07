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

/** Section with title + "Show all"; horizontal scroller on phones, grid on larger screens. */
export function Section({
  title,
  subtitle,
  href,
  children,
  grid = true,
  rail = false,
}: {
  title: React.ReactNode;
  subtitle?: string;
  href?: string;
  children: React.ReactNode;
  grid?: boolean;
  rail?: boolean;
}) {
  return (
    <section className={rail ? "mt-5" : "mt-6 sm:mt-8"}>
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
      {rail ? (
        <div className="no-scrollbar flex gap-3 overflow-x-auto px-4 pb-1 sm:px-6 sm:[&>*]:w-[150px]">
          {children}
        </div>
      ) : grid ? (
        <div className="no-scrollbar flex gap-4 overflow-x-auto px-4 pb-1 sm:grid sm:grid-cols-[repeat(auto-fill,minmax(170px,1fr))] sm:gap-6 sm:overflow-visible sm:px-6 [&>*:nth-child(n+13)]:sm:hidden">
          {children}
        </div>
      ) : (
        <div className="px-2 sm:px-2">{children}</div>
      )}
    </section>
  );
}
