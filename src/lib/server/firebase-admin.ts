import { applicationDefault, cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { config } from "./env";

export function firebaseAdminApp(): App {
  const existing = getApps();
  if (existing.length) return existing[0];
  const f = config.firebase;
  if (f.serviceAccountBase64) {
    return initializeApp({ credential: cert(JSON.parse(Buffer.from(f.serviceAccountBase64, "base64").toString("utf8"))), projectId: f.projectId });
  }
  if (f.serviceAccountJson) return initializeApp({ credential: cert(JSON.parse(f.serviceAccountJson)), projectId: f.projectId });
  if (f.clientEmail && f.privateKey) {
    return initializeApp({ credential: cert({ projectId: f.projectId, clientEmail: f.clientEmail, privateKey: f.privateKey }), projectId: f.projectId });
  }
  // Emulator Suite: firebase-admin talks to FIREBASE_AUTH_EMULATOR_HOST / FIRESTORE_EMULATOR_HOST without credentials.
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST) return initializeApp({ projectId: f.projectId });
  return initializeApp({ credential: applicationDefault(), projectId: f.projectId });
}
