"use client";

import { Link2, Plus, QrCode, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { useAuth } from "@/lib/client/auth";
import { useCatalog } from "@/lib/client/catalog";
import { connectSavedJam, enableJamAudio, jamPlaybackPosition, sendJamAction, setJamMode, setJamOpen, startListeningJam, useJam } from "@/lib/client/jam";
import type { Jam } from "@/lib/jam";
import { usePlayer } from "@/lib/client/player/store";
import { toast } from "@/lib/client/toast";
import { Cover } from "../ui/cover";
import { Sheet } from "../ui/sheet";
import { resumeJamAudio } from "./engine";

const button = "rounded-full bg-white px-5 py-2.5 text-sm font-bold text-black hover:bg-white/90 disabled:opacity-50";
const secondary = "inline-flex items-center gap-2 rounded-full border border-white/30 px-4 py-2 text-sm font-bold hover:border-white";

export function JamPanel() {
  const { user } = useAuth();
  const uid = user?.uid;
  const open = useJam((s) => s.open);
  const room = useJam((s) => s.room);
  const syncProgress = useJam((s) => Boolean(s.room?.playback.playing && (s.mode === "in-person" || s.blocked)));
  useEffect(() => uid ? connectSavedJam(uid) : undefined, [uid]);
  useEffect(() => {
    if (!syncProgress) return;
    const timer = setInterval(() => {
      const time = jamPlaybackPosition();
      if (time !== null) usePlayer.getState().setProgress(time);
    }, 500);
    return () => clearInterval(timer);
  }, [syncProgress]);
  if (!open) return null;

  return (
    <Sheet open onClose={() => setJamOpen(false)} label="Jam">
      <div className="space-y-5 p-5">
        <h2 className="flex items-center gap-2 text-xl font-bold"><Users size={22} className="text-accent" /> {room ? "Your Jam" : "Jam"}</h2>
        {room ? <ActiveJam room={room} /> : <StartJam />}
      </div>
    </Sheet>
  );
}

function StartJam() {
  const [invite, setInvite] = useState("");
  const [busy, setBusy] = useState(false);
  const connection = useJam((s) => s.connection);
  const router = useRouter();
  return (
    <>
      <p className="text-sm text-subdued">Listen together, control playback and build a shared queue.</p>
      {connection === "reconnecting" && <p className="text-sm text-subdued" role="status">Reconnecting to your Jam…</p>}
      <button type="button" className={button} disabled={busy} onClick={async () => {
        setBusy(true);
        try {
          await startListeningJam();
        } catch (error) {
          toast((error as Error).message, "error");
        } finally {
          setBusy(false);
        }
      }}>Start a Jam</button>
      <form className="space-y-2 border-t border-white/10 pt-4" onSubmit={(event) => {
        event.preventDefault();
        const code = invite.trim().match(/^(?:https?:\/\/[^/]+\/jam\/)?([a-f0-9]{24})(?:[/?#].*)?$/i)?.[1];
        if (!code) return toast("Enter a Pepper Jam invite link or code", "error");
        setJamOpen(false);
        router.push(`/jam/${code.toLowerCase()}`);
      }}>
        <label htmlFor="jam-invite" className="block text-sm font-semibold">Have an invite?</label>
        <div className="flex gap-2">
          <input id="jam-invite" autoComplete="off" value={invite} onChange={(event) => setInvite(event.target.value)} placeholder="Invite link or code" className="min-w-0 flex-1 rounded-md bg-white/10 px-3 py-2 text-base" />
          <button type="submit" className={secondary}>Open</button>
        </div>
      </form>
    </>
  );
}

function ActiveJam({ room }: { room: Jam }) {
  const uid = useJam((s) => s.uid);
  const blocked = useJam((s) => s.blocked);
  const mode = useJam((s) => s.mode);
  const connection = useJam((s) => s.connection);
  const { catalog } = useCatalog();
  const [qr, setQR] = useState(false);
  const [suggest, setSuggest] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const host = uid === room.hostUid;
  const invite = new URL(`/jam/${room.id}`, window.location.origin).href;
  const current = room.playback.track && catalog?.byId.get(room.playback.track.id);
  const { data, error, isLoading, mutate } = useSWR<{ tracks: { id: string; likedBy: number }[] }>(
    suggest ? `/api/jams/${room.id}/recommendations` : null,
    { revalidateOnFocus: false },
  );

  return (
    <>
      {connection !== "live" && <p role="status" className="text-sm text-subdued">{connection === "connecting" ? "Connecting…" : "Reconnecting…"}</p>}
      {current && (
        <div className="flex items-center gap-3 rounded-lg bg-white/5 p-3">
          <Cover image={current.cover} className="h-12 w-12 shrink-0" />
          <div className="min-w-0">
            <p className="truncate font-semibold">{current.title}</p>
            <p className="text-xs text-subdued">{room.playback.playing ? "Playing" : "Paused"}</p>
          </div>
        </div>
      )}
      {blocked && mode === "remote" && (
        <button type="button" className={button} onClick={() => {
          enableJamAudio();
          resumeJamAudio();
        }}>Enable audio on this device</button>
      )}
      {!host && (
        <label className="flex items-center justify-between gap-3 text-sm">
          Listen on
          <select value={mode} onChange={(event) => {
            setJamMode(event.target.value === "remote" ? "remote" : "in-person");
            resumeJamAudio();
          }} className="rounded bg-surface px-3 py-2">
            <option value="remote">This device</option>
            <option value="in-person">Host’s speaker</option>
          </select>
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={secondary} onClick={async () => {
          try {
            if (navigator.share) await navigator.share({ title: "Join my Pepper Jam", url: invite });
            else {
              await navigator.clipboard.writeText(invite);
              toast("Jam invite copied");
            }
          } catch (error) {
            if ((error as Error).name !== "AbortError") setQR(true);
          }
        }}><Link2 size={16} /> Share invite</button>
        <button type="button" className={secondary} aria-expanded={qr} onClick={() => setQR(!qr)}><QrCode size={16} /> QR code</button>
        <button type="button" className={secondary} onClick={() => {
          setJamOpen(false);
          usePlayer.getState().setView("queue");
        }}>Open shared queue</button>
      </div>
      {qr && (
        <div className="flex flex-col items-center gap-3">
          <QRCodeSVG value={invite} size={176} marginSize={3} title="Scan to join this Jam" />
          <input aria-label="Jam invite link" value={invite} readOnly onFocus={(event) => event.target.select()} className="w-full rounded bg-white/10 px-3 py-2 text-sm" />
        </div>
      )}
      <div className="space-y-2 border-t border-white/10 pt-4">
        <h3 className="font-bold">Participants ({room.members.length})</h3>
        <ul className="space-y-2">
          {room.members.map((member) => (
            <li key={member.uid} className="flex items-center justify-between gap-3 text-sm">
              <span className="truncate">{member.name}{member.uid === uid && " (you)"}{member.uid === room.hostUid && " · Host"}</span>
              {host && member.uid !== uid && <button type="button" aria-label={`Remove ${member.name}`} className="shrink-0 p-1 text-subdued hover:text-white" onClick={() => void sendJamAction({ type: "remove", uid: member.uid })}>Remove</button>}
            </li>
          ))}
        </ul>
      </div>
      {!host && !room.guestsControlPlayback && <p className="text-sm text-subdued">The host controls playback. You can still add songs.</p>}
      {host && (
        <div className="space-y-3 border-t border-white/10 pt-4">
          <label className="flex items-center justify-between gap-3 text-sm">
            Let guests change playback
            <input type="checkbox" checked={room.guestsControlPlayback} className="h-4 w-4 accent-[#1ed760]" onChange={(event) => void sendJamAction({ type: "permissions", playback: event.target.checked })} />
          </label>
          <label className="flex items-center justify-between gap-3 text-sm">
            Let guests change speaker volume
            <input type="checkbox" checked={room.guestsControlVolume} className="h-4 w-4 accent-[#1ed760]" onChange={(event) => void sendJamAction({ type: "permissions", volume: event.target.checked })} />
          </label>
        </div>
      )}
      {(host || room.guestsControlVolume) && <SharedVolume volume={room.volume} />}
      <div className="space-y-3 border-t border-white/10 pt-4">
        <button type="button" className={secondary} onClick={() => setSuggest(!suggest)} aria-expanded={suggest}>Group recommendations</button>
        {isLoading && <p className="text-sm text-subdued">Finding songs for the group…</p>}
        {suggest && error && <button type="button" className="block text-sm text-subdued hover:text-white" onClick={() => void mutate()}>Couldn’t load suggestions. Try again.</button>}
        {suggest && data && !data.tracks.length && <p className="text-sm text-subdued">No suggestions for this queue yet.</p>}
        {suggest && data?.tracks.map(({ id, likedBy }) => {
          const track = catalog?.byId.get(id);
          if (!track) return null;
          const queued = room.queue.some((song) => song.id === id);
          return (
            <div key={id} className="flex items-center gap-3">
              <Cover image={track.cover} className="h-9 w-9 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{track.title}</p>
                <p className="truncate text-xs text-subdued">{likedBy ? `Liked by ${likedBy} in this Jam` : track.artists.map((artist) => artist.name).join(", ")}</p>
              </div>
              <button type="button" disabled={queued} aria-label={`Add ${track.title} to the Jam queue`} className="p-2 text-subdued hover:text-white disabled:opacity-40" onClick={() => void sendJamAction({ type: "add", ids: [id] })}><Plus size={18} /></button>
            </div>
          );
        })}
      </div>
      <button type="button" disabled={leaving} className="rounded-full border border-white/30 px-4 py-2 text-sm font-bold text-danger hover:border-white" onClick={async () => {
        setLeaving(true);
        await sendJamAction({ type: "leave" });
        setLeaving(false);
      }}>{host ? "End Jam for everyone" : "Leave Jam"}</button>
    </>
  );
}

function SharedVolume({ volume }: { volume: number }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (input.current) input.current.valueAsNumber = volume;
  }, [volume]);
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      Host speaker volume
      <input
        ref={input} type="range" min={0} max={1} step={0.01} defaultValue={volume}
        onPointerUp={(event) => void sendJamAction({ type: "volume", volume: event.currentTarget.valueAsNumber })}
        onKeyUp={(event) => {
          if (event.key.startsWith("Arrow") || event.key === "Home" || event.key === "End") void sendJamAction({ type: "volume", volume: event.currentTarget.valueAsNumber });
        }}
        className="w-32 accent-[#1ed760]"
      />
    </label>
  );
}
