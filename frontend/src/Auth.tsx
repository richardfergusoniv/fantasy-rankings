import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
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

  const refreshConnection = useCallback(async () => {
    setConnLoading(true);
    try {
      setConnection(await fetchConnection());
    } finally {
      setConnLoading(false);
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
      void refreshConnection();
    } else {
      setConnection(null);
    }
  }, [session, refreshConnection]);

  if (!isSupabaseConfigured || !supabase) {
    return <>{children}</>;
  }

  if (loading) {
    return (
      <div className="auth-screen">
        <p className="auth-loading">Loading…</p>
      </div>
    );
  }

  if (!session) {
    return <AuthScreen />;
  }

  if (!connection) {
    return (
      <ConnectSleeper
        email={session.user.email ?? ""}
        loading={connLoading}
        onConnected={refreshConnection}
        onSignOut={() => void supabase.auth.signOut()}
      />
    );
  }

  return (
    <>
      <SignedInBar
        username={connection.sleeperUsername}
        onSignOut={() => void supabase.auth.signOut()}
      />
      {children}
    </>
  );
}

function SignedInBar({ username, onSignOut }: { username: string; onSignOut: () => void }) {
  return (
    <div className="auth-bar">
      <span className="auth-bar-user">Sleeper: {username}</span>
      <button type="button" className="auth-bar-signout" onClick={onSignOut}>
        Sign out
      </button>
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
        const { error: signUpError } = await supabase.auth.signUp({ email, password });
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
    <div className="auth-screen">
      <form className="auth-card" onSubmit={onSubmit}>
        <h1 className="auth-title">Fantasy Rankings</h1>
        <p className="auth-subtitle">
          {mode === "signin" ? "Sign in to see your leagues." : "Create an account to get started."}
        </p>
        <label className="auth-field">
          <span>Email</span>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="auth-field">
          <span>Password</span>
          <input
            type="password"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error ? <p className="auth-error">{error}</p> : null}
        {notice ? <p className="auth-notice">{notice}</p> : null}
        <button type="submit" className="auth-submit" disabled={busy}>
          {busy ? "…" : mode === "signin" ? "Sign in" : "Sign up"}
        </button>
        <button
          type="button"
          className="auth-switch"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
            setNotice(null);
          }}
        >
          {mode === "signin" ? "New here? Create an account" : "Already have an account? Sign in"}
        </button>
      </form>
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
    <div className="auth-screen">
      <form className="auth-card" onSubmit={onSubmit}>
        <h1 className="auth-title">Connect Sleeper</h1>
        <p className="auth-subtitle">
          Signed in as {email}. Enter your Sleeper username and we will pull in your leagues — no
          Sleeper password needed.
        </p>
        <label className="auth-field">
          <span>Sleeper username</span>
          <input
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="e.g. rdfergus15"
          />
        </label>
        {error ? <p className="auth-error">{error}</p> : null}
        <button type="submit" className="auth-submit" disabled={busy || loading}>
          {busy ? "Connecting…" : "Connect"}
        </button>
        <button type="button" className="auth-switch" onClick={onSignOut}>
          Sign out
        </button>
      </form>
    </div>
  );
}
