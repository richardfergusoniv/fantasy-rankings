import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveSleeperUserIdMock = vi.fn();
const viewerUsesValueHistoryFormatMock = vi.fn();

vi.mock("./auth.js", () => ({
  resolveSleeperUserId: (...args: unknown[]) => resolveSleeperUserIdMock(...args),
}));

vi.mock("./viewer-league-access.js", () => ({
  viewerUsesValueHistoryFormat: (...args: unknown[]) => viewerUsesValueHistoryFormatMock(...args),
}));

vi.mock("./db.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(async () => []),
        })),
      })),
    })),
  },
  schema: {
    playerValueSnapshots: {
      playerId: "player_id",
      snapshotDate: "snapshot_date",
      formatKey: "format_key",
      playerName: "player_name",
      position: "position",
      value: "value",
    },
  },
}));

import { handleValueHistory } from "./value-history.js";

beforeEach(() => {
  resolveSleeperUserIdMock.mockReset();
  viewerUsesValueHistoryFormatMock.mockReset();
});

describe("handleValueHistory membership gate", () => {
  it("requires sign-in", async () => {
    resolveSleeperUserIdMock.mockResolvedValue(null);
    const res = await handleValueHistory(
      new Request("https://example.com/api/value-history?formatKey=redraft-1qb-12t-0.5ppr&playerIds=p1"),
    );
    expect(res.status).toBe(401);
    expect(viewerUsesValueHistoryFormatMock).not.toHaveBeenCalled();
  });

  it("forbids format keys outside the viewer's leagues", async () => {
    resolveSleeperUserIdMock.mockResolvedValue("sleeper-1");
    viewerUsesValueHistoryFormatMock.mockResolvedValue(false);
    const res = await handleValueHistory(
      new Request("https://example.com/api/value-history?formatKey=redraft-1qb-10t-0.5ppr&playerIds=p1"),
    );
    expect(res.status).toBe(403);
    expect(viewerUsesValueHistoryFormatMock).toHaveBeenCalledWith("sleeper-1", "redraft-1qb-10t-0.5ppr");
  });
});
