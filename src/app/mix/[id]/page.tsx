"use client";

import { useParams } from "next/navigation";
import useSWR from "swr";
import { ActionBar, CollectionHeader, CollectionTopBar, EmptyState, PageSkeleton, TrackTable, useTracks } from "@/components/ui/collection";
import { MixArt } from "@/components/ui/media";
import { fetcher } from "@/lib/client/api";
import { useAuth } from "@/lib/client/auth";
import type { MixSummary } from "@/lib/types";
import { formatLongDuration } from "@/lib/util";

export default function MixPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { data: mix, error } = useSWR<MixSummary>(`/api/mixes/${id}`, fetcher, { revalidateOnFocus: false });
  const tracks = useTracks(mix?.trackIds);
  if (error) return <EmptyState title="This mix isn't available" body="Mixes refresh as you listen — head back home for today's mixes." />;
  if (!mix) return <PageSkeleton />;
  const ctx = { type: "mix" as const, id: mix.id, name: mix.title, href: `/mix/${mix.id}` };
  return (
    <div>
      <CollectionTopBar title={mix.title} color={mix.color} ctx={ctx} ids={mix.trackIds} />
      <CollectionHeader
        color={mix.color}
        kind="Playlist"
        title={mix.title}
        description={mix.description}
        art={<MixArt mix={mix} className="w-full" />}
        meta={
          <>
            <span className="font-bold">Made for {user?.name}</span>
            <span className="text-white/70">
              • {tracks.length} songs, {formatLongDuration(tracks.reduce((a, t) => a + t.durationMs, 0))}
            </span>
          </>
        }
      />
      <ActionBar ctx={ctx} ids={mix.trackIds} />
      <TrackTable tracks={tracks} ctx={ctx} />
    </div>
  );
}
