import { describe, expect, it } from "vitest";
import {
  buildPlayerNewsNameIndex,
  resolveXNewsPlayer,
} from "./player-news-shared.js";
import {
  buildXNewsMentionNeedles,
  findMentionedPlayerIds,
  normalizeTextForMentions,
  resolveXNewsPlayerIdsForItem,
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
        author_handle: "beat",
        source_url: "https://x.com/b/status/1",
        post_id: "1",
        published_at: "2026-10-29T12:00:00.000Z",
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
        author_handle: "beat",
        source_url: "https://x.com/b/status/2",
        post_id: "2",
        published_at: "2026-10-29T12:00:00.000Z",
      },
      index,
      needles,
      resolveXNewsPlayer,
    );
    expect(ids).toEqual(["7547"]);
  });
});
