import { requireUser } from "@/lib/server/auth";
import { repo } from "@/lib/server/db";
import { HttpError, json, readJson, route } from "@/lib/server/http";
import { changeJam, isActive, jamAction, jamId } from "@/lib/server/jam";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (req, { params }) => {
  const { uid } = await requireUser(req);
  const id = jamId.parse((await params).id);
  const jam = await (await repo()).getJam(id);
  if (!isActive(jam) || jam.removed.includes(uid)) throw new HttpError(404, "This Jam has ended or the invite is invalid");
  return json({ host: jam.members.find((member) => member.uid === jam.hostUid)?.name, count: jam.members.length });
});

export const POST = route<Ctx>(async (req, { params }) => {
  const { uid, name } = await requireUser(req);
  const id = jamId.parse((await params).id);
  const action = jamAction.parse(await readJson(req));
  return json(await changeJam(id, { uid, name }, action));
});
