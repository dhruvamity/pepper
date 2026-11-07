"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TopBar } from "@/components/nav/top-bar";
import { EmptyState } from "@/components/ui/collection";
import { useMe } from "@/lib/client/me";

const TABS = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/upload", label: "Upload" },
  { href: "/admin/library", label: "Library" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { data: me, isLoading } = useMe();
  const path = usePathname();
  if (isLoading || !me) return <div className="h-40 animate-pulse" />;
  if (!me.user.isAdmin) return <EmptyState title="Admins only" body="Ask the owner to add your email to ADMIN_EMAILS." />;
  return (
    <div>
      <TopBar showBack={false}>
        <span className="text-xl font-bold sm:text-2xl">Admin</span>
      </TopBar>
      <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 pb-4 sm:px-6">
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${path === t.href ? "bg-white text-black" : "bg-white/10 text-white hover:bg-white/20"}`}
          >
            {t.label}
          </Link>
        ))}
      </div>
      {children}
    </div>
  );
}
