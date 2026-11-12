/** Invite links (/add/<code>) shared by the server routes and the Friends page. Keep free of runtime imports. */

/** 12 characters from an alphabet without look-alikes, so a code survives being read aloud. */
export const INVITE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const INVITE_CODE = /^[abcdefghjkmnpqrstuvwxyz23456789]{12}$/;

export function invitePath(code: string) {
  return `/add/${code}`;
}

/** Accepts a full invite link, a bare invite code or a raw Pepper ID typed into the connect box. */
export function parseInviteInput(raw: string): { inviteCode: string } | { userId: string } | null {
  const text = raw.trim();
  if (!text) return null;
  const fromUrl = text.match(/\/add\/([a-z0-9]+)/i)?.[1]?.toLowerCase();
  if (fromUrl) return INVITE_CODE.test(fromUrl) ? { inviteCode: fromUrl } : null;
  if (INVITE_CODE.test(text.toLowerCase())) return { inviteCode: text.toLowerCase() };
  return text.includes("/") ? null : { userId: text };
}
