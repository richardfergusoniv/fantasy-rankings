import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SkipLink } from "./shared";
import { ThemeToggle } from "./shell/theme-toggle";
import { getAccessToken, isSupabaseConfigured, supabase, type Session } from "./supabase";
import { identifyPostHogUser, resetPostHog } from "./posthog";
import { ViewerIdentityContext, clearPersonalQueries } from "./viewer-scope";

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

type ConnectionState =
  | { status: "loading" }
  | { status: "none" }
  | { status: "connected"; connection: NonNullable<SleeperConnection> }
  | { status: "error" };

type ConnectionResult =
  | { ok: true; connection: SleeperConnection }
  | { ok: false; reason: "unauthorized" | "error" };

async function fetchConnection(): Promise<ConnectionResult> {
  try {
    const token = await getAccessToken();
    if (!token) return { ok: false, reason: "unauthorized" };
    const res = await fetch("/api/user", {
      headers: { authorization: `Bearer ${token}` },
    });
    if (res.status === 401 || res.status === 403) return { ok: false, reason: "unauthorized" };
    if (!res.ok) return { ok: false, reason: "error" };
    const data = (await res.json()) as { connection: SleeperConnection };
    return { ok: true, connection: data.connection };
  } catch {
    return { ok: false, reason: "error" };
  }
}

type AuthContextValue = {
  email: string;
  connection: NonNullable<SleeperConnection>;
  refreshConnection: () => Promise<void>;
  signOut: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/** Signed-in account details for the connected app; null outside the auth gate. */
export function useAuth(): AuthContextValue | null {
  return useContext(AuthContext);
}

export function AuthGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [connState, setConnState] = useState<ConnectionState>({ status: "loading" });
  const [connLoading, setConnLoading] = useState(false);
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  // Generation counter: a connection lookup only applies its result while it
  // is still the latest request, so a slow response from a signed-out session
  // cannot overwrite (or sign out) the session that replaced it.
  const connRequestId = useRef(0);

  const signOut = useCallback(() => {
    localStorage.removeItem("fantasy-rankings-dashboard-v7");
    if (!supabase) return;
    void supabase.auth.signOut();
  }, []);

  const connectedAccountId = connState.status === "connected" ? connState.connection.sleeperUserId : null;
  const viewer = useMemo(
    () => ({
      userId: session?.user.id ?? "local",
      accountId: connectedAccountId,
    }),
    [session?.user.id, connectedAccountId],
  );

  const refreshConnection = useCallback(async () => {
    const requestId = ++connRequestId.current;
    setConnLoading(true);
    try {
      const result = await fetchConnection();
      if (requestId !== connRequestId.current) return;
      if (result.ok) {
        setConnState(
          result.connection
            ? { status: "connected", connection: result.connection }
            : { status: "none" },
        );
      } else if (result.reason === "unauthorized") {
        setAuthNotice("Your session expired. Sign in again.");
        signOut();
      } else {
        setConnState({ status: "error" });
      }
    } finally {
      if (requestId === connRequestId.current) {
        setConnLoading(false);
      }
    }
  }, [signOut]);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    let active = true;
    // Supabase also emits SIGNED_IN for the session already in use (e.g. on
    // tab refocus); only a different user should wipe personal queries.
    let viewerUserId: string | null | undefined;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      viewerUserId ??= data.session?.user.id ?? null;
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") {
        const nextUserId = next?.user.id ?? null;
        // Identity changed: drop every per-viewer query so the previous
        // viewer's leagues, news, draft and saved views cannot be read back.
        if (nextUserId !== viewerUserId) void clearPersonalQueries(queryClient);
        viewerUserId = nextUserId;
        queryClient.removeQueries({ queryKey: ["auth-user-id"] });
        queryClient.removeQueries({ queryKey: ["chat-list"] });
        queryClient.removeQueries({ queryKey: ["chat-availability"] });
      }
      if (event === "SIGNED_OUT") {
        setPasswordRecovery(false);
      }
      if (event === "PASSWORD_RECOVERY") {
        setPasswordRecovery(true);
      }
      setSession(next);
      setLoading(false);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    // Invalidate any in-flight lookup from a previous session.
    connRequestId.current += 1;
    if (session) {
      setConnState({ status: "loading" });
      void refreshConnection();
    } else {
      setConnState({ status: "none" });
      setConnLoading(false);
    }
  }, [session, refreshConnection]);

  // PostHog runs in identified-only mode (project setting): events from
  // anonymous browsers are dropped client-side. Identify as soon as a
  // session exists (Supabase user ID), then re-identify under the Sleeper
  // user ID once connected — PostHog merges the two profiles. Reset on
  // sign-out so the next user on this browser starts clean.
  const connection = connState.status === "connected" ? connState.connection : null;

  useEffect(() => {
    if (connection?.sleeperUserId) {
      identifyPostHogUser(connection.sleeperUserId, connection.sleeperUsername);
    } else if (session) {
      identifyPostHogUser(session.user.id);
    } else {
      resetPostHog();
    }
  }, [connection, session]);

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

  if (passwordRecovery && session) {
    return <UpdatePassword onDone={() => setPasswordRecovery(false)} />;
  }

  if (!session) {
    return <AuthScreen initialNotice={authNotice} />;
  }

  // Session exists but the Sleeper connection check has not come back yet
  // (e.g. a cold home-screen launch). Hold the loading screen instead of
  // flashing the connect screen at users who are already connected.
  if (connState.status === "loading") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background px-4 text-sm text-muted-foreground">
        <p>Loading…</p>
      </div>
    );
  }

  // The connection lookup failed (e.g. a backend outage). Show a retryable
  // error instead of pretending the Sleeper link vanished.
  if (connState.status === "error") {
    return <ServiceError onRetry={refreshConnection} onSignOut={signOut} retrying={connLoading} />;
  }

  if (!connection) {
    return (
      <ConnectSleeper
        email={session.user.email ?? ""}
        loading={connLoading}
        onConnected={refreshConnection}
        onSignOut={signOut}
      />
    );
  }

  return (
    <ViewerIdentityContext.Provider value={viewer}>
      <AuthContext.Provider
        value={{
          email: session.user.email ?? "",
          connection,
          refreshConnection,
          signOut,
        }}
      >
        <Fragment key={session.user.id}>{children}</Fragment>
      </AuthContext.Provider>
    </ViewerIdentityContext.Provider>
  );
}

function ServiceError({
  onRetry,
  onSignOut,
  retrying,
}: {
  onRetry: () => Promise<void>;
  onSignOut: () => void;
  retrying: boolean;
}) {
  useEffect(() => {
    document.title = "Something went wrong · Fantasy Rankings";
  }, []);

  return (
    <div role="main" className="relative flex min-h-dvh items-center justify-center bg-background px-4 py-8 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))]">
      <div className="absolute right-2 top-[max(0.5rem,env(safe-area-inset-top))]"><ThemeToggle /></div>
      <Card className="w-full max-w-sm py-6">
        <CardHeader>
          <CardTitle className="text-2xl">
            <h1>Something went wrong</h1>
          </CardTitle>
          <CardDescription>
            Fantasy Rankings is having trouble right now. Try again in a moment.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            <Button type="button" onClick={() => void onRetry()} disabled={retrying} aria-busy={retrying}>
              {retrying ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              Try again
            </Button>
            <Button type="button" variant="link" onClick={onSignOut}>
              Sign out
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function UpdatePassword({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    document.title = "New Password · Fantasy Rankings";
    const desktop = window.matchMedia("(pointer: fine) and (min-width: 760px)").matches;
    if (desktop) passwordRef.current?.focus();
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!password) {
      setError("Enter a new password.");
      passwordRef.current?.focus();
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (!supabase) return;
    setBusy(true);
    setError(null);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      errorRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="main" className="relative flex min-h-dvh items-center justify-center bg-background px-4 py-8 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))]">
      <div className="absolute right-2 top-[max(0.5rem,env(safe-area-inset-top))]"><ThemeToggle /></div>
      <Card className="w-full max-w-sm py-6">
        <CardHeader>
          <CardTitle className="text-2xl">
            <h1>Choose a new password</h1>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={onSubmit}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="new-password">New password</Label>
              <Input
                ref={passwordRef}
                id="new-password"
                name="new-password"
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="confirm-password">Confirm password</Label>
              <Input
                id="confirm-password"
                name="confirm-password"
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            {error ? <p ref={errorRef} tabIndex={-1} className="text-sm text-[var(--danger-text)]" aria-live="polite">{error}</p> : null}
            <Button type="submit" disabled={busy} aria-busy={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              Save password
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function AuthScreen({ initialNotice }: { initialNotice?: string | null }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(initialNotice ?? null);
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

  async function onResetPassword() {
    const nextEmail = email.trim();
    if (!nextEmail) {
      setEmailError("Enter your email address.");
      emailRef.current?.focus();
      return;
    }
    if (!supabase) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(nextEmail, {
        redirectTo: window.location.origin,
      });
      if (resetError) throw resetError;
      setNotice("Check your email for a password reset link.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      errorRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="main" className="relative flex min-h-dvh items-center justify-center bg-background px-4 py-8 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))]">
      <div className="absolute right-2 top-[max(0.5rem,env(safe-area-inset-top))]"><ThemeToggle /></div>
      <SkipLink href="#auth-form">Skip to form</SkipLink>
      <Card className="w-full max-w-sm py-6">
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
              {emailError ? <p id="auth-email-error" className="text-sm text-[var(--danger-text)]" aria-live="polite">{emailError}</p> : null}
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
              {passwordError ? <p id="auth-password-error" className="text-sm text-[var(--danger-text)]" aria-live="polite">{passwordError}</p> : null}
            </div>
            {error ? <p ref={errorRef} tabIndex={-1} className="text-sm text-[var(--danger-text)]" aria-live="polite">{error}</p> : null}
            {notice ? <p className="text-sm text-[var(--stat-strength-readable)]" aria-live="polite">{notice}</p> : null}
            <Button type="submit" disabled={busy} aria-busy={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              {mode === "signin" ? "Sign In" : "Sign Up"}
              {busy ? <span className="sr-only">{mode === "signin" ? "Signing in…" : "Creating account…"}</span> : null}
            </Button>
            {mode === "signin" ? (
              <Button type="button" variant="link" onClick={() => void onResetPassword()} disabled={busy}>
                Forgot password?
              </Button>
            ) : null}
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
    <div role="main" className="relative flex min-h-dvh items-center justify-center bg-background px-4 py-8 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))]">
      <div className="absolute right-2 top-[max(0.5rem,env(safe-area-inset-top))]"><ThemeToggle /></div>
      <SkipLink href="#connect-form">Skip to form</SkipLink>
      <Card className="w-full max-w-sm py-6">
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
              {usernameError ? <p id="sleeper-username-error" className="text-sm text-[var(--danger-text)]" aria-live="polite">{usernameError}</p> : null}
            </div>
            {error ? <p ref={errorRef} tabIndex={-1} className="text-sm text-[var(--danger-text)]" aria-live="polite">{error}</p> : null}
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
