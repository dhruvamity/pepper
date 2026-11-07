"use client";

import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";

export const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
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
