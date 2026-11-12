"use client";

import { ChevronRight, Moon, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { Avatar, TopBar } from "@/components/nav/top-bar";
import { fetcher } from "@/lib/client/api";
import { useAuth } from "@/lib/client/auth";
import { sendJamAction, useJam } from "@/lib/client/jam";
import { useMe } from "@/lib/client/me";
import { usePlayer } from "@/lib/client/player/store";
import type { SocialResponse } from "@/lib/client/social";
import { useUI } from "@/lib/client/ui";
import { ChartIcon, HeartIcon, LibraryIcon, LogoutIcon, SettingsIcon, UploadIcon } from "@/components/icons";

function Item({ icon, title, body, badge, href, onClick }: { icon: React.ReactNode; title: string; body?: string; badge?: number; href?: string; onClick?: () => void }) {
  const inner = (
    <>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-white">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold">{title}</span>
        {body && <span className="block truncate text-xs text-subdued">{body}</span>}
      </span>
      {badge ? <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-black">{badge}</span> : null}
      <ChevronRight size={18} className="shrink-0 text-subdued" />
    </>
  );
  const className = "flex w-full items-center gap-4 rounded-lg px-3 py-3 text-left hover:bg-white/10 active:bg-white/5";
  return href ? <Link href={href} className={className}>{inner}</Link> : <button type="button" onClick={onClick} className={className}>{inner}</button>;
}

/** The "You" tab: account, stats, friends, playback settings and admin tools in one place. */
export default function YouPage() {
  const { user, signOut, mode } = useAuth();
  const { data: me } = useMe();
  const router = useRouter();
  const jam = useJam((s) => s.room);
  const sleeping = usePlayer((s) => s.sleepAt !== null || s.sleepAfterTrack);
  const { data: social } = useSWR<SocialResponse>(me ? "/api/connections" : null, fetcher, { refreshInterval: 60_000 });
  const pending = (social?.connections.filter((c) => c.status === "pending" && c.requestedBy !== me?.user.uid).length ?? 0) + (social?.jamRequests.filter((r) => r.toUid === me?.user.uid && r.status === "pending").length ?? 0);
  const likes = Object.keys(me?.library.likes ?? {}).length;
  return (
    <div className="pb-8">
      <TopBar showBack={false}>
        <h1 className="text-2xl font-bold">You</h1>
      </TopBar>
      <div className="mx-auto max-w-2xl px-3 sm:px-6">
        <Link href={`/user/${me?.user.uid ?? ""}`} className="flex items-center gap-4 rounded-xl bg-card p-4 hover:bg-card-hover">
          <Avatar size={56} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-lg font-bold">{user?.name}</div>
            <div className="truncate text-sm text-subdued">{user?.email ?? (mode === "demo" ? "Local demo account" : "")}</div>
            <div className="mt-1 text-xs font-semibold text-accent">View profile</div>
          </div>
          {me?.user.isAdmin && <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-bold text-accent">Admin</span>}
        </Link>

        <div className="mt-4 space-y-1">
          <Item icon={<ChartIcon size={20} />} title="Your stats" body="Minutes, top artists, listening clock" href="/stats" />
          <Item icon={<Users size={20} />} title="Friends & Jams" body={jam ? "You’re in a Jam" : "Invite friends, see what they play"} badge={pending} href="/friends" />
          <Item icon={<HeartIcon size={20} />} title="Liked Songs" body={`${likes} song${likes === 1 ? "" : "s"}`} href="/liked" />
          <Item icon={sleeping ? <Moon size={20} /> : <SettingsIcon size={20} />} title="Playback settings" body={sleeping ? "Sleep timer on · crossfade, speed, volume" : "Autoplay, crossfade, volume, speed, sleep timer"} onClick={() => useUI.getState().setPlaybackSettingsOpen(true)} />
        </div>

        {me?.user.isAdmin && (
          <>
            <h2 className="mt-6 px-3 text-[11px] font-bold uppercase tracking-widest text-muted">Admin</h2>
            <div className="mt-1 space-y-1">
              <Item icon={<ChartIcon size={20} />} title="Dashboard" href="/admin" />
              <Item icon={<UploadIcon size={20} />} title="Upload music" href="/admin/upload" />
              <Item icon={<LibraryIcon size={20} />} title="Manage library" href="/admin/library" />
            </div>
          </>
        )}

        <div className="mt-6">
          <Item
            icon={<LogoutIcon size={20} />}
            title="Log out"
            onClick={async () => {
              await sendJamAction({ type: "leave" });
              usePlayer.getState().stop();
              await signOut();
              router.replace("/login");
            }}
          />
        </div>
      </div>
    </div>
  );
}
