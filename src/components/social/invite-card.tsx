"use client";

import { Copy, Link2, QrCode, RefreshCw, Share2, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import useSWR from "swr";
import { api, fetcher } from "@/lib/client/api";
import { parseInviteInput } from "@/lib/invite";
import { toast } from "@/lib/client/toast";

/** "Invite friends": the listener's link as QR + share/copy, and a box to paste a friend's link. */
export function InviteCard({ uid, onConnected }: { uid?: string; onConnected: () => Promise<unknown> }) {
  const router = useRouter();
  const { data: invite, mutate } = useSWR<{ code: string; path: string }>(uid ? "/api/me/invite" : null, fetcher, { revalidateOnFocus: false });
  const [qr, setQr] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const url = invite && typeof window !== "undefined" ? new URL(invite.path, window.location.origin).href : "";

  const share = async () => {
    if (!url) return;
    try {
      if (navigator.share) await navigator.share({ title: "Connect with me on Pepper", url });
      else {
        await navigator.clipboard.writeText(url);
        toast("Invite link copied");
      }
    } catch (error) {
      if ((error as DOMException).name !== "AbortError") setQr(true);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast("Invite link copied");
    } catch {
      setQr(true);
    }
  };
  const rotate = async () => {
    if (!confirm("Replace your invite link? Links you already shared will stop working.")) return;
    try {
      await mutate(api("/api/me/invite", { body: { rotate: true } }), { revalidate: false });
      toast("New invite link ready");
    } catch (error) {
      toast((error as Error).message, "error");
    }
  };
  const connect = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = parseInviteInput(input);
    if (!parsed) return toast("Paste a Pepper invite link or Pepper ID", "error");
    if ("inviteCode" in parsed) {
      setInput("");
      router.push(`/add/${parsed.inviteCode}`);
      return;
    }
    setBusy(true);
    try {
      const { connection } = await api<{ connection: { status: string } }>("/api/connections", { body: parsed });
      setInput("");
      await onConnected();
      toast(connection.status === "accepted" ? "You’re connected" : "Contact request sent");
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl bg-card p-5">
      <div className="flex items-start gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent"><Link2 /></div>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold">Invite friends</h2>
          <p className="mt-1 text-sm text-subdued">Send your link or let a friend scan the code. Opening it connects you in one tap.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" disabled={!url} onClick={() => void share()} className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-bold text-black disabled:opacity-50"><Share2 size={16} /> Share link</button>
            <button type="button" disabled={!url} onClick={() => void copy()} className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-2 text-sm font-semibold hover:bg-white/20 disabled:opacity-50"><Copy size={16} /> Copy</button>
            <button type="button" disabled={!url} onClick={() => setQr((v) => !v)} aria-pressed={qr} className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-2 text-sm font-semibold hover:bg-white/20 disabled:opacity-50"><QrCode size={16} /> QR code</button>
          </div>
          {qr && url && (
            <div className="mt-4 flex flex-col items-center gap-3 rounded-lg bg-black/30 p-4">
              <div className="rounded-lg bg-white p-2"><QRCodeSVG value={url} size={176} marginSize={1} title="Scan to connect on Pepper" /></div>
              <input aria-label="Your invite link" value={url} readOnly onFocus={(event) => event.target.select()} className="w-full rounded bg-white/10 px-3 py-2 text-center text-sm" />
              <button type="button" onClick={() => void rotate()} className="inline-flex items-center gap-1.5 text-xs text-subdued hover:text-white"><RefreshCw size={12} /> Replace link</button>
            </div>
          )}
        </div>
      </div>
      <form className="mt-4 flex gap-2 border-t border-white/10 pt-4" onSubmit={(event) => void connect(event)}>
        <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Paste a friend’s invite link" aria-label="Friend’s invite link or Pepper ID" className="h-11 min-w-0 flex-1 rounded bg-black/40 px-3 text-sm outline-none focus:ring-1 focus:ring-white/30" />
        <button disabled={busy || !input.trim()} className="flex h-11 shrink-0 items-center gap-2 rounded-full bg-white px-4 text-sm font-bold text-black disabled:opacity-50"><UserPlus size={17} /> Connect</button>
      </form>
      {uid && <p className="mt-3 text-xs text-muted">Pepper ID (for older invites): <code className="select-all">{uid}</code></p>}
    </section>
  );
}
