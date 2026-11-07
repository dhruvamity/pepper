import { requireUser } from "@/lib/server/auth";
import { repo } from "@/lib/server/db";
import { HttpError, json, route } from "@/lib/server/http";

/** Full track details (credits, format, lyrics) for the song page and "Show credits". */
export const GET = route<{ params: Promise<{ id: string }> }>(async (req, ctx) => {
  await requireUser(req);
  const { id } = await ctx.params;
  const db = await repo();
  const [track, lyrics] = await Promise.all([db.getTrack(id), db.getLyrics(id)]);
  if (!track) throw new HttpError(404, "Track not found");
  const { audio, uploadedBy: _uploadedBy, ...rest } = track;
  void _uploadedBy;
  return json({
    track: {
      ...rest,
      format: {
        codec: audio.codec,
        container: audio.container,
        bitrate: audio.bitrate,
        sampleRate: audio.sampleRate,
        channels: audio.channels,
        lossless: audio.lossless,
        size: audio.size,
        provider: audio.provider,
      },
    },
    lyrics,
  });
});
