import { Loader2, UserRound } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "../Auth";
import { authErrorMessage } from "../lib/auth-error-message";
import { getAccessToken, supabase } from "../supabase";

const SUPPORT_EMAIL = "richard.ferguson.iv@gmail.com";

/** Account menu for the connected app: sign out, password reset, Sleeper link. */
export function AccountMenu() {
  const auth = useAuth();
  if (!auth || !supabase) return null;
  return <AccountMenuDialog email={auth.email} connection={auth.connection} refreshConnection={auth.refreshConnection} signOut={auth.signOut} />;
}

function AccountMenuDialog({
  email,
  connection,
  refreshConnection,
  signOut,
}: {
  email: string;
  connection: { sleeperUserId: string; sleeperUsername: string };
  refreshConnection: () => Promise<void>;
  signOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"reset" | "unlink" | null>(null);

  async function onResetPassword() {
    if (!supabase || !email) return;
    setBusy("reset");
    setNotice(null);
    setError(null);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      });
      if (resetError) throw resetError;
      setNotice("Check your email for a password reset link.");
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function onSwitchAccount() {
    setBusy("unlink");
    setNotice(null);
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("You are signed out. Sign in again.");
      const res = await fetch("/api/user", {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Could not unlink that Sleeper account.");
      await refreshConnection();
      setOpen(false);
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <button
        type="button"
        className="account-button"
        onClick={() => {
          setNotice(null);
          setError(null);
          setOpen(true);
        }}
        aria-label="Account"
        title="Account"
      >
        <UserRound className="size-[18px]" aria-hidden="true" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="account-dialog" aria-describedby="account-description">
          <DialogCloseButton label="Close account menu" />
          <DialogHeader className="pr-8">
            <DialogTitle>Account</DialogTitle>
            <DialogDescription id="account-description">
              Signed in as {email}. Linked to <span translate="no">Sleeper</span> as {connection.sleeperUsername}.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            {error ? <p className="text-sm text-[var(--danger-text)]" aria-live="polite">{error}</p> : null}
            {notice ? <p className="text-sm text-[var(--stat-strength-readable)]" aria-live="polite">{notice}</p> : null}
            <Button type="button" variant="outline" onClick={() => void onResetPassword()} disabled={busy !== null} aria-busy={busy === "reset"}>
              {busy === "reset" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              Email me a password reset
            </Button>
            <Button type="button" variant="outline" onClick={() => void onSwitchAccount()} disabled={busy !== null} aria-busy={busy === "unlink"}>
              {busy === "unlink" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              Switch <span translate="no">Sleeper</span> account
            </Button>
            <Button type="button" variant="outline" onClick={signOut} disabled={busy !== null}>
              Sign out
            </Button>
            <Button type="button" variant="link" asChild>
              <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Fantasy Rankings account help")}`}>
                Contact support or delete account
              </a>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
