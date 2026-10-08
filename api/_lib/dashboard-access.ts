/**
 * Who may see a dashboard. Signed-out callers get nothing, including the
 * owner's stored snapshot. A signed-in user gets their own cache or a
 * fresh build. The stored owner snapshot is only a fallback when the
 * signed-in Sleeper id is the scheduled owner.
 */

export const SIGN_IN_REQUIRED = "Sign in required.";

export type DashboardDenial = {
  ok: false;
  status: 401;
  error: typeof SIGN_IN_REQUIRED;
};

export type DashboardGrant<T> = {
  ok: true;
  status: 200;
  dashboard: T;
  source: "own" | "owner-snapshot" | "built";
};

export type ViewerDashboard<T> = DashboardDenial | DashboardGrant<T>;

type ViewerLoaders<T> = {
  sleeperUserId: string | null;
  ownerSleeperUserId: string | null;
  loadFreshOwn: (sleeperUserId: string) => Promise<T | null>;
  loadOwnerSnapshot: () => Promise<T | null>;
  buildOwn: (sleeperUserId: string) => Promise<T>;
};

function isScheduledOwner(sleeperUserId: string, ownerSleeperUserId: string | null): boolean {
  return Boolean(ownerSleeperUserId) && sleeperUserId === ownerSleeperUserId;
}

/**
 * Full dashboard read. `loadOwnerSnapshot` and `buildOwn` are not called
 * for a signed-out viewer. A signed-in user who is not the scheduled owner
 * never reads the owner snapshot.
 */
export async function dashboardForViewer<T>(args: ViewerLoaders<T> & { force: boolean }): Promise<ViewerDashboard<T>> {
  if (!args.sleeperUserId) {
    return { ok: false, status: 401, error: SIGN_IN_REQUIRED };
  }
  const sleeperUserId = args.sleeperUserId;
  if (!args.force) {
    const own = await args.loadFreshOwn(sleeperUserId);
    if (own) return { ok: true, status: 200, dashboard: own, source: "own" };
    if (isScheduledOwner(sleeperUserId, args.ownerSleeperUserId)) {
      const snapshot = await args.loadOwnerSnapshot();
      if (snapshot) return { ok: true, status: 200, dashboard: snapshot, source: "owner-snapshot" };
    }
  }
  const built = await args.buildOwn(sleeperUserId);
  return { ok: true, status: 200, dashboard: built, source: "built" };
}

export type SectionDashboard<T> =
  | DashboardDenial
  | { ok: true; status: 200; dashboard: T | null; source: "own" | "owner-snapshot" | "empty" };

/**
 * Section read. Same sign-in rule. A cold cache is `dashboard: null` so the
 * client can keep polling; it is never filled from the owner snapshot
 * unless this viewer is the scheduled owner.
 */
export async function sectionDashboardForViewer<T>(args: {
  sleeperUserId: string | null;
  ownerSleeperUserId: string | null;
  loadOwn: (sleeperUserId: string) => Promise<T | null>;
  loadOwnerSnapshot: () => Promise<T | null>;
}): Promise<SectionDashboard<T>> {
  if (!args.sleeperUserId) {
    return { ok: false, status: 401, error: SIGN_IN_REQUIRED };
  }
  const own = await args.loadOwn(args.sleeperUserId);
  if (own) return { ok: true, status: 200, dashboard: own, source: "own" };
  if (isScheduledOwner(args.sleeperUserId, args.ownerSleeperUserId)) {
    const snapshot = await args.loadOwnerSnapshot();
    return { ok: true, status: 200, dashboard: snapshot, source: snapshot ? "owner-snapshot" : "empty" };
  }
  return { ok: true, status: 200, dashboard: null, source: "empty" };
}
