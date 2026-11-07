"use client";

import { create } from "zustand";
import type { PlayContext } from "./player/store";

interface UIState {
  trackMenu: { trackId: string; context?: PlayContext; playlistId?: string } | null;
  addToPlaylist: string[] | null;
  credits: string | null;
  profileOpen: boolean;
  openTrackMenu(trackId: string, context?: PlayContext, playlistId?: string): void;
  closeTrackMenu(): void;
  openAddToPlaylist(ids: string[]): void;
  closeAddToPlaylist(): void;
  openCredits(id: string | null): void;
  setProfileOpen(o: boolean): void;
}

export const useUI = create<UIState>((set) => ({
  trackMenu: null,
  addToPlaylist: null,
  credits: null,
  profileOpen: false,
  openTrackMenu: (trackId, context, playlistId) => set({ trackMenu: { trackId, context, playlistId } }),
  closeTrackMenu: () => set({ trackMenu: null }),
  openAddToPlaylist: (ids) => set({ addToPlaylist: ids, trackMenu: null }),
  closeAddToPlaylist: () => set({ addToPlaylist: null }),
  openCredits: (id) => set({ credits: id, trackMenu: null }),
  setProfileOpen: (o) => set({ profileOpen: o }),
}));
