# Pepper — self-hosted music player

A mobile-first music player (Spotify-style UI from the Figma kit) with an admin upload panel, automatic metadata extraction, listening analytics and a hybrid recommender.

## Run it now (local mode, no accounts needed)

```bash
npm install
npm run dev
```

Open http://localhost:3000, enter a name and pick **Continue as admin**, then go to **Admin → Upload** and drop MP3/M4A/FLAC files (or a whole folder). Data lives in `./.data`; `npm run local:reset` wipes it. Tests: `npm test`.

## Go to production (Firebase + R2 + B2)

1. **Firebase**: create a project, enable *Authentication → Google* and *Email/Password*, create a *Firestore* database, and copy the web config + a service-account key into `.env.local` (see `.env.example`). Add your email to `ADMIN_EMAILS`. Deploy the rules and indexes with `firebase deploy --only firestore --project <your-project-id>` (the rules deny all direct client access; the index powers each listener's play history).
2. **Cloudflare R2** and/or **Backblaze B2**: create a private bucket plus an S3 API key, and fill in the `R2_*` / `B2_*` variables. More Backblaze buckets go in `B2_2_*`, `B2_3_*`, … (any number). Each upload goes to a bucket with room: `STORAGE_STRATEGY=fill-first` fills R2 first, then each B2 bucket in turn; `balance` picks the bucket with the most free space. Set each bucket's *Lifecycle Settings* to keep only the last version, so deleted songs free their space.
3. **Bucket CORS** (browsers upload directly to the buckets and stream from them): run `npm run setup:cors -- https://your-domain` once, and again after adding a bucket. If a provider rejects it, allow your origin for `GET, HEAD, PUT` with all headers in that bucket's CORS settings.
4. Deploy to Vercel (or any Node host) with the same environment variables. Add the domain to *Firebase Auth → Authorized domains*.

To keep Pepper to people you know, list their emails in `LISTENER_EMAILS` (or `@domain.com`); others who sign in see a "not on the guest list" page. Admin rights go to emails in `ADMIN_EMAILS` once verified (Google sign-in is verified automatically; email sign-ups get a verification link). To develop without touching production, run `firebase emulators:start --only auth,firestore --project demo-pepper` (the Firestore emulator needs Java 21) and set the emulator variables at the bottom of `.env.example`.

## Import a music collection

For a whole collection — one sub-folder per playlist — use the import command instead of the upload page. It runs on the computer that has the files and writes straight to the database and buckets from `.env.local`:

```bash
npm run import -- "/path/to/collection" --dry-run   # what would happen: copies found, space needed
npm run import -- "/path/to/collection"             # do it
```

- **Copies**: the same song in several folders is stored once and listed in every playlist. Copies are found by file hash, the YouTube Music link in the tags, audio fingerprints (`brew install chromaprint` for `fpcalc`) and title + artist + length. Different versions (remake, female version, reprise) stay separate songs.
- **Audio**: re-encoded to AAC 160 kbps (`--bitrate 192`, or `--keep-original`), analysed for tempo/energy like the upload page, covers resized, lyrics from LRCLIB, artist photos and similar artists from Deezer. Needs `ffmpeg` (macOS uses Apple's AAC encoder).
- **Playlists**: each folder becomes a shared playlist everyone sees (Home, Search), in the order of `MUSIC_CATALOG.md` if the folder has one, otherwise download order. `--no-playlists` skips them.
- **Database**: songs are saved 50 at a time, a few writes each (about 3,000 for 1,700 songs; Firestore's free tier allows 20,000 a day). Empty or unreadable files are listed in the report (`.data/imports/`).
- **Safe to repeat**: songs already in Pepper are skipped, so you can stop with Ctrl+C, run again later, or add `--limit 20` to try a few first.

Check how well autoplay continues from a single song on your library with `npm run eval:autoplay` (hides a quarter of each playlist and counts how many autoplay finds again).

## How it works

- **Upload**: the browser reads tags (music-metadata), cleans them (`src/lib/metadata/normalize.ts`: `/`-separated artists, `From "Film"` subtitles, site watermarks, label from TENC/©), resizes the embedded cover and extracts its colour, and analyses the audio (tempo, energy, brightness, rhythm). It then uploads via presigned URLs.
- **Recommendations** (`src/lib/recs`): session co-listens, content similarity, decayed taste, popularity and freshness, then MMR diversification. On a synthetic held-out test it reaches hit-rate@10 0.92 (popularity 0.28) — see `tests/recs.test.ts`.
- **Genre & language** (`src/lib/recs/genres.ts`, `src/lib/metadata/language.ts`): genre labels map to canonical genres with related families (Bollywood ~ Indian Pop ~ Punjabi), filled in from Apple's catalog when a file has none; language comes from the lyrics (script or common words), the tag, or the genre. Songs without tags borrow their artist's usual genre and language, and Deezer's related artists link similar artists. *Admin → Manage library → Fill them in* backfills older songs.
- **Shared playlists** (`src/lib/recs/similarity.ts`): songs people put in the same playlist count as similar — the signal Spotify learns from millions of user playlists. Each playlist counts by how focused it is (small, consistent lists more than big catch-alls), and playlists that share songs make their songs somewhat similar too.
- **Autoplay** (`src/lib/recs/autoplay.ts`): a song played from search plays on its own and autoplay queues similar songs right away; when an album or playlist ends, songs the listener let play seed the next ones (the starting album keeps it on course), early skips steer away from similar songs and re-plan what's coming, the session's language is kept, no artist plays twice in a row, only one version of a song plays per session, and tempo/energy change gradually. The next songs are fetched while the last one plays, so there is no gap. On a synthetic library it keeps the language 97.5% of the time (was 67.7%) — see `tests/autoplay.test.ts`.
- **Analytics**: each play is classified as complete, stream, skip or brief and aggregated with increment-only writes to fit Firestore's free tier. The admin dashboard shows plays, listeners, finish/skip rates, recommendation quality, the listening clock and storage.
