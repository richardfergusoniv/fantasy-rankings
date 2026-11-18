import { drizzleBuildLeaseStore, type BuildLeaseStore } from "./build-lease.js";

/**
 * Single-flight for one chat send, across serverless instances.
 *
 * A send carries a client-generated key that is stable across retries. The
 * stored turn is the finished record (see findChatTurnByClientMessageId), but
 * it only exists after the model call. Without a claim, a retry that arrives
 * while the first request is still running finds nothing and starts a second
 * model call, repeating any preference tool the first one ran.
 *
 * The claim reuses the deployment-wide lease table: claiming is an atomic
 * conditional upsert, so exactly one request per key runs the model. A retry
 * that loses the claim waits for the winner's stored turn and replays it. A
 * winner that fails releases the claim at once, so the retry can take over
 * without waiting for the lease to expire.
 */

/** A bit past the function limit (60s), so a crashed holder frees the key soon after. */
export const CHAT_TURN_LEASE_MS = 75_000;
/** How long a retry waits for the original request before giving up with "in progress". */
export const CHAT_TURN_WAIT_MS = 40_000;
const POLL_MS = 600;

export type ChatTurnClaim =
  | {
    status: "claimed";
    /** Give the claim up. Pass the error when the turn failed so a retry can start straight away. */
    release: (error?: unknown) => Promise<void>;
  }
  /** Another request is working on this key and did not finish in time. */
  | { status: "busy" }
  /** The finished turn appeared while waiting; the caller replays it. */
  | { status: "replay" }
  /** The lease store is unreachable. Callers carry on without single-flight. */
  | { status: "unavailable" };

export type ChatTurnClaimDeps = {
  store: BuildLeaseStore;
  /** True once the turn for this key is stored. */
  turnStored: () => Promise<boolean>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  holder: () => string;
};

const defaultDeps = (turnStored: () => Promise<boolean>): ChatTurnClaimDeps => ({
  store: drizzleBuildLeaseStore,
  turnStored,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
  holder: () => crypto.randomUUID(),
});

export function chatTurnResource(userId: string, clientMessageId: string): string {
  return `chat-turn:${userId}:${clientMessageId}`;
}

export async function claimChatTurn(
  resource: string,
  turnStored: () => Promise<boolean>,
  overrides: Partial<ChatTurnClaimDeps> = {},
): Promise<ChatTurnClaim> {
  const deps = { ...defaultDeps(turnStored), ...overrides };
  const holder = deps.holder();
  const deadline = deps.now() + CHAT_TURN_WAIT_MS;

  try {
    for (;;) {
      if (await deps.store.claim(resource, holder, CHAT_TURN_LEASE_MS)) {
        // The winner may have finished between our last check and this claim.
        if (await deps.turnStored()) {
          await deps.store.finish(resource, holder, null).catch(() => undefined);
          return { status: "replay" };
        }
        return {
          status: "claimed",
          release: async (error) => {
            await deps.store
              .finish(resource, holder, error == null ? null : errorText(error))
              .catch((err) => console.error("[chat turn claim] release", err instanceof Error ? err.message : err));
          },
        };
      }
      if (await deps.turnStored()) return { status: "replay" };
      if (deps.now() >= deadline) return { status: "busy" };
      await deps.sleep(POLL_MS);
    }
  } catch (err) {
    console.error("[chat turn claim] unavailable", err instanceof Error ? err.message : err);
    return { status: "unavailable" };
  }
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}
