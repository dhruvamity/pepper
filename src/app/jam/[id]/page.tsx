"use client";

import { Headphones, Speaker, Users } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";
import { TopBar } from "@/components/nav/top-bar";
import { joinListeningJam, setJamOpen, useJam } from "@/lib/client/jam";

export default function JamInvitePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const room = useJam((s) => s.room);
  const { data, error, isLoading } = useSWR<{ host: string; count: number }>(`/api/jams/${id}`, { shouldRetryOnError: false });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const join = async (mode: "remote" | "in-person") => {
    setBusy(true);
    setMessage("");
    try {
      await joinListeningJam(id, mode);
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <TopBar />
      <div className="mx-auto max-w-md space-y-5 px-5 py-8 text-center">
        <Users size={40} className="mx-auto text-accent" />
        <h1 className="text-3xl font-bold">{room?.id === id ? "You’re in this Jam" : data ? `Join ${data.host}’s Jam` : "Pepper Jam"}</h1>
        {room?.id === id ? (
          <>
            <button type="button" className="rounded-full bg-white px-5 py-2.5 text-sm font-bold text-black" onClick={() => setJamOpen(true)}>Open Jam</button>
            <button type="button" className="block w-full py-2 text-sm text-subdued hover:text-white" onClick={() => router.push("/")}>Back to Home</button>
          </>
        ) : error ? <p role="alert" className="text-sm text-subdued">{(error as Error).message}</p> : (
          <>
            {isLoading && <p className="text-subdued">Loading invite…</p>}
            {data && (
              <>
                <p className="text-sm text-subdued">{data.count} listening. Join to control playback and add songs.</p>
                <button type="button" disabled={busy} onClick={() => void join("remote")} className="flex w-full items-center justify-center gap-2 rounded-full bg-accent px-5 py-3 font-bold text-black disabled:opacity-50"><Headphones size={18} /> Listen on this device</button>
                <button type="button" disabled={busy} onClick={() => void join("in-person")} className="flex w-full items-center justify-center gap-2 rounded-full border border-white/40 px-5 py-3 font-bold disabled:opacity-50"><Speaker size={18} /> Join in person</button>
              </>
            )}
            {message && <p role="alert" className="text-sm text-danger">{message}</p>}
          </>
        )}
      </div>
    </>
  );
}
