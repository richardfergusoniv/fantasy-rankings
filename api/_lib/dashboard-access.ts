/**
 * Who may see a dashboard. Signed-out callers get nothing, including the
 * owner's stored snapshot. A signed-in user gets their own cache or a
 * fresh build. The stored owner snapshot is only a fallback when the
 * viewer is the scheduled owner (Supabase OWNER_USER_ID when set; otherwise
 * matching OWNER_SLEEPER_USER_ID).
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
  /** Supabase Auth user id for the signed-in viewer (null when unsigned). */
  viewerUserId?: string | null;
  ownerSleeperUserId: string | null;
  /** Supabase Auth user id of the scheduled owner from env (preferred). */
  ownerUserId?: string | null;
  loadFreshOwn: (sleeperUserId: string) => Promise<T | null>;
  loadOwnerSnapshot: () => Promise<T | null>;
  buildOwn: (sleeperUserId: string) => Promise<T>;
};

/**
 * Owner privileges prefer a server-held Supabase user id. When that env is
 * unset, fall back to the configured owner Sleeper id so existing deploys
 * keep working. A caller-chosen Sleeper username alone is never enough when
 * OWNER_USER_ID is configured.
 */
export function isScheduledOwner(args: {
  sleeperUserId: string;
  viewerUserId?: string | null;
  ownerSleeperUserId: string | null;
  ownerUserId?: string | null;
}): boolean {
  if (args.ownerUserId) {
    return Boolean(args.viewerUserId) && args.viewerUserId === args.ownerUserId;
  }
  return Boolean(args.ownerSleeperUserId) && args.sleeperUserId === args.ownerSleeperUserId;
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
    if (
      isScheduledOwner({
        sleeperUserId,
        viewerUserId: args.viewerUserId,
        ownerSleeperUserId: args.ownerSleeperUserId,
        ownerUserId: args.ownerUserId,
      })
    ) {
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
  viewerUserId?: string | null;
  ownerSleeperUserId: string | null;
  ownerUserId?: string | null;
  loadOwn: (sleeperUserId: string) => Promise<T | null>;
  loadOwnerSnapshot: () => Promise<T | null>;
}): Promise<SectionDashboard<T>> {
  if (!args.sleeperUserId) {
    return { ok: false, status: 401, error: SIGN_IN_REQUIRED };
  }
  const own = await args.loadOwn(args.sleeperUserId);
  if (own) return { ok: true, status: 200, dashboard: own, source: "own" };
  if (
    isScheduledOwner({
      sleeperUserId: args.sleeperUserId,
      viewerUserId: args.viewerUserId,
      ownerSleeperUserId: args.ownerSleeperUserId,
      ownerUserId: args.ownerUserId,
    })
  ) {
    const snapshot = await args.loadOwnerSnapshot();
    return { ok: true, status: 200, dashboard: snapshot, source: snapshot ? "owner-snapshot" : "empty" };
  }
  return { ok: true, status: 200, dashboard: null, source: "empty" };
}
