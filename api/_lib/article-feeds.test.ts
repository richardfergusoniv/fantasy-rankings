import { describe, expect, it } from "vitest";
import {
  ARTICLE_FEED_SOURCES,
  articleExternalId,
  assignArticleScope,
  buildArticleNewsDrafts,
  canonicalArticleUrl,
  detectArticleTeam,
  detectPffPremiumFromHtml,
  filterArticleHeadline,
  matchArticlePlayers,
  normalizeHeadlineKey,
  parseFeedXml,
  passesHeadlineNoiseFilter,
  truncateSummary,
  type ArticleFeedSource,
} from "./article-feeds.js";
import {
  buildPlayerNewsNameIndex,
  type PlayerNewsNameIndexEntry,
} from "./player-news-shared.js";
import { buildXNewsMentionNeedles } from "./x-news-mentions.js";

const fantasyPros: ArticleFeedSource = ARTICLE_FEED_SOURCES.find((s) => s.name === "FantasyPros")!;
const pff: ArticleFeedSource = ARTICLE_FEED_SOURCES.find((s) => s.name === "PFF")!;

function roster(entries: PlayerNewsNameIndexEntry[]) {
  const index = buildPlayerNewsNameIndex(entries);
  const needles = buildXNewsMentionNeedles(entries, index);
  return { index, needles };
}

describe("headline noise filter", () => {
  it("drops other sports, betting, how-to-watch, galleries, mocks, quizzes, merch, hot takes", () => {
    expect(passesHeadlineNoiseFilter({ title: "NBA DFS slate", url: "https://x.com/a" }).pass).toBe(false);
    expect(passesHeadlineNoiseFilter({ title: "Best bets for Sunday", url: "https://x.com/a" }).pass).toBe(false);
    expect(passesHeadlineNoiseFilter({ title: "How to watch the Chiefs", url: "https://x.com/a" }).pass).toBe(false);
    expect(passesHeadlineNoiseFilter({ title: "Photo gallery: Week 8", url: "https://x.com/a" }).pass).toBe(false);
    expect(passesHeadlineNoiseFilter({ title: "Seven-round mock draft", url: "https://x.com/a" }).pass).toBe(false);
    expect(passesHeadlineNoiseFilter({ title: "Fantasy quiz: name that WR", url: "https://x.com/a" }).pass).toBe(false);
    expect(passesHeadlineNoiseFilter({ title: "New merch drop for fans", url: "https://x.com/a" }).pass).toBe(false);
    expect(passesHeadlineNoiseFilter({ title: "Skip Bayless reacts", url: "https://x.com/a" }).pass).toBe(false);
  });

  it("keeps fantasy-relevant NFL headlines", () => {
    expect(
      passesHeadlineNoiseFilter({
        title: "Justin Jefferson returns to practice",
        url: "https://www.fantasypros.com/nfl/news/jefferson",
      }).pass,
    ).toBe(true);
  });
});

describe("filterArticleHeadline", () => {
  it("requires NFL category for FantasyPros", () => {
    const without = filterArticleHeadline(
      fantasyPros,
      {
        title: "Justin Jefferson injury update",
        url: "https://www.fantasypros.com/dfs/news/x",
        categories: ["DFS"],
      },
      true,
    );
    expect(without.pass).toBe(false);
    expect(without.reason).toBe("allowlist");

    const withNfl = filterArticleHeadline(
      fantasyPros,
      {
        title: "Justin Jefferson injury update",
        url: "https://www.fantasypros.com/nfl/news/x",
        categories: ["NFL"],
      },
      true,
    );
    expect(withNfl.pass).toBe(true);
  });

  it("requires a player mention or roster-action term", () => {
    const drop = filterArticleHeadline(
      fantasyPros,
      {
        title: "Week 9 NFL schedule preview",
        url: "https://www.fantasypros.com/nfl/schedule-preview",
        categories: ["NFL"],
      },
      false,
    );
    expect(drop.pass).toBe(false);
    expect(drop.reason).toBe("no_player_or_roster");

    const keep = filterArticleHeadline(
      fantasyPros,
      {
        title: "Waiver wire adds for Week 9",
        url: "https://www.fantasypros.com/nfl/waiver",
        categories: ["NFL"],
      },
      false,
    );
    expect(keep.pass).toBe(true);
  });

  it("keeps PFF NFL / Fantasy / Team & Player News categories", () => {
    expect(
      filterArticleHeadline(
        pff,
        {
          title: "Christian McCaffrey usage report",
          url: "https://www.pff.com/news/nfl-mccaffrey",
          categories: ["NFL"],
        },
        true,
      ).pass,
    ).toBe(true);
    expect(
      filterArticleHeadline(
        pff,
        {
          title: "College prospect watch",
          url: "https://www.pff.com/news/cfb",
          categories: ["College"],
        },
        true,
      ).pass,
    ).toBe(false);
  });
});

describe("canonical URL dedupe", () => {
  it("strips tracking params and normalizes host/trailing slash", () => {
    expect(
      canonicalArticleUrl(
        "https://WWW.FantasyPros.com/nfl/news/jefferson/?utm_source=twitter&utm_medium=social&fbclid=abc#section",
      ),
    ).toBe("https://www.fantasypros.com/nfl/news/jefferson");
  });

  it("normalizes headlines for 24h dedupe", () => {
    expect(normalizeHeadlineKey("Justin Jefferson: Injury Update!")).toBe(
      normalizeHeadlineKey("justin jefferson injury update"),
    );
  });
});

describe("surname false positives", () => {
  const entries: PlayerNewsNameIndexEntry[] = [
    { playerId: "allen-buf", player: "Josh Allen", team: "BUF", firstName: "Josh", lastName: "Allen" },
    { playerId: "allen-lac", player: "Keenan Allen", team: "LAC", firstName: "Keenan", lastName: "Allen" },
    { playerId: "williams-chi", player: "Caleb Williams", team: "CHI", firstName: "Caleb", lastName: "Williams" },
    { playerId: "williams-gb", player: "Jameson Williams", team: "DET", firstName: "Jameson", lastName: "Williams" },
    { playerId: "brown-phi", player: "A.J. Brown", team: "PHI", firstName: "A.J.", lastName: "Brown" },
    { playerId: "brown-kc", player: "Noah Brown", team: "WAS", firstName: "Noah", lastName: "Brown" },
    { playerId: "jones-gb", player: "Aaron Jones", team: "MIN", firstName: "Aaron", lastName: "Jones" },
    { playerId: "jones-nyj", player: "Tony Jones", team: "ARI", firstName: "Tony", lastName: "Jones" },
    { playerId: "smith-phi", player: "DeVonta Smith", team: "PHI", firstName: "DeVonta", lastName: "Smith" },
    { playerId: "smith-kc", player: "JuJu Smith-Schuster", team: "KC", firstName: "JuJu", lastName: "Smith-Schuster" },
    { playerId: "unique-gb", player: "Romeo Doubs", team: "GB", firstName: "Romeo", lastName: "Doubs" },
  ];
  const { index, needles } = roster(entries);

  it("does not match bare Allen/Williams/Brown/Jones/Smith without team", () => {
    for (const surname of ["Allen", "Williams", "Brown", "Jones", "Smith"]) {
      const hits = matchArticlePlayers(`${surname} is questionable for Sunday`, index, needles, null);
      expect(hits, surname).toEqual([]);
    }
  });

  it("matches full first+last names", () => {
    expect(matchArticlePlayers("Josh Allen leads Bills", index, needles, null)).toEqual(["allen-buf"]);
    expect(matchArticlePlayers("A.J. Brown returns", index, needles, null)).toEqual(["brown-phi"]);
    expect(matchArticlePlayers("DeVonta Smith targeted", index, needles, null)).toEqual(["smith-phi"]);
  });

  it("allows last-name-only when team matches and surname is unique on that team", () => {
    expect(matchArticlePlayers("Doubs limited in practice", index, needles, "GB")).toEqual(["unique-gb"]);
  });

  it("does not attach a different Allen via team hint when Josh Allen is named", () => {
    // Packers blog teamHint=GB must not also attach a GB Allen when the article is about Josh Allen.
    const hits = matchArticlePlayers("Josh Allen torches the Packers secondary", index, needles, "GB");
    expect(hits).toEqual(["allen-buf"]);
  });
});

describe("scope assignment", () => {
  it("fans out to matched players under the cap", () => {
    const assignment = assignArticleScope({
      text: "Justin Jefferson and CeeDee Lamb",
      matchedPlayerIds: ["a", "b"],
      team: null,
      fantasyRelevant: true,
    });
    expect(assignment).toEqual({ scope: "player", playerIds: ["a", "b"] });
  });

  it("stores one league row when over the attach cap", () => {
    const ids = Array.from({ length: 7 }, (_, i) => `p${i}`);
    const assignment = assignArticleScope({
      text: "Rankings roundup",
      matchedPlayerIds: ids,
      team: "MIN",
      fantasyRelevant: true,
    });
    expect(assignment).toEqual({ scope: "league" });
  });

  it("uses team scope when only a team is known", () => {
    expect(
      assignArticleScope({
        text: "Chiefs depth chart update",
        matchedPlayerIds: [],
        team: "KC",
        fantasyRelevant: true,
      }),
    ).toEqual({ scope: "team", team: "KC" });
  });

  it("uses league scope for fantasy-relevant items with no player or team", () => {
    expect(
      assignArticleScope({
        text: "Waiver wire priorities",
        matchedPlayerIds: [],
        team: null,
        fantasyRelevant: true,
      }),
    ).toEqual({ scope: "league" });
  });

  it("raises the cap for practice / injury report style text", () => {
    const ids = Array.from({ length: 12 }, (_, i) => `p${i}`);
    const assignment = assignArticleScope({
      text: "Injury report: full participant list",
      matchedPlayerIds: ids,
      team: null,
      fantasyRelevant: true,
    });
    expect(assignment).toEqual({ scope: "player", playerIds: ids });
  });
});

describe("buildArticleNewsDrafts", () => {
  const source = fantasyPros;
  const item = {
    title: "Justin Jefferson returns",
    url: "https://www.fantasypros.com/nfl/news/jefferson",
    guid: "guid-1",
    publishedAt: new Date("2026-10-30T12:00:00Z"),
    summary: "Jefferson was a full participant.",
    categories: ["NFL"],
  };

  it("maps headline/summary/outlet onto shared news fields", () => {
    const drafts = buildArticleNewsDrafts({
      source,
      item,
      headline: item.title,
      summary: item.summary,
      assignment: { scope: "player", playerIds: ["4046"] },
      playerMeta: () => ({ player: "Justin Jefferson", team: "MIN" }),
    });
    expect(drafts).toHaveLength(1);
    const expectedExternalId = articleExternalId(
      "https://www.fantasypros.com/nfl/news/jefferson",
    );
    expect(drafts[0]).toMatchObject({
      source: "article",
      sourceLabel: "FantasyPros",
      change: "Justin Jefferson returns",
      roleContext: "Jefferson was a full participant.",
      sourceUrl: "https://www.fantasypros.com/nfl/news/jefferson",
      externalId: expectedExternalId,
      playerId: "4046",
      scope: "player",
      author: null,
    });
    // external_id must be non-null so team/league partial uniques apply.
    expect(drafts[0]!.externalId).toBeTruthy();
    expect(drafts[0]!.score).toBe(55);
  });

  it("downranks flagged sources below the ordinary article baseline", () => {
    const labs = ARTICLE_FEED_SOURCES.find((s) => s.name === "FantasyLabs")!;
    const drafts = buildArticleNewsDrafts({
      source: labs,
      item,
      headline: item.title,
      summary: item.summary,
      assignment: { scope: "league" },
      playerMeta: () => null,
    });
    expect(drafts[0]!.score).toBe(15);
    expect(drafts[0]!.score!).toBeLessThan(55);
  });

  it("uses a canonical-URL hash as external_id (ignores feed guid)", () => {
    const a = buildArticleNewsDrafts({
      source,
      item: { ...item, guid: "guid-a", url: "https://www.fantasypros.com/nfl/news/jefferson?utm_source=x" },
      headline: item.title,
      summary: item.summary,
      assignment: { scope: "league" },
      playerMeta: () => null,
    });
    const b = buildArticleNewsDrafts({
      source,
      item: { ...item, guid: "guid-b", url: "https://www.fantasypros.com/nfl/news/jefferson" },
      headline: item.title,
      summary: item.summary,
      assignment: { scope: "league" },
      playerMeta: () => null,
    });
    expect(a[0]!.externalId).toBe(b[0]!.externalId);
    expect(a[0]!.externalId).toBe(articleExternalId("https://www.fantasypros.com/nfl/news/jefferson"));
  });
});

describe("detectArticleTeam", () => {
  it("returns teamHint when provided", () => {
    expect(detectArticleTeam("random text", { teamHint: "TB" })).toBe("TB");
  });

  it("detects a unique nickname", () => {
    expect(detectArticleTeam("The Chiefs activated their star")).toBe("KC");
  });

  it("does not treat ordinary words like was/no as team abbreviations", () => {
    expect(detectArticleTeam("Doubs was limited in practice for the Packers")).toBe("GB");
    expect(detectArticleTeam("There is no update on the Saints")).toBe("NO");
  });

  it("still matches uppercase bare team codes", () => {
    expect(detectArticleTeam("WAS places starter on IR")).toBe("WAS");
  });
});

describe("feed parsing", () => {
  it("parses RSS 2.0 items", () => {
    const xml = `<?xml version="1.0"?>
      <rss version="2.0"><channel>
        <item>
          <title>Justin Jefferson returns to practice</title>
          <link>https://www.fantasypros.com/nfl/news/jefferson?utm_source=rss</link>
          <guid>fp-1</guid>
          <pubDate>Thu, 30 Oct 2026 12:00:00 GMT</pubDate>
          <description><![CDATA[<p>Full participant Friday.</p>]]></description>
          <category>NFL</category>
        </item>
        <item>
          <title>NBA DFS: tonight</title>
          <link>https://www.fantasypros.com/nba/dfs</link>
          <guid>fp-2</guid>
          <description>Ignore</description>
          <category>NBA</category>
        </item>
      </channel></rss>`;
    const items = parseFeedXml(xml);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      title: "Justin Jefferson returns to practice",
      guid: "fp-1",
      categories: ["NFL"],
    });
    expect(items[0]!.url).toBe("https://www.fantasypros.com/nfl/news/jefferson");
    expect(items[0]!.summary).toContain("Full participant");
    expect(items[0]!.publishedAt?.toISOString()).toBe("2026-10-30T12:00:00.000Z");
  });

  it("parses Atom entries", () => {
    const xml = `<?xml version="1.0"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <title>Packers depth chart update</title>
          <link href="https://www.acmepackingcompany.com/2026/10/30/depth-chart"/>
          <id>tag:acmepackingcompany.com,2026:1</id>
          <published>2026-10-30T15:00:00Z</published>
          <summary>Jordan Love remains the starter.</summary>
          <category term="NFL"/>
        </entry>
      </feed>`;
    const items = parseFeedXml(xml);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: "Packers depth chart update",
      url: "https://www.acmepackingcompany.com/2026/10/30/depth-chart",
      guid: "tag:acmepackingcompany.com,2026:1",
      categories: ["NFL"],
    });
    expect(items[0]!.summary).toContain("Jordan Love");
  });

  it("prefers Atom rel=alternate over an earlier rel=self link", () => {
    const xml = `<?xml version="1.0"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <title>Depth chart</title>
          <link rel="self" href="https://www.acmepackingcompany.com/rss/index.xml"/>
          <link rel="alternate" href="https://www.acmepackingcompany.com/2026/10/30/depth-chart"/>
          <id>tag:acmepackingcompany.com,2026:2</id>
          <updated>2026-10-30T15:00:00Z</updated>
          <summary>Love starts.</summary>
        </entry>
      </feed>`;
    const items = parseFeedXml(xml);
    expect(items[0]!.url).toBe("https://www.acmepackingcompany.com/2026/10/30/depth-chart");
  });
});

describe("PFF premium detection", () => {
  it("flags JSON-LD isAccessibleForFree false", () => {
    const html = `<html><script type="application/ld+json">
      {"@type":"NewsArticle","isAccessibleForFree":"false","headline":"Premium grades"}
    </script></html>`;
    expect(detectPffPremiumFromHtml(html)).toBe(true);
  });

  it("flags PremiumArticlePaywall class", () => {
    expect(
      detectPffPremiumFromHtml('<div class="PremiumArticlePaywall">Subscribe</div>'),
    ).toBe(true);
  });

  it("allows free articles", () => {
    const html = `<html><script type="application/ld+json">
      {"@type":"NewsArticle","isAccessibleForFree":"True","headline":"Free grades"}
    </script><article>body</article></html>`;
    expect(detectPffPremiumFromHtml(html)).toBe(false);
  });
});

describe("truncateSummary", () => {
  it("caps at 280 characters", () => {
    const long = "word ".repeat(100);
    expect(truncateSummary(long).length).toBeLessThanOrEqual(280);
  });
});

describe("feed list decisions", () => {
  it("includes PFT and excludes paywalled / Google-News-only sources", () => {
    const names = ARTICLE_FEED_SOURCES.map((s) => s.name);
    expect(names).toContain("ProFootballTalk");
    expect(names).toContain("PFF");
    expect(names.some((n) => /athletic/i.test(n))).toBe(false);
    expect(names.some((n) => /fantasy points/i.test(n))).toBe(false);
    expect(ARTICLE_FEED_SOURCES.some((s) => /news\.php/.test(s.feedUrl))).toBe(false);
    expect(ARTICLE_FEED_SOURCES.some((s) => /news\.google\.com/.test(s.feedUrl))).toBe(false);
    expect(names.some((n) => /cleveland|denver post|sun sentinel|cfr/i.test(n))).toBe(false);
  });
});
