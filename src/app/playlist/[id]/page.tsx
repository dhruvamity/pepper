import type { Metadata } from "next";
import { playlistPreview } from "@/lib/server/share";
import { PlaylistView } from "./view";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return playlistPreview((await params).id);
}

export default function PlaylistPage() {
  return <PlaylistView />;
}
