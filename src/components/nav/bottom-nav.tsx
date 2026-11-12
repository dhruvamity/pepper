"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMe } from "@/lib/client/me";
import { HomeIcon, LibraryIcon, SearchIcon } from "../icons";
import { Avatar } from "./top-bar";

function Tab({ href, label, active, icon }: { href: string; label: string; active: boolean; icon: React.ReactNode }) {
  return (
    <Link href={href} className={`flex flex-1 flex-col items-center justify-center gap-1 text-[10px] font-medium ${active ? "text-white" : "text-subdued"}`} aria-current={active ? "page" : undefined}>
      {icon}
      {label}
    </Link>
  );
}

/** Phone tab bar: Home · Search · Your Library · You (stats, friends, settings and admin live under You). */
export function BottomNav() {
  const path = usePathname();
  const { data: me } = useMe();
  const you = path === "/you" || path === "/stats" || path.startsWith("/friends") || path.startsWith("/admin") || path.startsWith("/add/") || (!!me && path === `/user/${me.user.uid}`);
  return (
    <nav
      aria-label="Main"
      className="flex h-[calc(var(--bottom-nav-h)+env(safe-area-inset-bottom))] items-stretch bg-gradient-to-t from-black via-black/95 to-black/60 px-2 pb-[env(safe-area-inset-bottom)] pt-1 md:hidden"
    >
      <Tab href="/" label="Home" active={path === "/"} icon={<HomeIcon filled={path === "/"} />} />
      <Tab href="/search" label="Search" active={path.startsWith("/search")} icon={<SearchIcon bold={path.startsWith("/search")} />} />
      <Tab href="/library" label="Your Library" active={path.startsWith("/library") || path === "/liked"} icon={<LibraryIcon filled={path.startsWith("/library")} />} />
      <Tab href="/you" label="You" active={you} icon={<span className={`rounded-full ${you ? "ring-2 ring-white" : ""}`}><Avatar size={24} /></span>} />
    </nav>
  );
}
