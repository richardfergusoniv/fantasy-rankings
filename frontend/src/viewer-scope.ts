import { createContext, useContext } from "react";
import type { QueryClient } from "@tanstack/react-query";

/**
 * Who the personal cached data belongs to. `userId` is the verified Supabase
 * auth user id; `accountId` is the connected Sleeper account. Both go into
 * every personal query key so one viewer's cached leagues, news, draft and
 * saved views can never be read back by a different viewer in the same tab.
 */
export type ViewerIdentity = {
  userId: string;
  accountId: string | null;
};

/** Auth-free builds (local/preview without Supabase) share one local viewer. */
export const LOCAL_VIEWER: ViewerIdentity = { userId: "local", accountId: null };

export const ViewerIdentityContext = createContext<ViewerIdentity>(LOCAL_VIEWER);

export function useViewerIdentity(): ViewerIdentity {
  return useContext(ViewerIdentityContext);
}

/** Root segment of every per-viewer query key; clearing matches on it. */
export const PERSONAL_QUERY_PREFIX = "viewer";

export function viewerQueryScope(viewer: ViewerIdentity): readonly [string, string] {
  return [viewer.userId, viewer.accountId ?? "unconnected"];
}

export function personalQueryKey(viewer: ViewerIdentity, ...parts: readonly unknown[]): readonly unknown[] {
  return [PERSONAL_QUERY_PREFIX, ...viewerQueryScope(viewer), ...parts];
}

/** Drop every per-viewer query: cancels in-flight fetches first so a
 * previous viewer's response cannot land after the identity changed. */
export async function clearPersonalQueries(client: QueryClient): Promise<void> {
  await client.cancelQueries({ queryKey: [PERSONAL_QUERY_PREFIX] });
  client.removeQueries({ queryKey: [PERSONAL_QUERY_PREFIX] });
}

/** The signed-in session user plus the identity personal data is keyed by. */
export type ViewerSnapshot = { sessionUserId: string | null; identity: ViewerIdentity };

function sameViewer(a: ViewerSnapshot, b: ViewerSnapshot): boolean {
  return a.sessionUserId === b.sessionUserId
    && a.identity.userId === b.identity.userId
    && a.identity.accountId === b.identity.accountId;
}

/**
 * Snapshot who is signed in, and which Sleeper account is connected, when
 * personal async work starts. Clearing queries on sign-in doesn't reach
 * mutations, so a refresh user A started can resolve after B signs in (or
 * after A connects a different Sleeper account); check `stillCurrent()`
 * before saving or applying its result (or signing out on its error), and
 * key what you store by `startedBy`, so it is never stored under someone
 * else's identity.
 */
export async function snapshotViewer(readViewer: () => Promise<ViewerSnapshot>): Promise<{
  startedBy: ViewerSnapshot;
  stillCurrent: () => Promise<boolean>;
}> {
  const startedBy = await readViewer();
  return { startedBy, stillCurrent: async () => sameViewer(await readViewer(), startedBy) };
}
