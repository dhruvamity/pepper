import { expect, test, type Page } from "@playwright/test";
import { api, authenticate, jamSnapshot, login, navigate, origin, playing, seed, tone, uploadSong } from "./fixtures";

let data: Awaited<ReturnType<typeof seed>>;
test.beforeAll(async () => { data = await seed(); });

async function libraryPlaylist(page: Page, id: string) {
  await navigate(page, "/library");
  await navigate(page, `/playlist/${id}`);
}

async function ensureChecked(page: Page, name: string) {
  const checkbox = page.getByRole("checkbox", { name });
  if (!await checkbox.isChecked()) await checkbox.click();
  await expect(checkbox).toBeChecked();
}

for (const mobile of [false, true]) {
  test(`${mobile ? "mobile" : "desktop"}: playlist switching, loading, seek, pause, queue and reload`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 720 }, isMobile: mobile, hasTouch: mobile });
    await authenticate(context, data.listener);
    const page = await context.newPage();
    const errors: string[] = []; page.on("pageerror", (err) => errors.push(err.message));
    try {
      await page.goto(origin + `/playlist/${data.a.id}`);
      await page.getByRole("button", { name: `Play ${data.a.name}`, exact: true }).first().click();
      await playing(page, data.ids[0]);
      await page.getByRole("button", { name: "Pause", exact: true }).first().click();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      await page.route(`**/api/tracks/${data.ids[2]}/stream`, async (route) => { await gate; await route.continue(); });
      await libraryPlaylist(page, data.b.id);
      await page.getByRole("button", { name: `Play ${data.b.name}`, exact: true }).first().click();
      await expect(page).toHaveTitle(/E2E Song Three/);
      // Check the actual audio element: a changed title alone previously hid the bug.
      await expect.poll(() => page.evaluate(() => window.testAudio[0].paused && !window.testAudio[0].getAttribute("src"))).toBe(true);
      release();
      await playing(page, data.ids[2]);
      if (mobile) await page.getByRole("button", { name: /Now playing:.*Open player/ }).click();
      await page.getByRole("button", { name: "Pause", exact: true }).first().click();
      const seek = mobile
        ? page.getByRole("dialog", { name: "Now playing" }).getByRole("slider", { name: "Seek", exact: true })
        : page.getByRole("slider", { name: "Seek", exact: true }).first();
      await seek.focus();
      for (let i = 0; i < 40; i++) await seek.press("ArrowRight");
      await expect.poll(() => page.evaluate(() => window.testAudio[0].currentTime)).toBeGreaterThan(8.5);
      const player = mobile ? page.getByRole("dialog", { name: "Now playing" }) : page;
      await player.getByRole("button", { name: "Play", exact: true }).first().click();
      await playing(page, data.ids[2]);
      if (mobile) await page.getByRole("button", { name: "Close now playing" }).click();
      await navigate(page, "/"); await navigate(page, `/playlist/${data.curated.id}`);
      await page.getByRole("button", { name: "Play E2E Curated", exact: true }).first().click();
      await playing(page, data.ids[0]);
      if (mobile) await page.getByRole("button", { name: /Now playing:.*Open player/ }).click();
      await page.getByRole("button", { name: "Queue", exact: true }).first().click();
      const from = page.getByRole("button", { name: "Reorder E2E Song Four" });
      const to = page.getByRole("button", { name: "Reorder E2E Song Two" });
      await from.waitFor(); await page.waitForTimeout(350);
      const a = (await from.boundingBox())!, b = (await to.boundingBox())!;
      if (mobile) {
        const cdp = await context.newCDPSession(page);
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: a.x + a.width / 2, y: a.y + a.height / 2 }] });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }] });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      } else { await from.dragTo(to); }
      await expect(page.getByRole("button", { name: /^Reorder / }).first()).toHaveAttribute("aria-label", "Reorder E2E Song Four");
      await page.getByRole("button", { name: "Skip E2E Song Two in queue" }).click();
      await expect(page.getByRole("button", { name: "Reorder E2E Song Two" })).toHaveCount(0);
      await page.getByRole("button", { name: "Skip to next song" }).click();
      await playing(page, data.ids[3]);
      await page.reload();
      await expect(page).toHaveTitle(/E2E Song Four/);
      await expect.poll(() => page.evaluate(() => window.testAudio[0].paused)).toBe(true);
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  });
}

test("failed and stale stream/radio/autoplay responses never resume the old playlist", async ({ context, page }) => {
  await authenticate(context, data.listener);
  await page.goto(`/playlist/${data.a.id}`);
  await page.getByRole("button", { name: `Play ${data.a.name}`, exact: true }).first().click();
  await playing(page, data.ids[0]);
  await page.route(`**/api/tracks/${data.ids[2]}/stream`, (route) => route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"Test unavailable"}' }));
  await libraryPlaylist(page, data.b.id);
  await page.getByRole("button", { name: `Play ${data.b.name}`, exact: true }).first().click();
  await expect(page.getByText(/Can't stream this song/)).toBeVisible();
  expect(await page.evaluate(() => window.testAudio[0].paused)).toBe(true);
  await page.unroute(`**/api/tracks/${data.ids[2]}/stream`);
  await page.getByRole("button", { name: `Play ${data.b.name}`, exact: true }).first().click();
  await playing(page, data.ids[2]);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/radio?**", async (route) => { await gate; await route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"Delayed failure"}' }); });
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await playing(page, data.ids[3]);
  const pending = page.waitForRequest((req) => req.url().includes("mode=autoplay"));
  await page.getByRole("button", { name: "Next", exact: true }).click(); await pending;
  await libraryPlaylist(page, data.a.id);
  await page.getByRole("button", { name: `Play ${data.a.name}`, exact: true }).first().click();
  await playing(page, data.ids[0]);
  release(); await page.waitForTimeout(400);
  await playing(page, data.ids[0]);
});

test("catalog sharing, playlist CRUD/concurrent changes, library, authorization and signed audio", async () => {
  const { admin, listener, ids } = data;
  await api("/api/catalog", undefined, undefined, "GET", 401);
  for (const path of ["/api/admin/analytics", "/api/admin/storage", `/api/admin/tracks/${ids[0]}`]) await api(path, listener, undefined, "GET", 403);
  const catalog = await api("/api/catalog", listener);
  expect(catalog.playlists.some((p: { id: string }) => p.id === data.curated.id)).toBe(true);
  expect(catalog.playlists.some((p: { id: string }) => p.id === data.a.id)).toBe(false);
  const traversal = await fetch(`${origin}/api/media/r2/img/%252e%252e/audio/${ids[0]}.wav`);
  expect(traversal.status).toBe(404);
  const p = await data.list("E2E CRUD", [], listener);
  await Promise.all(ids.map((id) => api(`/api/playlists/${p.id}`, listener, { add: [id, id] }, "PATCH")));
  expect((await api(`/api/playlists/${p.id}`, listener)).playlist.trackIds.sort()).toEqual([...ids].sort());
  await api(`/api/playlists/${p.id}`, listener, { name: "Renamed", remove: [ids[0]] }, "PATCH");
  expect((await api(`/api/playlists/${p.id}`, listener)).playlist).toMatchObject({ name: "Renamed", trackIds: expect.not.arrayContaining([ids[0]]) });
  const full = await data.list("E2E Full", Array.from({ length: 2000 }, (_, i) => `fake${i}`));
  await api(`/api/playlists/${full.id}`, listener, { add: [ids[0]] }, "PATCH", 400);
  await api(`/api/playlists/${full.id}`, listener, undefined, "DELETE");
  await api(`/api/playlists/${data.curated.id}`, listener, { name: "Denied" }, "PATCH", 403);
  const other = await login("E2E Other");
  await api(`/api/playlists/${p.id}`, other, undefined, "GET", 404);
  await api(`/api/playlists/${p.id}`, other, undefined, "DELETE", 404);
  for (const kind of ["likes", "artists", "albums", "playlists"]) {
    const id = kind === "likes" ? ids[0] : kind === "artists" ? catalog.tracks[0].artists[0].id : kind === "albums" ? catalog.tracks[0].album.id : data.curated.id;
    await Promise.all(Array.from({ length: 4 }, () => api("/api/me/library", other, { kind, id, on: true }, "PUT")));
    expect((await api("/api/me", other)).library[kind][id]).toBeTruthy();
    await api("/api/me/library", other, { kind, id, on: false }, "PUT");
    expect((await api("/api/me", other)).library[kind][id]).toBeUndefined();
  }
  await api(`/api/playlists/${p.id}`, listener, undefined, "DELETE");
  await api(`/api/playlists/${p.id}`, listener, undefined, "GET", 404);
  const { url } = await api(`/api/tracks/${ids[0]}/stream`, listener);
  const range = await fetch(new URL(url, origin), { headers: { Range: "bytes=0-100" } });
  expect(range.status).toBe(206); expect((await range.arrayBuffer()).byteLength).toBe(101);
  const tampered = new URL(url, origin); tampered.searchParams.set("sig", "invalid");
  expect((await fetch(tampered)).status).toBe(403);
  const disposable = await uploadSong(admin, "E2E Disposable", 811);
  await api(`/api/admin/tracks/${disposable}`, admin, { title: "E2E Edited" }, "PATCH");
  expect((await api("/api/catalog", listener)).tracks.find((t: { id: string }) => t.id === disposable).title).toBe("E2E Edited");
  await api(`/api/admin/tracks/${disposable}`, admin, undefined, "DELETE");
  await api(`/api/tracks/${disposable}/stream`, listener, undefined, "GET", 404);
  await api("/api/admin/storage", admin, {}, "POST");
  await api("/api/admin/analytics", admin);
  await api("/api/me/stats", listener);
});

test("contact privacy, listening activity, Jam requests and collaborative playlists", async () => {
  const alice = await login("E2E Social Alice"), bob = await login("E2E Social Bob"), outsider = await login("E2E Social Outsider");
  const aliceMe = await api("/api/me", alice), bobMe = await api("/api/me", bob), outsiderMe = await api("/api/me", outsider);
  await api("/api/connections", alice, { userId: bobMe.user.uid }, "POST");
  expect((await api("/api/connections", bob)).connections[0]).toMatchObject({ status: "pending", user: { uid: aliceMe.user.uid } });
  await api("/api/connections", outsider, { userId: aliceMe.user.uid }, "POST");
  await api("/api/connections", bob, { userId: aliceMe.user.uid, action: "accept" }, "PATCH");

  const hidden = await api("/api/listening-activity", bob, { trackId: data.ids[0], playing: true, positionMs: 1200 }, "POST");
  expect(hidden.shared).toBe(false);
  expect((await api("/api/connections", alice)).connections.find((c: { user: { uid: string } }) => c.user.uid === bobMe.user.uid).activity).toBeNull();
  await api("/api/me/privacy", bob, { activitySharing: true, activityVisibleTo: [aliceMe.user.uid] }, "PATCH");
  await api("/api/listening-activity", bob, { trackId: data.ids[0], playing: true, positionMs: 1200 }, "POST");
  const visible = (await api("/api/connections", alice)).connections.find((c: { user: { uid: string } }) => c.user.uid === bobMe.user.uid).activity;
  expect(visible).toMatchObject({ trackId: data.ids[0], playing: true, positionMs: 1200 });
  await api("/api/me/privacy", bob, { activitySharing: true, activityVisibleTo: [outsiderMe.user.uid] }, "PATCH", 400);

  const request = (await api("/api/jam-requests", alice, { toUid: bobMe.user.uid, trackId: data.ids[0] }, "POST", 201)).request;
  expect((await api("/api/connections", bob)).jamRequests).toContainEqual(expect.objectContaining({ id: request.id, status: "pending" }));
  await api(`/api/jam-requests/${request.id}`, alice, { action: "accept" }, "PATCH", 404);
  const accepted = await api(`/api/jam-requests/${request.id}`, bob, { action: "accept" }, "PATCH");
  const jamId = accepted.snapshot.jam.id;
  expect(accepted.snapshot.jam).toMatchObject({ hostUid: bobMe.user.uid, members: [{ uid: bobMe.user.uid }, { uid: aliceMe.user.uid }], playback: { track: { id: data.ids[0] }, playing: true } });
  expect((await jamSnapshot(jamId, alice)).members.map((member: { uid: string }) => member.uid)).toContain(aliceMe.user.uid);
  await api(`/api/jams/${jamId}`, bob, { type: "leave" }, "POST");

  const declinedRequest = (await api("/api/jam-requests", alice, { toUid: bobMe.user.uid }, "POST", 201)).request;
  const declined = await api(`/api/jam-requests/${declinedRequest.id}`, bob, { action: "decline" }, "PATCH");
  expect(declined.request.status).toBe("declined");

  const playlist = (await api("/api/playlists", alice, { name: "E2E Collaborative", trackIds: [data.ids[0]] }, "POST", 201)).playlist;
  await api(`/api/playlists/${playlist.id}/collaborators`, alice, { uid: bobMe.user.uid }, "POST");
  expect((await api("/api/me", bob)).playlists.some((p: { id: string }) => p.id === playlist.id)).toBe(true);
  expect((await api(`/api/playlists/${playlist.id}`, bob)).playlist.collaborators).toContainEqual({ uid: bobMe.user.uid, name: bob.user.name });
  await api(`/api/playlists/${playlist.id}`, outsider, undefined, "GET", 404);
  await api(`/api/playlists/${playlist.id}/collaborators`, bob, { uid: outsiderMe.user.uid }, "POST", 403);
  const current = (await api(`/api/playlists/${playlist.id}`, bob)).playlist;
  await Promise.all([
    api(`/api/playlists/${playlist.id}`, alice, { add: [data.ids[1]] }, "PATCH"),
    api(`/api/playlists/${playlist.id}`, bob, { add: [data.ids[2]] }, "PATCH"),
  ]);
  const edited = (await api(`/api/playlists/${playlist.id}`, alice)).playlist;
  expect(edited.trackIds).toEqual(expect.arrayContaining(data.ids.slice(0, 3)));
  expect(edited.history.some((entry: { actorUid: string }) => entry.actorUid === bobMe.user.uid)).toBe(true);
  await api(`/api/playlists/${playlist.id}`, bob, { trackIds: [data.ids[0]] }, "PATCH", 400);
  await api(`/api/playlists/${playlist.id}`, bob, { trackIds: [data.ids[0]], expectedRevision: current.revision }, "PATCH", 409);
  await api(`/api/playlists/${playlist.id}/collaborators`, alice, { uid: bobMe.user.uid }, "DELETE");
});

test("phone Friends page shares opt-in activity and joins an accepted Jam request", async ({ browser }) => {
  test.setTimeout(45_000);
  const alice = await login("E2E Mobile Jam Requester"), bob = await login("E2E Mobile Jam Receiver");
  const aliceMe = await api("/api/me", alice), bobMe = await api("/api/me", bob);
  await api("/api/me/onboarding", alice, { artistIds: [] });
  await api("/api/me/onboarding", bob, { artistIds: [] });
  await api("/api/connections", alice, { userId: bobMe.user.uid }, "POST");
  await api("/api/connections", bob, { userId: aliceMe.user.uid, action: "accept" }, "PATCH");
  await api("/api/me/privacy", bob, { activitySharing: true, activityVisibleTo: [aliceMe.user.uid] }, "PATCH");
  await api("/api/listening-activity", bob, { trackId: data.ids[0], playing: true, positionMs: 1000 }, "POST");

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await authenticate(mobile, alice);
  await authenticate(desktop, bob);
  const alicePage = await mobile.newPage(), bobPage = await desktop.newPage();
  try {
    await alicePage.goto(origin);
    await alicePage.getByRole("button", { name: "Account" }).click();
    await alicePage.getByRole("button", { name: "Friends & Jams" }).click();
    await expect(alicePage).toHaveURL(`${origin}/friends`);
    await expect(alicePage.getByText("E2E Song One", { exact: false })).toBeVisible();
    await alicePage.getByRole("button", { name: "Request Jam" }).click();
    await expect(alicePage.getByText("Jam request sent to E2E Mobile Jam Receiver")).toBeVisible();

    await bobPage.goto(`${origin}/friends`);
    await bobPage.getByRole("button", { name: "Accept", exact: true }).click();
    await expect(bobPage.getByRole("dialog", { name: "Jam", exact: true })).toBeVisible();
    await expect(bobPage.getByRole("heading", { name: "Your Jam", exact: true })).toBeVisible();
    await expect(alicePage.getByRole("button", { name: "Join Jam", exact: true })).toBeVisible({ timeout: 20_000 });
    await alicePage.getByRole("button", { name: "Join Jam", exact: true }).click();
    await expect(alicePage.getByRole("dialog", { name: "Jam", exact: true })).toBeVisible();
    await expect(alicePage.getByRole("heading", { name: "Participants (2)" })).toBeVisible();
    await alicePage.getByRole("button", { name: "Leave Jam", exact: true }).click();
    await bobPage.getByRole("button", { name: "End Jam for everyone", exact: true }).click();
  } finally {
    await Promise.all([mobile.close(), desktop.close()]);
  }
});

for (const mobile of [false, true]) {
  test(`${mobile ? "mobile" : "desktop"}: Friends privacy controls and Jam requests`, async ({ browser }) => {
    test.setTimeout(60_000);
    const alice = await login(`E2E Friends ${mobile ? "Mobile" : "Desktop"} Alice`);
    const bob = await login(`E2E Friends ${mobile ? "Mobile" : "Desktop"} Bob`);
    const aliceMe = await api("/api/me", alice), bobMe = await api("/api/me", bob);
    await api("/api/me/onboarding", alice, { artistIds: [] });
    await api("/api/me/onboarding", bob, { artistIds: [] });
    await api("/api/connections", alice, { userId: bobMe.user.uid }, "POST");
    await api("/api/connections", bob, { userId: aliceMe.user.uid, action: "accept" }, "PATCH");

    const contextOptions = mobile
      ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
      : { viewport: { width: 1280, height: 800 } };
    const aliceContext = await browser.newContext(contextOptions);
    const bobContext = await browser.newContext(contextOptions);
    await authenticate(aliceContext, alice);
    await authenticate(bobContext, bob);
    const alicePage = await aliceContext.newPage(), bobPage = await bobContext.newPage();
    try {
      await alicePage.goto(origin + `/playlist/${data.curated.id}`);
      await alicePage.getByRole("button", { name: `Play ${data.curated.name}`, exact: true }).first().click();
      await playing(alicePage, data.ids[0]);
      await Promise.all([alicePage.goto(origin + "/friends"), bobPage.goto(origin + "/friends")]);
      await ensureChecked(alicePage, "Share listening activity");
      await ensureChecked(alicePage, bob.user.name);
      await ensureChecked(bobPage, "Share listening activity");
      await ensureChecked(bobPage, alice.user.name);
      await expect.poll(async () => (await api("/api/me", alice)).user.activityVisibleTo).toContain(bobMe.user.uid);
      await expect.poll(async () => (await api("/api/me", bob)).user.activityVisibleTo).toContain(aliceMe.user.uid);
      await api("/api/listening-activity", bob, { trackId: data.ids[0], playing: true, positionMs: 1400 }, "POST");
      await alicePage.reload();
      await expect(alicePage.getByText(/Listening to E2E Song One/).first()).toBeVisible();

      await alicePage.getByRole("button", { name: "Request Jam", exact: true }).click();
      await expect(alicePage.getByText(`Jam request sent to ${bob.user.name}`)).toBeVisible();
      await bobPage.reload();
      await bobPage.getByRole("button", { name: "Accept", exact: true }).click();
      await expect(bobPage.getByRole("dialog", { name: "Jam", exact: true })).toBeVisible();
      await alicePage.reload();
      await alicePage.getByRole("button", { name: "Join Jam", exact: true }).click();
      await expect(alicePage.getByRole("heading", { name: "Participants (2)" })).toBeVisible();
      const jamAudioTime = (page: Page) => page.evaluate((id) => window.testAudio.find((audio) => !audio.paused && audio.src.includes(id))?.currentTime ?? -1, data.ids[0]);
      await expect.poll(() => jamAudioTime(alicePage)).toBeGreaterThan(0);
      await expect.poll(() => jamAudioTime(bobPage)).toBeGreaterThan(0);
      expect(Math.abs(await jamAudioTime(alicePage) - await jamAudioTime(bobPage))).toBeLessThan(1.5);
      await alicePage.getByRole("button", { name: "Leave Jam", exact: true }).click();
      await bobPage.getByRole("button", { name: "End Jam for everyone", exact: true }).click();
      const widthsFit = await Promise.all([alicePage, bobPage].map((page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)));
      expect(widthsFit).toEqual([true, true]);
    } finally {
      await Promise.all([aliceContext.close(), bobContext.close()]);
    }
  });

  test(`${mobile ? "mobile" : "desktop"}: collaborative playlist invite, edit, history and revoke`, async ({ browser }) => {
    const owner = await login(`E2E Collaborator ${mobile ? "Mobile" : "Desktop"} Owner`);
    const editor = await login(`E2E Collaborator ${mobile ? "Mobile" : "Desktop"} Editor`);
    const ownerMe = await api("/api/me", owner), editorMe = await api("/api/me", editor);
    await api("/api/connections", owner, { userId: editorMe.user.uid }, "POST");
    await api("/api/connections", editor, { userId: ownerMe.user.uid, action: "accept" }, "PATCH");
    const playlist = (await api("/api/playlists", owner, { name: `E2E ${mobile ? "Mobile" : "Desktop"} Shared List`, trackIds: [data.ids[0]] }, "POST", 201)).playlist;

    const contextOptions = mobile
      ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
      : { viewport: { width: 1280, height: 800 } };
    const ownerContext = await browser.newContext(contextOptions);
    const editorContext = await browser.newContext(contextOptions);
    await authenticate(ownerContext, owner);
    await authenticate(editorContext, editor);
    const ownerPage = await ownerContext.newPage(), editorPage = await editorContext.newPage();
    try {
      await ownerPage.goto(origin + `/playlist/${playlist.id}`);
      await ownerPage.getByRole("button", { name: "Playlist options" }).click();
      await ownerPage.getByRole("button", { name: "Manage collaborators", exact: true }).click();
      await ownerPage.getByRole("button", { name: "Invite", exact: true }).click();
      await expect.poll(async () => (await api(`/api/playlists/${playlist.id}`, owner)).playlist.collaboratorUids).toContain(editorMe.user.uid);

      await editorPage.goto(origin + `/playlist/${playlist.id}`);
      const search = editorPage.getByPlaceholder("Search for songs");
      await search.fill("E2E Song Two");
      await editorPage.getByRole("button", { name: "Add", exact: true }).click();
      await expect.poll(async () => (await api(`/api/playlists/${playlist.id}`, owner)).playlist.trackIds).toContain(data.ids[1]);
      await editorPage.getByText("Recent changes", { exact: true }).click();
      await expect(editorPage.getByRole("listitem").filter({ hasText: "Added 1 song" })).toBeVisible();

      await ownerPage.getByRole("button", { name: "Remove", exact: true }).click();
      await expect.poll(async () => (await api(`/api/playlists/${playlist.id}`, owner)).playlist.collaboratorUids).not.toContain(editorMe.user.uid);
      await api(`/api/playlists/${playlist.id}`, editor, undefined, "GET", 404);
      const widthsFit = await Promise.all([ownerPage, editorPage].map((page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)));
      expect(widthsFit).toEqual([true, true]);
    } finally {
      await Promise.all([ownerContext.close(), editorContext.close()]);
    }
  });
}

test("collection routes, search, likes, playlist editor and account isolation", async ({ context, page }) => {
  await authenticate(context, data.listener);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Curated playlists" })).toBeVisible();
  const box = await page.getByRole("heading", { name: "Curated playlists" }).boundingBox();
  expect(box!.y).toBeLessThan(625);
  await navigate(page, "/search");
  await page.getByRole("textbox", { name: "Search songs, artists and albums" }).fill("E2E Song One");
  await page.getByRole("button", { name: "More options for E2E Song One", exact: true }).click();
  await page.getByRole("button", { name: "Add to Liked Songs", exact: true }).click();
  await navigate(page, "/liked");
  await expect(page.getByRole("button", { name: "More options for E2E Song One", exact: true })).toBeVisible();
  const catalog = await api("/api/catalog", data.listener), t = catalog.tracks[0];
  for (const path of [`/track/${t.id}`, `/album/${t.album.id}`, `/artist/${t.artists[0].id}`, "/genre/pop", "/stats"]) {
    await page.goto(path); await expect(page.locator("main")).not.toContainText("Something went wrong");
    await expect(page.locator("main h1, main h2").first()).toBeVisible();
  }
  await page.goto(`/playlist/${data.a.id}`);
  await page.getByRole("button", { name: "Playlist options" }).click();
  await page.getByRole("button", { name: "Edit details", exact: true }).click();
  await page.getByPlaceholder("Name", { exact: true }).fill("E2E Playlist A updated");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("heading", { name: "E2E Playlist A updated", exact: true })).toBeVisible();
  await page.goto("/");
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(page.getByLabel("What should we call you?")).toBeVisible();
  await page.getByLabel("What should we call you?").fill("E2E Fresh Account");
  await page.getByRole("button", { name: "Continue as listener" }).click();
  await expect(page.getByRole("button", { name: "Account", exact: true })).toBeVisible();
  await navigate(page, "/liked");
  await expect(page.getByRole("button", { name: "More options for E2E Song One", exact: true })).toHaveCount(0);
  await navigate(page, "/library");
  await expect(page.locator(`a[href="/playlist/${data.a.id}"]`)).toHaveCount(0);
});

test("admin file upload through the UI becomes playable for a listener", async ({ context, page }) => {
  await authenticate(context, data.admin);
  await page.goto("/admin/upload");
  await page.locator('input[type="file"]').first().setInputFiles({ name: "E2E Browser Upload.wav", mimeType: "audio/wav", buffer: tone(977) });
  await expect(page.getByText("E2E Browser Upload", { exact: true }).first()).toBeVisible();
  await expect.poll(async () => (await api("/api/catalog", data.listener)).tracks.some((t: { title: string }) => t.title.includes("E2E Browser Upload")), { timeout: 30000 }).toBe(true);
});

test("three-person Jam synchronizes audio and enforces permissions, leave and end", async ({ browser }) => {
  test.setTimeout(75_000);
  const friend = await login("E2E Jam Friend"), third = await login("E2E Jam In Person");
  const contexts = await Promise.all([data.listener, friend, third].map(async (session) => {
    const c = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await authenticate(c, session); return c;
  }));
  const [host, guest, inPerson] = await Promise.all(contexts.map((c) => c.newPage()));
  const paused = (p: Page) => expect.poll(() => p.evaluate(() => window.testAudio[0].paused)).toBe(true);
  try {
    await host.goto(origin + `/playlist/${data.curated.id}`);
    await host.getByRole("button", { name: "Start a Jam", exact: true }).click();
    await host.getByRole("button", { name: "QR code", exact: true }).click();
    await expect(host.getByRole("img", { name: "Scan to join this Jam" })).toBeVisible();
    const invite = await host.getByRole("textbox", { name: "Jam invite link" }).inputValue();
    const id = invite.split("/").pop();
    await Promise.all([guest.goto(invite), inPerson.goto(invite)]);
    await guest.getByRole("button", { name: "Listen on this device", exact: true }).click();
    await inPerson.getByRole("button", { name: "Join in person", exact: true }).click();
    await expect(host.getByRole("heading", { name: "Participants (3)" })).toBeVisible();
    await Promise.all([playing(host, data.ids[0]), playing(guest, data.ids[0]), paused(inPerson)]);
    const time = (p: Page) => p.evaluate(() => window.testAudio[0].currentTime);
    expect(Math.abs(await time(host) - await time(guest))).toBeLessThan(1);
    await guest.keyboard.press("Escape");
    await guest.getByRole("button", { name: "Pause", exact: true }).first().click();
    await Promise.all([paused(host), paused(guest)]);
    const slider = guest.getByRole("slider", { name: "Seek", exact: true }).first();
    await slider.focus();
    for (let i = 0; i < 60; i++) await slider.press("ArrowRight");
    await expect.poll(() => time(host)).toBeGreaterThan(14);
    const hostPosition = await time(host), guestPosition = await time(guest);
    const [hostAudio, guestAudio, jam] = await Promise.all([
      host.evaluate(() => window.testAudio.map((audio) => ({ time: audio.currentTime, paused: audio.paused, src: audio.src }))),
      guest.evaluate(() => window.testAudio.map((audio) => ({ time: audio.currentTime, paused: audio.paused, src: audio.src }))),
      jamSnapshot(id!, data.listener),
    ]);
    console.log("Jam seek positions", { hostPosition, guestPosition, hostAudio, guestAudio, roomPosition: jam.playback.positionMs, roomPlaying: jam.playback.playing });
    expect(Math.abs(hostPosition - guestPosition)).toBeLessThan(0.6);
    await guest.getByRole("button", { name: "Next", exact: true }).click();
    await Promise.all([playing(host, data.ids[1]), playing(guest, data.ids[1])]);
    await host.getByLabel("Let guests change playback").click();
    await expect(host.getByLabel("Let guests change playback")).not.toBeChecked();
    await api(`/api/jams/${id}`, friend, { type: "next", sequence: 1 }, "POST", 403);
    await Promise.all([friend, third].map((s, i) => api(`/api/jams/${id}`, s, { type: "add", ids: [data.ids[i]] })));
    await host.getByLabel("Let guests change speaker volume").click();
    await expect(host.getByLabel("Let guests change speaker volume")).toBeChecked();
    await api(`/api/jams/${id}`, friend, { type: "volume", volume: 0.4 });
    await expect.poll(() => host.evaluate(() => window.testAudio[0].volume)).toBeCloseTo(0.4);
    await host.getByRole("button", { name: "Group recommendations" }).click();
    const recommendations = await api(`/api/jams/${id}/recommendations`, data.listener);
    expect(recommendations.tracks.length).toBeGreaterThan(0);
    const catalog = await api("/api/catalog", data.listener);
    const recommendation = catalog.tracks.find((track: { id: string }) => track.id === recommendations.tracks[0].id);
    expect(recommendation).toBeTruthy();
    const addRecommendation = host.getByRole("button", { name: `Add ${recommendation.title} to the Jam queue`, exact: true });
    await expect(addRecommendation).toBeVisible();
    await addRecommendation.click();
    await expect.poll(async () => (await jamSnapshot(id!, data.listener)).queue.some((track: { id: string }) => track.id === recommendation.id)).toBe(true);
    await host.getByRole("button", { name: "Remove E2E Jam In Person" }).click();
    await expect(inPerson.getByRole("dialog", { name: "Jam", exact: true })).toBeHidden();
    await api(`/api/jams/${id}`, third, { type: "join" }, "POST", 403);
    await guest.reload();
    await expect(guest.getByRole("heading", { name: "You’re in this Jam" })).toBeVisible();
    await guest.getByRole("button", { name: "Open Jam", exact: true }).click();
    await guest.getByRole("button", { name: "Leave Jam", exact: true }).click();
    await expect(guest.getByRole("dialog", { name: "Jam", exact: true })).toBeHidden();
    await guest.getByRole("button", { name: "Listen on this device", exact: true }).click();
    await expect(guest.getByRole("heading", { name: "Your Jam", exact: true })).toBeVisible();
    await host.getByRole("button", { name: "End Jam for everyone", exact: true }).click();
    await expect(guest.getByRole("dialog", { name: "Jam", exact: true })).toBeHidden();
    await api(`/api/jams/${id}`, friend, undefined, "GET", 404);
  } finally { await Promise.all(contexts.map((c) => c.close())); }
});
