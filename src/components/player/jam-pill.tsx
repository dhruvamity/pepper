"use client";

import { Users } from "lucide-react";
import { setJamOpen, useJam } from "@/lib/client/jam";

/** Phone-only pill above the mini player while a Jam room is active (Jam left the tab bar). */
export function JamPill() {
  const room = useJam((s) => s.room);
  const connection = useJam((s) => s.connection);
  if (!room) return null;
  const count = room.members.length;
  return (
    <div className="flex justify-end px-3 pb-1.5 md:hidden">
      <button
        type="button"
        onClick={() => setJamOpen(true)}
        className="pointer-events-auto flex items-center gap-2 rounded-full bg-accent px-3 py-1.5 text-xs font-bold text-black shadow-float"
        aria-label="Open Jam"
      >
        <span className={`h-2 w-2 rounded-full ${connection === "live" ? "bg-black" : "animate-pulse bg-black/50"}`} />
        <Users size={14} /> Jam · {count} listening
      </button>
    </div>
  );
}
