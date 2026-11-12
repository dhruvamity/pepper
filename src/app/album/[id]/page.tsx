import type { Metadata } from "next";
import { albumPreview } from "@/lib/server/share";
import { AlbumView } from "./view";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return albumPreview((await params).id);
}

export default function AlbumPage() {
  return <AlbumView />;
}
