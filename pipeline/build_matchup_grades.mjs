#!/usr/bin/env node
// build_matchup_grades.mjs — Defense-vs-position matchup grades ("Matchups" tab).
//
// Pipeline:
//   1. Sleeper /state/nfl -> current week + season_type.
//   2. Completed weeks = weeks < current week, plus the current week once every
//      one of its games shows status "complete" in Sleeper's public schedule
//      (/schedule/nfl/regular/{season}).
//   3. Per completed week: Sleeper weekly actuals (/stats/nfl/regular/{season}/{week})
//      joined to the NFL player dictionary for position/team.
//   4. Opponent mapping per week from nflverse games.csv (2026, game_type=REG)
//      — same schedule source the artifact's Charts view already uses.
//   5. Every player's stat line is scored through the SELECTED league's actual
//      Sleeper scoring_settings using a verbatim copy of the server's
//      scoreProjectedPlayerStats scorer (server/src/actions.ts). One table per
//      league; nothing generic.
//   6. Per defense (32) x position (QB/RB/WR/TE): total fantasy points allowed to
//      the position each completed week, averaged across those weeks. Bye weeks
//      contribute no observation (excluded, never zeroed); only gms_active
//      player rows count toward a week's total.
//   7. Per position, rank the 32 defenses by avg allowed (desc, tie-break by
//      team code ascending): rank 1 = softest (most points allowed),
//      rank 32 = toughest (fewest allowed).
//
// Output: <props-aggregator>/data/staged_matchup_grades.json — the staged file
// the fantasy-rankings artifact's `ingeststagedmatchupgrades` action reads.
// Re-runs with no new completed week are a no-op (staged file untouched).

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const SEASON = 2026;
const POSITIONS = ["QB", "RB", "WR", "TE"];
const DATA_DIR = path.join(os.homedir(), "workspace", "props-aggregator", "data");
const STAGED_FILE = path.join(DATA_DIR, "staged_matchup_grades.json");
const PLAYERS_CACHE = path.join(DATA_DIR, "sleeper_players_cache.json");
const GAMES_CACHE = path.join(DATA_DIR, "nflverse_games_cache.csv");
const PLAYERS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const GAMES_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const LEAGUES = [
  { id: "1389344450517430272", name: "NY Sack Exchange II" },
  { id: "1355920300633513984", name: "Tits Out for The Ladz XII" },
  { id: "1317270144682070016", name: "C2C superconference" },
  { id: "1312127020972404736", name: "Hoe Ass Dynasty" },
  { id: "1311470531635052544", name: "Tainticklers" },
  { id: "1306489414548979712", name: "Dynastical Cucks" },
];

// ---------------------------------------------------------------------------
// Scorer: VERBATIM copy of scoreProjectedPlayerStats + settingValue from
// fantasy-rankings server/src/actions.ts. Keep in sync with the server; the
// matchup table must use each league's exact scoring, not a generic formula.
// ---------------------------------------------------------------------------
function settingValue(settings, key) {
  const value = settings?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function scoreProjectedPlayerStats(position, stats, settings) {
  const directKeys = [
    "pass_yd", "pass_td", "pass_int", "pass_cmp", "pass_att", "pass_inc", "pass_sack", "pass_fd", "pass_2pt",
    "rush_yd", "rush_td", "rush_att", "rush_fd", "rush_2pt",
    "rec", "rec_yd", "rec_td", "rec_fd", "rec_2pt",
    "fum", "fum_lost", "pr_yd", "kr_yd", "pr_td", "kr_td",
  ];
  let total = directKeys.reduce((sum, key) => sum + (stats[key] ?? 0) * settingValue(settings, key), 0);
  if (position === "TE") total += (stats.rec ?? 0) * settingValue(settings, "bonus_rec_te");

  const bonuses = [
    ["bonus_pass_yd_300", "pass_yd", 300], ["bonus_pass_yd_400", "pass_yd", 400],
    ["bonus_pass_td_5", "pass_td", 5], ["bonus_pass_cmp_25", "pass_cmp", 25],
    ["bonus_rush_yd_100", "rush_yd", 100], ["bonus_rush_yd_200", "rush_yd", 200], ["bonus_rush_att_20", "rush_att", 20],
    ["bonus_rec_yd_100", "rec_yd", 100], ["bonus_rec_yd_200", "rec_yd", 200], ["bonus_rec_10", "rec", 10],
  ];
  for (const [settingKey, statKey, threshold] of bonuses) {
    if ((stats[statKey] ?? 0) >= threshold) total += settingValue(settings, settingKey);
  }

  if (position === "K") {
    const distanceKeys = ["fgm_0_19", "fgm_20_29", "fgm_30_39", "fgm_40_49", "fgm_50_59", "fgm_60p"];
    const missKeys = ["fgmiss_0_19", "fgmiss_20_29", "fgmiss_30_39", "fgmiss_40_49", "fgmiss_50_59", "fgmiss_60p"];
    const hasDistanceScoring = distanceKeys.some((key) => settingValue(settings, key) !== 0);
    const hasDistanceMissScoring = missKeys.some((key) => settingValue(settings, key) !== 0);
    total += hasDistanceScoring
      ? distanceKeys.reduce((sum, key) => sum + (stats[key] ?? 0) * settingValue(settings, key), 0)
      : (stats.fgm ?? 0) * settingValue(settings, "fgm");
    total += hasDistanceMissScoring
      ? missKeys.reduce((sum, key) => sum + (stats[key] ?? 0) * settingValue(settings, key), 0)
      : (stats.fgmiss ?? 0) * settingValue(settings, "fgmiss");
    total += (stats.fgm_50p ?? 0) * settingValue(settings, "fgm_50p");
    total += (stats.xpm ?? 0) * settingValue(settings, "xpm");
    total += (stats.xpmiss ?? 0) * settingValue(settings, "xpmiss");
    const estimatedMadeYards = (stats.fgm_0_19 ?? 0) * 19 + (stats.fgm_20_29 ?? 0) * 25 + (stats.fgm_30_39 ?? 0) * 35
      + (stats.fgm_40_49 ?? 0) * 45 + (stats.fgm_50_59 ?? 0) * 55 + (stats.fgm_60p ?? 0) * 62;
    total += estimatedMadeYards * settingValue(settings, "fgm_yds");
  }
  return Number(total.toFixed(2));
}
// ---------------------------------------------------------------------------

function canonicalTeam(team) {
  if (team === "JAC") return "JAX";
  if (team === "LA") return "LAR";
  return team;
}

async function fetchJson(url, label) {
  try {
    const res = await fetch(url, { headers: { "user-agent": "fantasy-rankings-matchup-grades/1.0" } });
    if (!res.ok) throw new Error(`${label}: HTTP ${res.status} for ${url}`);
    return res.json();
  } catch (e) {
    // Sleeper's CDN intermittently resets sockets on node's HTTP client (UND_ERR_SOCKET);
    // curl transports the same endpoints reliably, so fall back before giving up.
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const run = promisify(execFile);
    const { stdout } = await run("curl", ["-sS", "-m", "90", "-A", "fantasy-rankings-matchup-grades/1.0", url], { maxBuffer: 256 * 1024 * 1024 });
    return JSON.parse(stdout);
  }
}

async function fetchText(url, label) {
  try {
    const res = await fetch(url, { headers: { "user-agent": "fantasy-rankings-matchup-grades/1.0" } });
    if (!res.ok) throw new Error(`${label}: HTTP ${res.status} for ${url}`);
    return res.text();
  } catch (e) {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const run = promisify(execFile);
    const { stdout } = await run("curl", ["-sS", "-m", "90", "-A", "fantasy-rankings-matchup-grades/1.0", url], { maxBuffer: 256 * 1024 * 1024 });
    return stdout;
  }
}

async function readCachedOrFetch(cachePath, ttlMs, fetchFn, kind) {
  if (existsSync(cachePath) && Date.now() - statSync(cachePath).mtimeMs < ttlMs) {
    const raw = await readFile(cachePath, "utf8");
    return kind === "json" ? JSON.parse(raw) : raw;
  }
  const fresh = await fetchFn();
  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(cachePath, kind === "json" ? JSON.stringify(fresh) : fresh, "utf8");
  return fresh;
}

function parseGamesCsv(csv) {
  // week -> Map(team -> opponent), canonical codes, 2026 REG only.
  const byWeek = new Map();
  const lines = csv.split("\n");
  const header = lines[0].split(",");
  const idx = (name) => header.indexOf(name);
  const iWeek = idx("week"), iType = idx("game_type"), iSeason = idx("season"),
    iAway = idx("away_team"), iHome = idx("home_team");
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cols = line.split(",");
    if (cols[iSeason] !== String(SEASON) || cols[iType] !== "REG") continue;
    const week = Number(cols[iWeek]);
    const away = canonicalTeam(cols[iAway]);
    const home = canonicalTeam(cols[iHome]);
    if (!byWeek.has(week)) byWeek.set(week, new Map());
    const map = byWeek.get(week);
    map.set(away, home);
    map.set(home, away);
  }
  return byWeek;
}

async function main() {
  const state = await fetchJson("https://api.sleeper.app/v1/state/nfl", "sleeper state");
  if (state.season_type !== "regular" || Number(state.season) !== SEASON) {
    console.log(`not regular season (${state.season} ${state.season_type}); nothing to build`);
    return;
  }
  const currentWeek = Number(state.week);

  const schedule = await fetchJson("https://api.sleeper.com/schedule/nfl/regular/2026", "sleeper schedule");
  const completedWeeks = [];
  for (let week = 1; week < currentWeek; week++) completedWeeks.push(week);
  const currentWeekGames = schedule.filter((g) => Number(g.week) === currentWeek);
  if (currentWeekGames.length > 0 && currentWeekGames.every((g) => g.status === "complete")) {
    completedWeeks.push(currentWeek); // games finalized after the fact
  }
  const throughWeek = completedWeeks.length ? Math.max(...completedWeeks) : 0;
  console.log(`current week ${currentWeek}; completed weeks: ${completedWeeks.join(",") || "(none)"}`);

  if (existsSync(STAGED_FILE)) {
    const staged = JSON.parse(await readFile(STAGED_FILE, "utf8"));
    if (staged.season === SEASON && staged.through_week === throughWeek && completedWeeks.length > 0) {
      console.log(`no new completed weeks since staged build (through Week ${throughWeek}); leaving staged file untouched`);
      return;
    }
  }
  if (completedWeeks.length === 0) {
    console.log("no completed weeks yet; not staging an empty table");
    return;
  }

  const gamesByWeek = parseGamesCsv(await readCachedOrFetch(
    GAMES_CACHE, GAMES_CACHE_TTL_MS,
    () => fetchText("https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv", "nflverse games.csv"),
    "text",
  ));
  const players = await readCachedOrFetch(
    PLAYERS_CACHE, PLAYERS_CACHE_TTL_MS,
    () => fetchJson("https://api.sleeper.app/v1/players/nfl", "sleeper players"),
    "json",
  );

  // Fetch league scoring settings + weekly actuals.
  const leagueSettings = [];
  for (const league of LEAGUES) {
    const def = await fetchJson(`https://api.sleeper.app/v1/league/${league.id}`, `league ${league.name}`);
    leagueSettings.push({ ...league, scoring_settings: def.scoring_settings ?? {} });
  }
  const weeklyStats = new Map();
  for (const week of completedWeeks) {
    weeklyStats.set(week, await fetchJson(
      `https://api.sleeper.app/v1/stats/nfl/regular/${SEASON}/${week}`,
      `sleeper stats week ${week}`,
    ));
  }

  const builtAt = new Date().toISOString();
  const leagues = leagueSettings.map((league) => {
    // defense -> position -> week -> total points allowed to the position that week
    const weekly = new Map();
    for (const week of completedWeeks) {
      const opponents = gamesByWeek.get(week);
      if (!opponents) continue;
      const stats = weeklyStats.get(week);
      for (const [playerId, row] of Object.entries(stats)) {
        if (row == null || typeof row !== "object" || row.gms_active !== 1) continue;
        const info = players[playerId];
        if (!info || !POSITIONS.includes(info.position)) continue;
        const team = info.team ? canonicalTeam(info.team) : null;
        const opponent = team ? opponents.get(team) : null;
        if (!team || !opponent) continue; // bye week: no observation, never zeroed
        const pts = scoreProjectedPlayerStats(info.position, row, league.scoring_settings);
        if (!weekly.has(opponent)) weekly.set(opponent, new Map());
        const byPos = weekly.get(opponent);
        if (!byPos.has(info.position)) byPos.set(info.position, new Map());
        const byWeek = byPos.get(info.position);
        byWeek.set(week, (byWeek.get(week) ?? 0) + pts);
      }
    }
    // Average weekly position-total across completed weeks, then rank per position.
    const defenses = [...weekly.keys()];
    const table = {};
    for (const position of POSITIONS) {
      const rows = defenses.map((defense) => {
        const byWeek = weekly.get(defense).get(position);
        if (!byWeek || byWeek.size === 0) return { defense, avg: null, weeks: 0 };
        const total = [...byWeek.values()].reduce((sum, value) => sum + value, 0);
        return { defense, avg: total / byWeek.size, weeks: byWeek.size };
      }).filter((r) => r.avg !== null);
      rows.sort((a, b) => b.avg - a.avg || a.defense.localeCompare(b.defense));
      rows.forEach((row, index) => {
        if (!table[row.defense]) table[row.defense] = {};
        table[row.defense][position] = {
          avg: Number(row.avg.toFixed(2)),
          weeks: row.weeks,
          rank: index + 1,
        };
      });
    }
    const missing = defenses.filter((d) => POSITIONS.some((p) => !table[d]?.[p]));
    if (missing.length) console.log(`WARN ${league.name}: incomplete defense rows: ${missing.join(",")}`);
    return {
      league_id: league.id,
      league_name: league.name,
      through_week: throughWeek,
      completed_weeks: completedWeeks,
      computed_at: builtAt,
      table,
    };
  });

  const payload = {
    source: "matchup-grades",
    season: SEASON,
    through_week: throughWeek,
    built_at: builtAt,
    leagues,
  };
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(STAGED_FILE, JSON.stringify(payload), "utf8");
  console.log(`staged ${STAGED_FILE}: ${leagues.length} leagues through Week ${throughWeek}`);
}

main().catch((error) => {
  console.error("build_matchup_grades failed:", error.message);
  process.exit(1);
});
