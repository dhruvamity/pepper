"use client";

import { Check, UserPlus } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { TopBar } from "@/components/nav/top-bar";
import { api, fetcher } from "@/lib/client/api";
import { toast } from "@/lib/client/toast";

interface Invite {
  user: { uid: string; name: string; photoURL?: string };
  self: boolean;
  status: "pending" | "accepted" | "declined" | null;
  requestedBy: string | null;
}

/** Landing page for an invite link or QR code: one tap to send (or accept) a contact request. */
export default function AddContactPage() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const { data, error, isLoading, mutate: refresh } = useSWR<Invite>(`/api/invites/${encodeURIComponent(code)}`, fetcher, { shouldRetryOnError: false });
  const [busy, setBusy] = useState(false);
  const connect = async () => {
    setBusy(true);
    try {
      const { connection } = await api<{ connection: { status: string } }>("/api/connections", { body: { inviteCode: code } });
      await Promise.all([refresh(), mutate("/api/connections")]);
      toast(connection.status === "accepted" ? `You’re connected with ${data?.user.name}` : `Contact request sent to ${data?.user.name}`);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  const initial = (data?.user.name ?? "?").trim().charAt(0).toUpperCase();
  return (
    <>
      <TopBar />
      <div className="mx-auto max-w-md space-y-5 px-5 py-8 text-center">
        {isLoading && <p className="text-subdued">Loading invite…</p>}
        {error && (
          <>
            <h1 className="text-2xl font-bold">This invite link doesn’t work</h1>
            <p role="alert" className="text-sm text-subdued">{(error as Error).message}</p>
            <Link href="/friends" className="inline-block rounded-full bg-white px-6 py-2.5 text-sm font-bold text-black">Go to Friends</Link>
          </>
        )}
        {data && (
          <>
            {data.user.photoURL ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={data.user.photoURL} alt="" referrerPolicy="no-referrer" className="mx-auto h-24 w-24 rounded-full object-cover" />
            ) : (
              <span className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-[#ff7d4d] text-4xl font-bold text-black">{initial}</span>
            )}
            <h1 className="text-3xl font-bold">{data.self ? "This is your invite link" : data.user.name}</h1>
            {data.self ? (
              <p className="text-sm text-subdued">Share it with friends so they can connect with you on Pepper.</p>
            ) : data.status === "accepted" ? (
              <p className="flex items-center justify-center gap-2 text-sm text-accent"><Check size={18} /> You’re already connected</p>
            ) : data.status === "pending" && data.requestedBy !== data.user.uid ? (
              <p className="text-sm text-subdued">Contact request sent. {data.user.name} can accept it from their Friends page.</p>
            ) : (
              <>
                <p className="text-sm text-subdued">{data.status === "pending" ? `${data.user.name} already sent you a request. Connecting accepts it.` : "Connect to Jam together, share listening activity and edit playlists as a team."}</p>
                <button type="button" disabled={busy} onClick={() => void connect()} className="mx-auto flex items-center gap-2 rounded-full bg-accent px-6 py-3 font-bold text-black disabled:opacity-50">
                  <UserPlus size={18} /> {data.status === "pending" ? "Accept and connect" : `Connect with ${data.user.name}`}
                </button>
              </>
            )}
            <button type="button" className="block w-full py-2 text-sm text-subdued hover:text-white" onClick={() => router.push("/friends")}>Open Friends &amp; Jams</button>
          </>
        )}
      </div>
    </>
  );
}
