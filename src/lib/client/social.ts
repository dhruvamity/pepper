"use client";

import { useEffect, useState } from "react";
import type { JamRequest, ListeningActivity, UserProfile } from "@/lib/types";
import { getToken } from "./api";

export interface Contact {
  id: string;
  status: "pending" | "accepted" | "declined";
  requestedBy: string;
  user: Pick<UserProfile, "uid" | "name" | "photoURL">;
  activity: ListeningActivity | null;
}
export interface SocialResponse {
  connections: Contact[];
  jamRequests: JamRequest[];
}

/** Reads the NDJSON activity stream and keeps reconnecting until the signal aborts. */
async function watch(signal: AbortSignal, onActivities: (list: ListeningActivity[]) => void) {
  let delay = 500;
  while (!signal.aborted) {
    try {
      const token = await getToken();
      const res = await fetch("/api/listening-activity/events", { headers: token ? { Authorization: `Bearer ${token}` } : undefined, signal });
      if (signal.aborted) return;
      if (res.status === 401 || res.status === 403) return;
      if (!res.ok || !res.body) throw new Error("activity stream interrupted");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done || signal.aborted) break;
          pending += decoder.decode(value, { stream: true });
          const lines = pending.split("\n");
          pending = lines.pop() ?? "";
          for (const line of lines) {
            const event = JSON.parse(line) as { activities?: ListeningActivity[] };
            if (event.activities) {
              delay = 500;
              onActivities(event.activities);
            }
          }
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
    } catch {
      if (signal.aborted) return;
      delay = Math.min(delay * 2, 10_000);
    }
    if (!signal.aborted) await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

/**
 * While mounted, follows contacts' listening activity over the stream. Returns null until the
 * first event, then the live set (authoritative: a contact missing from it is not listening).
 */
export function useLiveActivity(enabled: boolean): Map<string, ListeningActivity> | null {
  const [live, setLive] = useState<Map<string, ListeningActivity> | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void watch(controller.signal, (activities) => setLive(new Map(activities.map((a) => [a.uid, a]))));
    return () => controller.abort();
  }, [enabled]);
  return live;
}
