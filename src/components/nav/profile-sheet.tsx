"use client";

import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/client/auth";
import { useMe } from "@/lib/client/me";
import { usePlayer } from "@/lib/client/player/store";
import { useUI } from "@/lib/client/ui";
import { ChartIcon, LibraryIcon, LogoutIcon, RadioIcon, UploadIcon } from "../icons";
import { Sheet, SheetItem } from "../ui/sheet";
import { Avatar } from "./top-bar";

export function ProfileSheet() {
  const open = useUI((s) => s.profileOpen);
  const setOpen = useUI((s) => s.setProfileOpen);
  const { user, signOut, mode } = useAuth();
  const { data: me } = useMe();
  const autoplay = usePlayer((s) => s.autoplay);
  const router = useRouter();
  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };
  return (
    <Sheet open={open} onClose={() => setOpen(false)} label="Account">
      <div className="flex items-center gap-4 border-b border-white/10 px-5 py-5">
        <Avatar size={52} />
        <div className="min-w-0">
          <div className="truncate text-lg font-bold">{user?.name}</div>
          <div className="truncate text-sm text-subdued">{user?.email ?? (mode === "demo" ? "Local demo account" : "")}</div>
          {me?.user.isAdmin && <span className="mt-1 inline-block rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-bold text-accent">Admin</span>}
        </div>
      </div>
      <div className="py-2">
        <SheetItem icon={<ChartIcon />} onClick={() => go("/stats")}>
          Your listening stats
        </SheetItem>
        <SheetItem icon={<LibraryIcon />} onClick={() => go("/library")}>
          Your Library
        </SheetItem>
        {me?.user.isAdmin && (
          <>
            <SheetItem icon={<ChartIcon />} onClick={() => go("/admin")}>
              Admin dashboard
            </SheetItem>
            <SheetItem icon={<UploadIcon />} onClick={() => go("/admin/upload")}>
              Upload music
            </SheetItem>
          </>
        )}
        <label className="flex cursor-pointer items-center gap-4 px-5 py-3 text-[15px] font-medium hover:bg-white/10">
          <span className="flex w-6 justify-center text-subdued">
            <RadioIcon />
          </span>
          <span className="flex-1">
            Autoplay
            <span className="block text-xs font-normal text-subdued">Keep playing similar songs when your music ends</span>
          </span>
          <input type="checkbox" className="h-5 w-5 accent-[#1ed760]" checked={autoplay} onChange={(e) => usePlayer.getState().setAutoplay(e.target.checked)} />
        </label>
        <SheetItem
          icon={<LogoutIcon />}
          onClick={async () => {
            setOpen(false);
            usePlayer.getState().stop();
            await signOut();
            router.replace("/login");
          }}
        >
          Log out
        </SheetItem>
      </div>
    </Sheet>
  );
}
