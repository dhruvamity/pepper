"use client";

import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";

/**
 * Pepper's own Firebase web config. It is public by design (it ships to every browser and
 * only identifies the project); it backs up the env values when a hosting dashboard saves a
 * broken key, e.g. its masked "AIza••••" preview.
 */
const PEPPER_FIREBASE = { projectId: "pepper-7d591", apiKey: "AIzaSyBBFQHiQFNmj3-WsqMlj4E9NTF51-RyiCM" };

/** A usable key is plain printable ASCII (masked previews contain "•", pastes can add spaces). */
function usableKey(key: string | undefined): string | undefined {
  const k = key?.trim();
  return k && /^[\x21-\x7e]+$/.test(k) ? k : undefined;
}

const envProject = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim();

export const firebaseConfig = {
  apiKey: usableKey(process.env.NEXT_PUBLIC_FIREBASE_API_KEY) ?? (envProject === PEPPER_FIREBASE.projectId ? PEPPER_FIREBASE.apiKey : undefined),
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: envProject,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
};

export const firebaseClientConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

/** Set to "127.0.0.1:9099" to develop against the Firebase Auth emulator. */
const AUTH_EMULATOR = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST;

let app: FirebaseApp | undefined;
let auth: Auth | undefined;

export function firebaseAuth(): Auth {
  if (auth) return auth;
  app ??= getApps()[0] ?? initializeApp(firebaseConfig);
  auth = getAuth(app);
  if (AUTH_EMULATOR) connectAuthEmulator(auth, `http://${AUTH_EMULATOR}`, { disableWarnings: true });
  return auth;
}
