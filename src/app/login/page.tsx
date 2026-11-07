"use client";

import { useState } from "react";
import { Logo } from "@/components/icons";
import { authErrorMessage, useAuth } from "@/lib/client/auth";

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

const input =
  "h-12 w-full rounded-md border border-[#727272] bg-[#121212] px-3.5 text-base text-white outline-none transition placeholder:text-[#a7a7a7] hover:border-white focus:border-white focus:ring-2 focus:ring-white";

export default function LoginPage() {
  const auth = useAuth();
  const [mode, setMode] = useState<"welcome" | "login" | "signup" | "reset">("welcome");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const demo = auth.mode === "demo";

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-black text-white">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[60dvh] bg-[radial-gradient(120%_80%_at_50%_0%,#1f5f3a_0%,#0b2416_45%,#000_75%)]" />
      <div className="relative mx-auto flex w-full max-w-sm flex-1 flex-col justify-end px-6 pb-[max(32px,env(safe-area-inset-bottom))] pt-16 sm:justify-center">
        <div className="mb-10 flex flex-col items-center text-center">
          <Logo className="text-[40px]" />
          <h1 className="mt-6 text-[28px] font-extrabold leading-tight tracking-tight sm:text-[32px]">
            Millions of songs.
            <br />
            All free.
          </h1>
        </div>

        {demo ? (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
            }}
          >
            <label className="block text-sm font-bold" htmlFor="demo-name">
              What should we call you?
            </label>
            <input id="demo-name" className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoComplete="nickname" />
            <button
              type="button"
              disabled={busy || !name.trim()}
              onClick={() => run(() => auth.signInDemo(name.trim(), "admin"))}
              className="h-12 w-full rounded-full bg-accent text-base font-bold text-black transition hover:scale-[1.02] hover:bg-accent-hover disabled:opacity-50"
            >
              Continue as admin
            </button>
            <button
              type="button"
              disabled={busy || !name.trim()}
              onClick={() => run(() => auth.signInDemo(name.trim(), "listener"))}
              className="h-12 w-full rounded-full border border-[#878787] text-base font-bold transition hover:border-white disabled:opacity-50"
            >
              Continue as listener
            </button>
            <p className="pt-2 text-center text-xs leading-relaxed text-subdued">
              Local demo mode — no Firebase keys configured yet. Add them to <code className="text-white">.env.local</code> to turn on real
              accounts (Google &amp; email).
            </p>
            {!auth.demoLogin && <p className="text-center text-xs text-danger">Demo login is disabled on this server.</p>}
          </form>
        ) : mode === "welcome" ? (
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => setMode("signup")}
              className="h-12 w-full rounded-full bg-accent text-base font-bold text-black transition hover:scale-[1.02] hover:bg-accent-hover"
            >
              Sign up free
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => run(auth.signInWithGoogle)}
              className="flex h-12 w-full items-center justify-center gap-3 rounded-full border border-[#878787] text-base font-bold transition hover:border-white"
            >
              <GoogleMark /> Continue with Google
            </button>
            <button type="button" onClick={() => setMode("login")} className="h-12 w-full rounded-full text-base font-bold hover:scale-[1.02]">
              Log in
            </button>
          </div>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (mode === "login") run(() => auth.signInWithEmail(email, password));
              else if (mode === "signup") run(() => auth.signUpWithEmail(name.trim() || email.split("@")[0], email, password));
              else
                run(async () => {
                  await auth.resetPassword(email);
                  setInfo("Check your inbox for a reset link.");
                });
            }}
          >
            <h2 className="pb-1 text-center text-xl font-bold">{mode === "login" ? "Log in" : mode === "signup" ? "Sign up to start listening" : "Reset your password"}</h2>
            {mode === "signup" && <input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" autoComplete="name" />}
            <input className={input} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address" autoComplete="email" />
            {mode !== "reset" && (
              <input
                className={input}
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
              />
            )}
            <button type="submit" disabled={busy} className="h-12 w-full rounded-full bg-accent text-base font-bold text-black transition hover:scale-[1.02] hover:bg-accent-hover disabled:opacity-50">
              {mode === "login" ? "Log in" : mode === "signup" ? "Sign up" : "Send reset link"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => run(auth.signInWithGoogle)}
              className="flex h-12 w-full items-center justify-center gap-3 rounded-full border border-[#878787] text-base font-bold transition hover:border-white"
            >
              <GoogleMark /> Continue with Google
            </button>
            <div className="flex justify-between pt-1 text-sm text-subdued">
              <button type="button" className="hover:text-white hover:underline" onClick={() => setMode(mode === "login" ? "signup" : "login")}>
                {mode === "login" ? "Create an account" : "I already have an account"}
              </button>
              {mode === "login" && (
                <button type="button" className="hover:text-white hover:underline" onClick={() => setMode("reset")}>
                  Forgot password?
                </button>
              )}
            </div>
          </form>
        )}
        {error && (
          <p role="alert" className="mt-4 rounded-md bg-danger/15 px-3 py-2 text-center text-sm text-danger">
            {error}
          </p>
        )}
        {info && <p className="mt-4 text-center text-sm text-accent">{info}</p>}
      </div>
    </div>
  );
}
