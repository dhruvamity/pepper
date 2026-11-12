"use client";

import { useRouter } from "next/navigation";
import { User as UserIcon, Users } from "lucide-react";
import { useAuth } from "@/lib/client/auth";
import { sendJamAction } from "@/lib/client/jam";
import { useMe } from "@/lib/client/me";
import { usePlayer } from "@/lib/client/player/store";
import { useUI } from "@/lib/client/ui";
import { ChartIcon, LibraryIcon, LogoutIcon, SettingsIcon, UploadIcon } from "../icons";
import { Sheet, SheetItem } from "../ui/sheet";
import { Avatar } from "./top-bar";

export function ProfileSheet() {
  const open = useUI((s) => s.profileOpen);
  const setOpen = useUI((s) => s.setProfileOpen);
  const { user, signOut, mode } = useAuth();
  const { data: me } = useMe();
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
        <SheetItem icon={<UserIcon size={20} />} onClick={() => go("/you")}>
          You
        </SheetItem>
        <SheetItem icon={<Users size={20} />} onClick={() => go("/friends")}>
          Friends & Jams
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
        <SheetItem icon={<SettingsIcon />} onClick={() => useUI.getState().setPlaybackSettingsOpen(true)}>
          Playback settings
          <span className="block text-xs font-normal text-subdued">Autoplay, crossfade, volume, speed, sleep timer</span>
        </SheetItem>
        <SheetItem
          icon={<LogoutIcon />}
          onClick={async () => {
            setOpen(false);
            await sendJamAction({ type: "leave" });
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
