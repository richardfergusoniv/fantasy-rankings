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

/**
 * Snapshot who is signed in when personal async work starts. Clearing
 * queries on sign-in doesn't reach mutations, so a refresh user A started
 * can resolve after B signs in; check `stillCurrent()` before saving or
 * applying its result (or signing out on its error) so A's data is never
 * stored under B's identity.
 */
export async function snapshotViewer(readViewerId: () => Promise<string | null>): Promise<{
  startedBy: string | null;
  stillCurrent: () => Promise<boolean>;
}> {
  const startedBy = await readViewerId();
  return { startedBy, stillCurrent: async () => (await readViewerId()) === startedBy };
}
