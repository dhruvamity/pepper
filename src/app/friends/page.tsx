"use client";

import { Check, Copy, Music2, UserPlus, Users, X } from "lucide-react";
import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { TopBar } from "@/components/nav/top-bar";
import { Cover } from "@/components/ui/cover";
import { api, fetcher } from "@/lib/client/api";
import { joinListeningJam, respondToJamRequest, requestListeningJam } from "@/lib/client/jam";
import { useMe } from "@/lib/client/me";
import { toast } from "@/lib/client/toast";
import { useCatalog } from "@/lib/client/catalog";
import type { JamRequest, ListeningActivity, UserProfile } from "@/lib/types";

interface Contact {
  id: string;
  status: "pending" | "accepted" | "declined";
  requestedBy: string;
  user: Pick<UserProfile, "uid" | "name" | "photoURL">;
  activity: ListeningActivity | null;
}
interface SocialResponse { connections: Contact[]; jamRequests: JamRequest[] }

export default function FriendsPage() {
  const { data: me, mutate: mutateMe } = useMe();
  const { data: social, mutate: refreshSocial } = useSWR<SocialResponse>("/api/connections", fetcher, { refreshInterval: 15_000 });
  const { catalog } = useCatalog();
  const { mutate } = useSWRConfig();
  const [pepperId, setPepperId] = useState("");
  const [busy, setBusy] = useState(false);
  const sharing = Boolean(me?.user.activitySharing);
  const visibleTo = me?.user.activityVisibleTo ?? [];

  const accepted = (social?.connections ?? []).filter((contact) => contact.status === "accepted");
  const incoming = (social?.connections ?? []).filter((contact) => contact.status === "pending" && contact.requestedBy !== me?.user.uid);
  const outgoing = (social?.connections ?? []).filter((contact) => contact.status === "pending" && contact.requestedBy === me?.user.uid);
  const incomingJam = (social?.jamRequests ?? []).filter((request) => request.toUid === me?.user.uid && request.status === "pending");
  const outgoingJam = (social?.jamRequests ?? []).filter((request) => request.fromUid === me?.user.uid && request.status === "pending");
  const acceptedJam = (social?.jamRequests ?? []).filter((request) => request.fromUid === me?.user.uid && request.status === "accepted" && request.jamId);

  async function changeConnection(userId: string, action: "accept" | "decline" | "remove") {
    try {
      if (action === "remove") await api("/api/connections", { method: "DELETE", body: { userId } });
      else await api("/api/connections", { method: "PATCH", body: { userId, action } });
      await Promise.all([refreshSocial(), mutate("/api/me")]);
    } catch (error) { toast((error as Error).message, "error"); }
  }

  async function savePrivacy(nextSharing: boolean, nextVisible: string[]) {
    try {
      await api("/api/me/privacy", { method: "PATCH", body: { activitySharing: nextSharing, activityVisibleTo: nextVisible } });
      await mutateMe();
      toast("Listening activity privacy saved");
    } catch (error) {
      toast((error as Error).message, "error");
      await mutateMe();
    }
  }

  return (
    <div className="pb-8">
      <TopBar title="Friends & Jams" showBack={false} />
      <div className="mx-auto max-w-3xl space-y-8 px-4 py-6 sm:px-6">
        <section className="rounded-xl bg-card p-5">
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent"><Users /></div>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold">Your Pepper ID</h2>
              <p className="mt-1 text-sm text-subdued">Share this ID with a friend so they can send you a contact request.</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <code className="max-w-full break-all rounded bg-black/40 px-3 py-2 text-sm">{me?.user.uid ?? "Loading…"}</code>
                <button type="button" disabled={!me} className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-2 text-sm font-semibold hover:bg-white/20 disabled:opacity-50" onClick={async () => {
                  if (!me) return;
                  try { await navigator.clipboard.writeText(me.user.uid); toast("Pepper ID copied"); }
                  catch { toast("Could not copy Pepper ID", "error"); }
                }}><Copy size={16} /> Copy</button>
              </div>
              <form className="mt-4 flex gap-2" onSubmit={async (event) => {
                event.preventDefault();
                setBusy(true);
                try {
                  const { connection } = await api<{ connection: { status: string } }>("/api/connections", { body: { userId: pepperId.trim() } });
                  setPepperId(""); await refreshSocial();
                  toast(connection.status === "accepted" ? "You’re connected" : "Contact request sent");
                }
                catch (error) { toast((error as Error).message, "error"); }
                finally { setBusy(false); }
              }}>
                <input value={pepperId} onChange={(event) => setPepperId(event.target.value)} placeholder="Enter a friend’s Pepper ID" className="h-11 min-w-0 flex-1 rounded bg-black/40 px-3 text-sm outline-none focus:ring-1 focus:ring-white/30" />
                <button disabled={busy || !pepperId.trim()} className="flex h-11 items-center gap-2 rounded-full bg-white px-4 text-sm font-bold text-black disabled:opacity-50"><UserPlus size={17} /> Connect</button>
              </form>
            </div>
          </div>
        </section>

        <section className="rounded-xl bg-card p-5">
          <div className="flex items-start justify-between gap-4">
            <div><h2 className="text-lg font-bold">Listening activity</h2><p className="mt-1 text-sm text-subdued">Activity is private by default and only visible to the contacts you select.</p></div>
            <label className="flex shrink-0 items-center gap-2 text-sm font-semibold"><span className="sr-only">Share listening activity</span><input aria-label="Share listening activity" type="checkbox" checked={sharing} onChange={(event) => void savePrivacy(event.target.checked, visibleTo)} className="h-5 w-5 accent-[#1ed760]" /> Share</label>
          </div>
          {sharing && <div className="mt-4 space-y-2 border-t border-white/10 pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-subdued">Visible to</p>
            {accepted.length ? accepted.map((contact) => <label key={contact.user.uid} className="flex items-center gap-3 rounded bg-black/20 px-3 py-2 text-sm">
              <input type="checkbox" checked={visibleTo.includes(contact.user.uid)} onChange={(event) => {
                const next = event.target.checked ? [...visibleTo, contact.user.uid] : visibleTo.filter((uid) => uid !== contact.user.uid);
                void savePrivacy(true, next);
              }} className="h-4 w-4 accent-[#1ed760]" /> {contact.user.name}
            </label>) : <p className="text-sm text-subdued">Accept a contact request to choose who can see your activity.</p>}
          </div>}
        </section>

        {(incoming.length > 0 || outgoing.length > 0) && <section className="space-y-3">
          <h2 className="text-lg font-bold">Contact requests</h2>
          {incoming.map((contact) => <div key={contact.id} className="flex items-center gap-3 rounded-lg bg-card p-4"><div className="min-w-0 flex-1"><p className="font-semibold">{contact.user.name}</p><p className="text-xs text-subdued">Wants to connect</p></div><button aria-label={`Accept ${contact.user.name}`} className="rounded-full bg-accent p-2 text-black" onClick={() => void changeConnection(contact.user.uid, "accept")}><Check size={18} /></button><button aria-label={`Decline ${contact.user.name}`} className="rounded-full bg-white/10 p-2 text-white" onClick={() => void changeConnection(contact.user.uid, "decline")}><X size={18} /></button></div>)}
          {outgoing.map((contact) => <div key={contact.id} className="rounded-lg bg-card p-4 text-sm text-subdued">Request sent to <span className="text-white">{contact.user.name}</span></div>)}
        </section>}

        <section className="space-y-3">
          <h2 className="text-lg font-bold">Your contacts <span className="text-sm font-normal text-subdued">{accepted.length}</span></h2>
          {accepted.length ? accepted.map((contact) => {
            const activity = contact.activity;
            const track = activity ? catalog?.byId.get(activity.trackId) : undefined;
            const canRequest = !outgoingJam.some((request) => request.toUid === contact.user.uid) && !acceptedJam.some((request) => request.toUid === contact.user.uid);
            return <div key={contact.user.uid} className="flex items-center gap-3 rounded-lg bg-card p-3 sm:p-4">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{contact.user.name}</p>
                {activity && <div className="mt-2 flex items-center gap-2 text-sm text-subdued">
                  <Cover image={track?.cover} className="h-9 w-9 shrink-0 rounded" />
                  <span className="min-w-0 truncate"><span className="text-accent">{activity.playing ? "Listening to" : "Paused"}</span> {track?.title ?? "a song"}{track ? ` · ${track.artists.map((artist) => artist.name).join(", ")}` : ""}</span>
                </div>}
              </div>
              <button type="button" disabled={!canRequest} className="shrink-0 rounded-full bg-white px-3 py-2 text-xs font-bold text-black disabled:opacity-50" onClick={async () => {
                try { await requestListeningJam(contact.user.uid); await refreshSocial(); toast(`Jam request sent to ${contact.user.name}`); }
                catch (error) { toast((error as Error).message, "error"); }
              }}>Request Jam</button>
              <button type="button" aria-label={`Remove ${contact.user.name}`} className="rounded-full p-2 text-subdued hover:text-white" onClick={() => void changeConnection(contact.user.uid, "remove")}><X size={18} /></button>
            </div>;
          }) : <div className="rounded-lg bg-card p-5 text-sm text-subdued">No contacts yet. Share your Pepper ID to get started.</div>}
        </section>

        {(incomingJam.length > 0 || outgoingJam.length > 0 || acceptedJam.length > 0) && <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-bold"><Music2 size={20} /> Jam requests</h2>
          {incomingJam.map((request) => <div key={request.id} className="flex items-center gap-3 rounded-lg bg-card p-4"><div className="min-w-0 flex-1"><p className="font-semibold">{request.fromName} invited you to Jam</p><p className="text-xs text-subdued">This request expires in 30 minutes.</p></div><button className="rounded-full bg-accent px-4 py-2 text-sm font-bold text-black" onClick={async () => {
            try { await respondToJamRequest(request.id, "accept"); await refreshSocial(); }
            catch (error) { toast((error as Error).message, "error"); }
          }}>Accept</button><button className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold" onClick={async () => {
            try { await respondToJamRequest(request.id, "decline"); await refreshSocial(); }
            catch (error) { toast((error as Error).message, "error"); }
          }}>Decline</button></div>)}
          {outgoingJam.map((request) => <div key={request.id} className="rounded-lg bg-card p-4 text-sm text-subdued">Jam request sent. Waiting for a response.</div>)}
          {acceptedJam.map((request) => <div key={request.id} className="flex items-center gap-3 rounded-lg bg-card p-4"><p className="min-w-0 flex-1 text-sm"><span className="font-semibold text-white">{accepted.find((contact) => contact.user.uid === request.toUid)?.user.name ?? "Your contact"}</span> accepted your Jam request.</p><button className="rounded-full bg-accent px-4 py-2 text-sm font-bold text-black" onClick={() => void joinListeningJam(request.jamId!, "remote").catch((error: Error) => toast(error.message, "error"))}>Join Jam</button></div>)}
        </section>}
      </div>
    </div>
  );
}
