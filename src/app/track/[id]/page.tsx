import type { Metadata } from "next";
import { trackPreview } from "@/lib/server/share";
import { TrackView } from "./view";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return trackPreview((await params).id);
}

export default function TrackPage() {
  return <TrackView />;
}
