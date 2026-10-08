import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SkipLink } from "./shared";
import { getAccessToken, isSupabaseConfigured, supabase, type Session } from "./supabase";

/**
 * Phase 2 auth gate.
 *
 * Flow: signed out → email/password sign-in → connect Sleeper username →
 * app. While Phase 2 data isolation is still rolling out, a signed-in user
 * without a Sleeper connection sees the connect screen; once connected we
 * render the app.
 *
 * If Supabase env vars are not configured (local/preview without auth),
 * the gate renders the app directly so Phase 1 behaviour is preserved.
 */

type SleeperConnection = { sleeperUserId: string; sleeperUsername: string } | null;

async function fetchConnection(): Promise<SleeperConnection> {
  const token = await getAccessToken();
  if (!token) return null;
  const res = await fetch("/api/user", {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { connection: SleeperConnection };
  return data.connection;
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [connection, setConnection] = useState<SleeperConnection>(null);
  const [connLoading, setConnLoading] = useState(false);
  const [connChecked, setConnChecked] = useState(false);

  const refreshConnection = useCallback(async () => {
    setConnLoading(true);
    try {
      setConnection(await fetchConnection());
    } finally {
      setConnLoading(false);
      setConnChecked(true);
    }
  }, []);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setLoading(false);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (session) {
      setConnChecked(false);
      void refreshConnection();
    } else {
      setConnection(null);
      setConnChecked(false);
    }
  }, [session, refreshConnection]);

  if (!isSupabaseConfigured || !supabase) {
    return <>{children}</>;
  }

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background px-4 text-sm text-muted-foreground">
        <p>Loading…</p>
      </div>
    );
  }

  if (!session) {
    return <AuthScreen />;
  }

  // Session exists but the Sleeper connection check has not come back yet
  // (e.g. a cold home-screen launch). Hold the loading screen instead of
  // flashing the connect screen at users who are already connected.
  if (!connection && !connChecked) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background px-4 text-sm text-muted-foreground">
        <p>Loading…</p>
      </div>
    );
  }

  if (!connection) {
    return (
      <ConnectSleeper
        email={session.user.email ?? ""}
        loading={connLoading}
        onConnected={refreshConnection}
        onSignOut={() => {
          localStorage.removeItem("fantasy-rankings-dashboard-v7");
          if (!supabase) return;
          void supabase.auth.signOut();
        }}
      />
    );
  }

  return (
    <>
      <SignedInBar
        username={connection.sleeperUsername}
        onSignOut={() => {
          localStorage.removeItem("fantasy-rankings-dashboard-v7");
          if (!supabase) return;
          void supabase.auth.signOut();
        }}
      />
      {children}
    </>
  );
}

function SignedInBar({ username, onSignOut }: { username: string; onSignOut: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 bg-foreground px-4 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] text-sm text-background">
      <span>Sleeper: {username}</span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="border-background/30 bg-transparent text-background hover:bg-background/10 hover:text-background"
        onClick={onSignOut}
      >
        Sign out
      </Button>
    </div>
  );
}

function AuthScreen() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    document.title = mode === "signin" ? "Sign In · Fantasy Rankings" : "Sign Up · Fantasy Rankings";
  }, [mode]);

  useEffect(() => {
    const desktop = window.matchMedia("(pointer: fine) and (min-width: 760px)").matches;
    if (desktop) emailRef.current?.focus();
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const nextEmail = email.trim();
    const nextEmailError = nextEmail ? null : "Enter your email address.";
    const nextPasswordError = password ? null : "Enter your password.";
    setEmailError(nextEmailError);
    setPasswordError(nextPasswordError);
    setError(null);
    if (nextEmailError) {
      emailRef.current?.focus();
      return;
    }
    if (nextPasswordError) {
      passwordRef.current?.focus();
      return;
    }
    if (!supabase) return;
    setBusy(true);
    setNotice(null);
    try {
      if (mode === "signup") {
        const { error: signUpError } = await supabase.auth.signUp({
          email: nextEmail,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (signUpError) throw signUpError;
        setNotice("Check your email to confirm your account, then sign in.");
        setMode("signin");
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email: nextEmail, password });
        if (signInError) throw signInError;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      errorRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-8 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))]">
      <SkipLink href="#auth-form">Skip to form</SkipLink>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">
            <h1 translate="no">Fantasy Rankings</h1>
          </CardTitle>
          <CardDescription>
            {mode === "signin" ? "Sign in to see your leagues." : "Create an account to get started."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form id="auth-form" className="flex flex-col gap-4" onSubmit={onSubmit}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="auth-email">Email</Label>
              <Input
                ref={emailRef}
                id="auth-email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                spellCheck={false}
                placeholder="name@example.com…"
                aria-invalid={emailError ? true : undefined}
                aria-describedby={emailError ? "auth-email-error" : undefined}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              {emailError ? <p id="auth-email-error" className="text-sm text-destructive" aria-live="polite">{emailError}</p> : null}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="auth-password">Password</Label>
              <Input
                ref={passwordRef}
                id="auth-password"
                name="password"
                type="password"
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                spellCheck={false}
                placeholder="Your password…"
                aria-invalid={passwordError ? true : undefined}
                aria-describedby={passwordError ? "auth-password-error" : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {passwordError ? <p id="auth-password-error" className="text-sm text-destructive" aria-live="polite">{passwordError}</p> : null}
            </div>
            {error ? <p ref={errorRef} tabIndex={-1} className="text-sm text-destructive" aria-live="polite">{error}</p> : null}
            {notice ? <p className="text-sm text-[var(--stat-strength-readable)]" aria-live="polite">{notice}</p> : null}
            <Button type="submit" disabled={busy} aria-busy={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              {mode === "signin" ? "Sign In" : "Sign Up"}
              {busy ? <span className="sr-only">{mode === "signin" ? "Signing in…" : "Creating account…"}</span> : null}
            </Button>
            <Button
              type="button"
              variant="link"
              onClick={() => {
                setMode(mode === "signin" ? "signup" : "signin");
                setError(null);
                setEmailError(null);
                setPasswordError(null);
                setNotice(null);
              }}
            >
              {mode === "signin" ? "New here? Create an account" : "Already have an account? Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function ConnectSleeper({
  email,
  loading,
  onConnected,
  onSignOut,
}: {
  email: string;
  loading: boolean;
  onConnected: () => Promise<void>;
  onSignOut: () => void;
}) {
  const [username, setUsername] = useState("");
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const usernameRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    document.title = "Connect Sleeper · Fantasy Rankings";
    const desktop = window.matchMedia("(pointer: fine) and (min-width: 760px)").matches;
    if (desktop) usernameRef.current?.focus();
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const nextUsername = username.trim();
    if (!nextUsername) {
      setUsernameError("Enter your Sleeper username.");
      setError(null);
      usernameRef.current?.focus();
      return;
    }
    setUsernameError(null);
    setBusy(true);
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("You are signed out. Sign in again, then connect Sleeper.");
      const res = await fetch("/api/user", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ username: nextUsername }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? "Could not connect that Sleeper username.");
      }
      await onConnected();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      errorRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-8 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))]">
      <SkipLink href="#connect-form">Skip to form</SkipLink>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">
            <h1>Connect <span translate="no">Sleeper</span></h1>
          </CardTitle>
          <CardDescription>
            Signed in as {email}. Enter your <span translate="no">Sleeper</span> username and we will pull in your leagues — no
            <span translate="no"> Sleeper</span> password needed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form id="connect-form" className="flex flex-col gap-4" onSubmit={onSubmit}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="sleeper-username"><span translate="no">Sleeper</span> username</Label>
              <Input
                ref={usernameRef}
                id="sleeper-username"
                name="username"
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                inputMode="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="sleepername…"
                aria-invalid={usernameError ? true : undefined}
                aria-describedby={usernameError ? "sleeper-username-error" : undefined}
              />
              {usernameError ? <p id="sleeper-username-error" className="text-sm text-destructive" aria-live="polite">{usernameError}</p> : null}
            </div>
            {error ? <p ref={errorRef} tabIndex={-1} className="text-sm text-destructive" aria-live="polite">{error}</p> : null}
            <Button type="submit" disabled={busy || loading} aria-busy={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              Connect
              {busy ? <span className="sr-only">Connecting…</span> : null}
            </Button>
            <Button type="button" variant="link" onClick={onSignOut}>
              Sign out
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
