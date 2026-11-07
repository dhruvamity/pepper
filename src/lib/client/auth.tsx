"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { setTokenGetter, setUnauthorizedHandler } from "./api";
import { resetJamSession } from "./jam";
import { usePlayer } from "./player/store";
import { firebaseAuth, firebaseClientConfigured } from "./firebase";
import { clearSession, readSessionHint, saveSessionHint } from "./persist";

export type AuthMode = "firebase" | "demo";

export interface SessionUser {
  uid: string;
  name: string;
  email?: string;
  photoURL?: string;
}

interface AuthState {
  status: "loading" | "signedOut" | "signedIn";
  mode: AuthMode;
  user: SessionUser | null;
  demoLogin: boolean;
  signInWithGoogle(): Promise<void>;
  signInWithEmail(email: string, password: string): Promise<void>;
  signUpWithEmail(name: string, email: string, password: string): Promise<void>;
  resetPassword(email: string): Promise<void>;
  signInDemo(name: string, role: "admin" | "listener"): Promise<void>;
  signOut(): Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);
const DEMO_KEY = "pepper.demo";

function readDemo(): { token: string; user: SessionUser } | null {
  try {
    const raw = localStorage.getItem(DEMO_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthState["status"]>("loading");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [mode, setMode] = useState<AuthMode>(firebaseClientConfigured ? "firebase" : "demo");
  const [demoLogin, setDemoLogin] = useState(false);
  const account = useRef<string | null>(null);
  const acceptSession = useCallback((next: SessionUser | null) => {
    const previous = account.current ?? readSessionHint()?.uid;
    if ((previous && previous !== next?.uid) || !next) {
      resetJamSession();
      usePlayer.getState().stop();
      clearSession();
      try {
        localStorage.removeItem("pepper.player");
        localStorage.removeItem("pepper.pendingPlay");
        sessionStorage.removeItem("pepper.skipOnboarding");
      } catch { /* storage may be disabled */ }
    }
    account.current = next?.uid ?? null;
    if (next) saveSessionHint(next);
    setUser(next);
    setStatus(next ? "signedIn" : "signedOut");
  }, []);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    let cancelled = false;
    const startFirebase = () => {
      // Requests wait for Firebase to restore the session, so none goes out without a token.
      const ready = (async () => {
        const { onIdTokenChanged } = await import("firebase/auth");
        const auth = firebaseAuth();
        unsub = onIdTokenChanged(auth, (fu) => {
          if (cancelled) return;
          if (fu) {
            const u = { uid: fu.uid, name: fu.displayName || fu.email?.split("@")[0] || "Listener", email: fu.email ?? undefined, photoURL: fu.photoURL ?? undefined };
            acceptSession(u);
          } else {
            acceptSession(null);
          }
        });
        await auth.authStateReady();
        return auth;
      })();
      setTokenGetter(async () => {
        const auth = await ready;
        return auth.currentUser ? auth.currentUser.getIdToken() : null;
      });
      // Returning listener: open the app right away; Firebase confirms (or signs out) shortly.
      const hint = readSessionHint();
      if (hint) {
        setUser(hint);
        setStatus("signedIn");
      }
    };

    // Firebase builds know their mode up front; start without waiting for the server.
    if (firebaseClientConfigured) startFirebase();
    fetch("/api/config")
      .then((r) => r.json())
      .then((cfg: { auth?: string; demoLogin?: boolean }) => {
        if (cancelled) return;
        setDemoLogin(Boolean(cfg.demoLogin));
        if (firebaseClientConfigured && cfg.auth === "firebase") return;
        // Local/demo server (or no Firebase config in this build): demo sessions.
        unsub?.();
        setMode("demo");
        const d = readDemo();
        setTokenGetter(async () => readDemo()?.token ?? null);
        acceptSession(d?.user ?? null);
      })
      .catch(() => {
        // Offline: keep whatever Firebase restores (or the remembered session).
        if (!firebaseClientConfigured && !cancelled) setStatus("signedOut");
      });
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [acceptSession]);

  const signInWithGoogle = useCallback(async () => {
    const { GoogleAuthProvider, signInWithPopup, signInWithRedirect } = await import("firebase/auth");
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    try {
      await signInWithPopup(firebaseAuth(), provider);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment") {
        await signInWithRedirect(firebaseAuth(), provider);
      } else throw err;
    }
  }, []);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    const { signInWithEmailAndPassword } = await import("firebase/auth");
    await signInWithEmailAndPassword(firebaseAuth(), email, password);
  }, []);

  const signUpWithEmail = useCallback(async (name: string, email: string, password: string) => {
    const { createUserWithEmailAndPassword, sendEmailVerification, updateProfile } = await import("firebase/auth");
    const cred = await createUserWithEmailAndPassword(firebaseAuth(), email, password);
    await updateProfile(cred.user, { displayName: name });
    // Admin rights (ADMIN_EMAILS) only apply to verified emails, so send the verification link.
    sendEmailVerification(cred.user).catch(() => {});
    await cred.user.getIdToken(true);
    setUser({ uid: cred.user.uid, name, email });
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    const { sendPasswordResetEmail } = await import("firebase/auth");
    await sendPasswordResetEmail(firebaseAuth(), email);
  }, []);

  const signInDemo = useCallback(async (name: string, role: "admin" | "listener") => {
    const res = await fetch("/api/auth/demo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, role }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Sign in failed");
    const session = { token: data.token as string, user: { uid: data.user.uid, name: data.user.name } };
    localStorage.setItem(DEMO_KEY, JSON.stringify(session));
    setTokenGetter(async () => readDemo()?.token ?? null);
    acceptSession(session.user);
  }, [acceptSession]);

  const signOut = useCallback(async () => {
    if (mode === "firebase") {
      const { signOut: fbSignOut } = await import("firebase/auth");
      await fbSignOut(firebaseAuth());
    } else {
      localStorage.removeItem(DEMO_KEY);
    }
    acceptSession(null);
  }, [mode, acceptSession]);

  // A rejected token means the session is no longer valid: sign out cleanly.
  useEffect(() => {
    setUnauthorizedHandler(() => { void signOut(); });
    return () => setUnauthorizedHandler(null);
  }, [signOut]);

  const value = useMemo<AuthState>(
    () => ({ status, mode, user, demoLogin, signInWithGoogle, signInWithEmail, signUpWithEmail, resetPassword, signInDemo, signOut }),
    [status, mode, user, demoLogin, signInWithGoogle, signInWithEmail, signUpWithEmail, resetPassword, signInDemo, signOut],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside <AuthProvider>");
  return v;
}

export function authErrorMessage(err: unknown): string {
  const code = (err as { code?: string }).code ?? "";
  const map: Record<string, string> = {
    "auth/invalid-credential": "Incorrect email or password.",
    "auth/wrong-password": "Incorrect email or password.",
    "auth/user-not-found": "No account found with that email.",
    "auth/email-already-in-use": "That email is already registered — log in instead.",
    "auth/weak-password": "Use at least 6 characters for your password.",
    "auth/invalid-email": "That email address doesn't look right.",
    "auth/popup-closed-by-user": "Sign-in was cancelled.",
    "auth/too-many-requests": "Too many attempts. Try again in a minute.",
    "auth/unauthorized-domain": "This domain isn't authorised in Firebase Auth settings.",
  };
  return map[code] ?? (err instanceof Error ? err.message : "Something went wrong.");
}
