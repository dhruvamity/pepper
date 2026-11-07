"use client";

import { api } from "../api";
import { toast } from "../toast";
import { usePlayer } from "./store";

/** Start "song radio": the seed followed by recommendations that fit it. */
export async function startRadio(seedId: string, title: string) {
  try {
    const { items } = await api<{ items: { id: string }[] }>(`/api/radio?mode=radio&limit=40&seeds=${seedId}`);
    usePlayer.getState().playList([seedId, ...items.map((i) => i.id)], 0, { type: "radio", id: seedId, name: `${title} Radio`, href: `/track/${seedId}` }, { shuffle: false });
    usePlayer.setState({ shuffle: false });
  } catch (e) {
    toast((e as Error).message, "error");
  }
}

export async function shareLink(path: string, title: string) {
  const url = new URL(path, location.origin).href;
  try {
    if (navigator.share) await navigator.share({ title, url });
    else {
      await navigator.clipboard.writeText(url);
      toast("Link copied to clipboard");
    }
  } catch {
    /* user cancelled */
  }
}
