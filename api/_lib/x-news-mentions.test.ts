import { describe, expect, it } from "vitest";
import {
  buildPlayerNewsNameIndex,
  resolveXNewsPlayer,
  type PlayerNewsNameIndexEntry,
} from "./player-news-shared.js";
import {
  X_NEWS_ATTACH_PLAYER_CAP_DEFAULT,
  X_NEWS_ATTACH_PLAYER_CAP_PRACTICE_REPORT,
  buildXNewsMentionNeedles,
  findMentionedPlayerIds,
  looksLikeXNewsPracticeOrInjuryReport,
  normalizeTextForMentions,
  resolveXNewsPlayerIdsForItem,
  xNewsAttachPlayerCap,
} from "./x-news-mentions.js";

const roster = [
  {
    playerId: "7547",
    player: "Amon-Ra St. Brown",
    team: "DET",
    firstName: "Amon-Ra",
    lastName: "St. Brown",
  },
  {
    playerId: "9221",
    player: "Jahmyr Gibbs",
    team: "DET",
    firstName: "Jahmyr",
    lastName: "Gibbs",
  },
  {
    playerId: "7564",
    player: "Ja'Marr Chase",
    team: "CIN",
    firstName: "Ja'Marr",
    lastName: "Chase",
  },
  {
    playerId: "4866",
    player: "A.J. Brown",
    team: "PHI",
    firstName: "A.J.",
    lastName: "Brown",
  },
  {
    playerId: "5323",
    player: "Equanimeous St. Brown",
    team: "FA",
    firstName: "Equanimeous",
    lastName: "St. Brown",
  },
];

/** Synthetic skill players with unique two-token names for cap tests. */
function syntheticRoster(count: number): PlayerNewsNameIndexEntry[] {
  const out: PlayerNewsNameIndexEntry[] = [];
  for (let i = 1; i <= count; i += 1) {
    const n = String(i).padStart(2, "0");
    out.push({
      playerId: `syn${n}`,
      player: `Alpha${n} Bravo${n}`,
      team: "FA",
      firstName: `Alpha${n}`,
      lastName: `Bravo${n}`,
    });
  }
  return out;
}

function namesList(entries: PlayerNewsNameIndexEntry[]): string {
  return entries.map((e) => e.player).join(", ");
}

describe("x-news mention → player_id expansion", () => {
  const index = buildPlayerNewsNameIndex(roster);
  const needles = buildXNewsMentionNeedles(roster, index);

  it("normalizes text without alias-expanding the whole blob", () => {
    expect(normalizeTextForMentions("Amon-Ra DNP, Gibbs limited.")).toBe(
      "amon ra dnp gibbs limited",
    );
  });

  it("finds every full-name mention in a practice roundup", () => {
    const text =
      "NFL Week 8 Wednesday Practice Reports:\nDNP\n• Ja’Marr Chase, Bengals (ankle/rest)\n• Amon-Ra St. Brown, Lions (ankle)\n• Jahmyr Gibbs, Lions (shoulder)";
    const ids = findMentionedPlayerIds(text, needles);
    expect(ids.sort()).toEqual(["7547", "7564", "9221"]);
  });

  it("resolves short Amon-Ra extracts via first-name / alias needles", () => {
    const ids = findMentionedPlayerIds(
      "Wednesday practice: Amon-Ra DNP, Gibbs limited.",
      needles,
    );
    expect(ids).toContain("7547");
  });

  it("does not attach bare surname Brown without a unique multi-token needle", () => {
    expect(findMentionedPlayerIds("Brown looks limited today.", needles)).toEqual([]);
  });

  it("keeps the explicit extract and adds other text mentions", () => {
    const ids = resolveXNewsPlayerIdsForItem(
      {
        player_id: "7564",
        text: "Ja'Marr Chase DNP. Amon-Ra St. Brown also DNP. Jahmyr Gibbs limited.",
      },
      index,
      needles,
      resolveXNewsPlayer,
    );
    expect(ids.sort()).toEqual(["7547", "7564", "9221"]);
  });

  it("still resolves when the producer extract is only a short Amon-Ra name", () => {
    const ids = resolveXNewsPlayerIdsForItem(
      {
        player_name: "Amon-Ra",
        text: "Amon-Ra DNP for the Lions on Wednesday.",
      },
      index,
      needles,
      resolveXNewsPlayer,
    );
    expect(ids).toEqual(["7547"]);
  });
});

describe("x-news attach player caps", () => {
  it("uses default cap 6 and practice/injury cap 15", () => {
    expect(X_NEWS_ATTACH_PLAYER_CAP_DEFAULT).toBe(6);
    expect(X_NEWS_ATTACH_PLAYER_CAP_PRACTICE_REPORT).toBe(15);
    expect(xNewsAttachPlayerCap("My midseason WR rankings: …")).toBe(6);
    expect(xNewsAttachPlayerCap("Wednesday practice report — DNP and limited")).toBe(15);
    expect(looksLikeXNewsPracticeOrInjuryReport("Questionable, doubtful, OUT")).toBe(true);
    expect(looksLikeXNewsPracticeOrInjuryReport("Tier list without status words")).toBe(false);
  });

  it("expands a 2-player post under the default cap", () => {
    const entries = syntheticRoster(2);
    const index = buildPlayerNewsNameIndex(entries);
    const needles = buildXNewsMentionNeedles(entries, index);
    const text = `${entries[0]!.player} and ${entries[1]!.player} both looking strong this week.`;
    const ids = resolveXNewsPlayerIdsForItem(
      { player_id: "syn01", text },
      index,
      needles,
      resolveXNewsPlayer,
    );
    expect(ids.sort()).toEqual(["syn01", "syn02"]);
  });

  it("skips text expansion on an 8-name ranking post (explicit only)", () => {
    const entries = syntheticRoster(8);
    const index = buildPlayerNewsNameIndex(entries);
    const needles = buildXNewsMentionNeedles(entries, index);
    const text = `My WR rankings: ${namesList(entries)}`;
    const ids = resolveXNewsPlayerIdsForItem(
      { player_id: "syn01", text },
      index,
      needles,
      resolveXNewsPlayer,
    );
    expect(ids).toEqual(["syn01"]);
  });

  it("expands a 12-player practice report with DNP/limited under the raised cap", () => {
    const entries = syntheticRoster(12);
    const index = buildPlayerNewsNameIndex(entries);
    const needles = buildXNewsMentionNeedles(entries, index);
    const text =
      `NFL practice report — DNP / limited:\n` +
      entries.map((e, i) => `• ${e.player} (${i % 2 === 0 ? "DNP" : "limited"})`).join("\n");
    const ids = resolveXNewsPlayerIdsForItem(
      { player_id: "syn01", text },
      index,
      needles,
      resolveXNewsPlayer,
    );
    expect(ids.sort()).toEqual(entries.map((e) => e.playerId).sort());
    expect(ids).toHaveLength(12);
  });

  it("skips text expansion on a 20-name practice report above the practice cap", () => {
    const entries = syntheticRoster(20);
    const index = buildPlayerNewsNameIndex(entries);
    const needles = buildXNewsMentionNeedles(entries, index);
    const text =
      `Wednesday injury report / practice report:\n` +
      entries.map((e) => `• ${e.player} — DNP / limited / full participant`).join("\n");
    const ids = resolveXNewsPlayerIdsForItem(
      { player_id: "syn07", text },
      index,
      needles,
      resolveXNewsPlayer,
    );
    expect(ids).toEqual(["syn07"]);
  });
});
