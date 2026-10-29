/**
 * Tool definitions for the league-rules, league-teams, player-search and
 * playoff-odds chat tools. Kept import-free so chat-tools.ts can spread them
 * at module load without a circular-import hazard.
 */
type ToolDefinition = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export const LEAGUE_CHAT_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "get_league_rules",
      description:
        "The selected league's rules: scoring settings (reception points, TE premium, passing TDs, bonuses), starting lineup slots (flex / superflex), team count, playoff teams and start week, waiver type and FAAB budget. Use for any question about how this league scores or how many of each position start.",
      parameters: {
        type: "object",
        properties: { leagueId: { type: "string" } },
        required: ["leagueId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_league_teams",
      description:
        "Every team in the league: record, standing, roster value by position, strengths, needs, top assets and draft picks, and how each team's surplus and needs line up with the user's team (trade fit). Pass teamName for one team's full roster.",
      parameters: {
        type: "object",
        properties: {
          leagueId: { type: "string" },
          teamName: { type: "string", description: "Optional team name (partial match) for a full roster." },
        },
        required: ["leagueId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_players",
      description:
        "Search, rank or compare players in the selected league's context: this week's league-scored projection and rank, trade value, position rank, 30-day value trend, Sleeper add/drop trends, injury, opponent, and who owns the player. Use for 'top free-agent WRs', 'best TEs by value', 'who is trending', or side-by-side comparisons via names.",
      parameters: {
        type: "object",
        properties: {
          leagueId: { type: "string" },
          position: { type: "string", enum: ["QB", "RB", "WR", "TE", "K"] },
          availability: {
            type: "string",
            enum: ["any", "free_agent", "rostered", "mine"],
            description: "Defaults to any.",
          },
          sortBy: {
            type: "string",
            enum: ["week_projection", "value", "trending_adds"],
            description: "Defaults to week_projection.",
          },
          names: {
            type: "array",
            items: { type: "string" },
            description: "Player names to compare side by side (ignores other filters). Max 6.",
          },
          limit: { type: "number", description: "Default 10, max 25" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_projected_standings",
      description:
        "The app's Projected standings: each team's best lineup from its current roster for every remaining week; the current week uses the app's blended projections and later weeks use Sleeper's projections in this league's scoring (they already include injury timelines and byes). The higher projected score wins each matchup. Returns projected final records and points, the playoff cut, and every remaining game with both teams' projected scores. Future roster moves are not reflected. Projections added up, not a probability; use it as the base for your own forecast.",
      parameters: {
        type: "object",
        properties: { leagueId: { type: "string" } },
        required: ["leagueId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_playoff_odds",
      description:
        "Playoff and last-place odds for every team, simulated from the same projected lineups as Projected standings (the current week from the app's projections, later weeks from Sleeper's, with injury timelines and byes). For the user: their remaining games with projected scores and win chances, and what each final win total means for making the playoffs. An estimate built on projections, not an app score. Use for 'what do I need to make the playoffs', 'am I in danger of finishing last', and for deciding whether to play for floor, ceiling or the future.",
      parameters: {
        type: "object",
        properties: { leagueId: { type: "string" } },
        required: ["leagueId"],
        additionalProperties: false,
      },
    },
  },
];
