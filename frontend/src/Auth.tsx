import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "signup") {
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (signUpError) throw signUpError;
        setNotice("Check your email to confirm your account, then sign in.");
        setMode("signin");
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-8 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))]">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">
            <h1>Fantasy Rankings</h1>
          </CardTitle>
          <CardDescription>
            {mode === "signin" ? "Sign in to see your leagues." : "Create an account to get started."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={onSubmit}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="auth-email">Email</Label>
              <Input
                id="auth-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="auth-password">Password</Label>
              <Input
                id="auth-password"
                type="password"
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            {notice ? <p className="text-sm text-[var(--stat-strength-readable)]">{notice}</p> : null}
            <Button type="submit" disabled={busy}>
              {busy ? "…" : mode === "signin" ? "Sign in" : "Sign up"}
            </Button>
            <Button
              type="button"
              variant="link"
              onClick={() => {
                setMode(mode === "signin" ? "signup" : "signin");
                setError(null);
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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("You are signed out. Please sign in again.");
      const res = await fetch("/api/user", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ username: username.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? "Could not connect that Sleeper username.");
      }
      await onConnected();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-8 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))]">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">
            <h1>Connect Sleeper</h1>
          </CardTitle>
          <CardDescription>
            Signed in as {email}. Enter your Sleeper username and we will pull in your leagues — no
            Sleeper password needed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={onSubmit}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="sleeper-username">Sleeper username</Label>
              <Input
                id="sleeper-username"
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. rdfergus15"
              />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" disabled={busy || loading}>
              {busy ? "Connecting…" : "Connect"}
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
