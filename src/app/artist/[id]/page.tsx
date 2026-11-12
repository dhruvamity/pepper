import type { Metadata } from "next";
import { artistPreview } from "@/lib/server/share";
import { ArtistView } from "./view";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return artistPreview((await params).id);
}

export default function ArtistPage() {
  return <ArtistView />;
}
