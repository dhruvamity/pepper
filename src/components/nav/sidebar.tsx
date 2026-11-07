"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMe, createPlaylist } from "@/lib/client/me";
import { usePlayer } from "@/lib/client/player/store";
import { ChartIcon, Equalizer, HomeIcon, LibraryIcon, Logo, PlusIcon, SearchIcon, UploadIcon } from "../icons";

function NavLink({ href, icon, label, active }: { href: string; icon: React.ReactNode; label: string; active: boolean }) {
  return (
    <Link href={href} className={`flex h-10 items-center gap-4 rounded px-2 text-sm font-bold transition-colors ${active ? "text-white" : "text-subdued hover:text-white"}`}>
      {icon}
      {label}
    </Link>
  );
}

export function Sidebar() {
  const path = usePathname();
  const router = useRouter();
  const { data: me } = useMe();
  const ctx = usePlayer((s) => s.context);
  const playing = usePlayer((s) => s.playing);
  const isAdmin = me?.user.isAdmin;
  return (
    <aside className="hidden w-[248px] shrink-0 flex-col bg-black pt-6 md:flex lg:w-[280px]">
      <Link href="/" className="mb-5 px-6 text-2xl text-white">
        <Logo />
      </Link>
      <nav className="px-4" aria-label="Main">
        <NavLink href="/" label="Home" active={path === "/"} icon={<HomeIcon filled={path === "/"} />} />
        <NavLink href="/search" label="Search" active={path.startsWith("/search")} icon={<SearchIcon bold={path.startsWith("/search")} />} />
        <NavLink href="/library" label="Your Library" active={path.startsWith("/library")} icon={<LibraryIcon filled={path.startsWith("/library")} />} />
      </nav>
      <div className="mt-6 px-4">
        <button
          type="button"
          onClick={async () => {
            const p = await createPlaylist();
            router.push(`/playlist/${p.id}`);
          }}
          className="group flex h-10 w-full items-center gap-4 rounded px-2 text-sm font-bold text-subdued transition-colors hover:text-white"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-[2px] bg-subdued text-black transition-colors group-hover:bg-white">
            <PlusIcon size={12} />
          </span>
          Create Playlist
        </button>
        <Link href="/liked" className={`group flex h-10 items-center gap-4 rounded px-2 text-sm font-bold transition-colors ${path === "/liked" ? "text-white" : "text-subdued hover:text-white"}`}>
          <span className="flex h-6 w-6 items-center justify-center rounded-[2px] bg-gradient-to-br from-[#450af5] to-[#c4efd9] opacity-80 group-hover:opacity-100">
            <svg viewBox="0 0 24 24" className="h-3 w-3 fill-white" aria-hidden="true">
              <path d="M15.724 4.22A4.313 4.313 0 0 0 12.192.814a4.269 4.269 0 0 0-3.622 1.13.837.837 0 0 1-1.14 0 4.272 4.272 0 0 0-6.21 5.855l5.916 7.05a1.128 1.128 0 0 0 1.727 0l5.916-7.05a4.228 4.228 0 0 0 .945-3.58z" transform="translate(4 4)" />
            </svg>
          </span>
          Liked Songs
        </Link>
        <Link href="/stats" className={`flex h-10 items-center gap-4 rounded px-2 text-sm font-bold transition-colors ${path === "/stats" ? "text-white" : "text-subdued hover:text-white"}`}>
          <span className="flex h-6 w-6 items-center justify-center rounded-[2px] bg-[#056952]">
            <ChartIcon size={14} className="text-[#1ed760]" />
          </span>
          Your stats
        </Link>
      </div>
      <div className="mx-6 mt-3 border-t border-[#282828]" />
      <div className="scroll-area mt-2 flex-1 overflow-y-auto px-4 pb-4">
        {me?.playlists.map((p) => (
          <Link
            key={p.id}
            href={`/playlist/${p.id}`}
            className={`flex h-8 items-center justify-between gap-2 rounded px-2 text-sm transition-colors ${path === `/playlist/${p.id}` ? "text-white" : "text-subdued hover:text-white"}`}
          >
            <span className="truncate">{p.name}</span>
            {ctx?.type === "playlist" && ctx.id === p.id && <Equalizer playing={playing} />}
          </Link>
        ))}
      </div>
      {isAdmin && (
        <div className="border-t border-[#282828] px-4 py-3">
          <div className="px-2 pb-1 text-[11px] font-bold uppercase tracking-widest text-muted">Admin</div>
          <NavLink href="/admin" label="Dashboard" active={path === "/admin"} icon={<ChartIcon size={20} />} />
          <NavLink href="/admin/upload" label="Upload music" active={path === "/admin/upload"} icon={<UploadIcon size={20} />} />
          <NavLink href="/admin/library" label="Manage library" active={path === "/admin/library"} icon={<LibraryIcon size={20} />} />
        </div>
      )}
    </aside>
  );
}
