"use client";

import { useState } from "react";
import type { ImageSet } from "@/lib/types";
import { mediaUrl } from "@/lib/util";
import { ArtistIcon, MusicNoteIcon } from "../icons";

/** Artwork with graceful fallback (gradient + note) when a file has no embedded cover. */
export function Cover({
  image,
  size = "sm",
  alt = "",
  className = "",
  rounded = "rounded",
  kind = "track",
  eager,
}: {
  image?: ImageSet;
  size?: "sm" | "lg";
  alt?: string;
  className?: string;
  rounded?: string;
  kind?: "track" | "artist";
  eager?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const src = image && !failed ? mediaUrl(size === "lg" ? image.lg : image.sm) : undefined;
  return (
    <div
      className={`relative overflow-hidden bg-elevated ${rounded} ${className}`}
      style={!src ? { background: `linear-gradient(135deg, ${image?.color ?? "#333"}, #181818)` } : undefined}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-subdued">
          {kind === "artist" ? <ArtistIcon className="h-1/3 w-1/3" /> : <MusicNoteIcon className="h-1/3 w-1/3" />}
        </div>
      )}
    </div>
  );
}

/** 2x2 collage used for mixes and playlists (falls back to one cover). */
export function Collage({ images, className = "", rounded = "rounded" }: { images: (ImageSet | undefined)[]; className?: string; rounded?: string }) {
  const list = images.filter(Boolean) as ImageSet[];
  if (list.length < 4) return <Cover image={list[0]} className={className} rounded={rounded} />;
  return (
    <div className={`grid grid-cols-2 grid-rows-2 overflow-hidden ${rounded} ${className}`}>
      {list.slice(0, 4).map((img, i) => (
        <Cover key={i} image={img} rounded="" className="h-full w-full" />
      ))}
    </div>
  );
}
