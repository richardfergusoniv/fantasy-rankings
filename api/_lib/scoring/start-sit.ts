import { blendProjection } from "./blend.js";
import { isUnavailableForScoring } from "./injury.js";
import { CLOSE_CALL, startSitLabel } from "./labels.js";
import { outscoreChance, round1, round2 } from "./math.js";
import type { ScoredPlayer, ScoreReason, StartSitResult, TiebreakResult } from "./types.js";
import { correlatedWinProbability, type WinChancePlayer } from "./win-chance.js";
import { BUILTIN_SCORING_WEIGHTS, type ScoringWeightsParams } from "./weights.js";

export type StartSitInput = {
  player: ScoredPlayer;
  /** Best eligible alternative for the same slot (bench for a starter, weakest starter for a bench player). */
  alternative: ScoredPlayer | null;
  /** Optional full lineups for Flex-band close-call tiebreak. */
  yourLineupWithPlayer?: WinChancePlayer[];
  yourLineupWithAlternative?: WinChancePlayer[];
  opponentLineup?: WinChancePlayer[];
  weights?: ScoringWeightsParams;
  fallbackMedian?: number | null;
  altFallbackMedian?: number | null;
};

/**
 * Week N start/sit score: Φ((P*_player − P*_alt) / √(σ²p + σ²a)) as 0–100.
 */
export function scoreStartSit(input: StartSitInput): StartSitResult {
  const weights = input.weights ?? BUILTIN_SCORING_WEIGHTS;
  const unavailable =
    isUnavailableForScoring(input.player.injuryStatus) || Boolean(input.player.isBye);

  if (!input.alternative) {
    const blend = blendProjection(input.player, {
      weights,
      fallbackMedian: input.fallbackMedian,
    });
    return {
      week: {
        score: unavailable ? 0 : 100,
        label: unavailable ? "Sit" : "Strong start",
        metric: "win_the_slot_chance",
        reasons: [
          ...blend.reasons,
          {
            factor: "no_eligible_backup",
            source: "lineup",
            effect: "No eligible backup",
          },
        ],
      },
    };
  }

  const playerBlend = blendProjection(input.player, {
    weights,
    fallbackMedian: input.fallbackMedian,
  });
  const altBlend = blendProjection(input.alternative, {
    weights,
    fallbackMedian: input.altFallbackMedian,
  });

  let chance = unavailable
    ? 0
    : outscoreChance(
      playerBlend.moments.mean,
      playerBlend.moments.sigma,
      altBlend.moments.mean,
      altBlend.moments.sigma,
    );
  chance = round1(chance);

  const delta = round2(playerBlend.moments.mean - altBlend.moments.mean);
  const reasons: ScoreReason[] = [
    ...playerBlend.reasons,
    {
      factor: "projection_edge",
      source: "blend",
      effect: delta >= 0
        ? `Projects ${Math.abs(delta).toFixed(1)} more points than ${input.alternative.name}`
        : `Projects ${Math.abs(delta).toFixed(1)} fewer points than ${input.alternative.name}`,
    },
  ];

  let label = startSitLabel(chance, unavailable);
  let closeCall = false;
  let tiebreak: TiebreakResult | undefined;

  const altUnavailable =
    isUnavailableForScoring(input.alternative.injuryStatus) || Boolean(input.alternative.isBye);
  const altChance = altUnavailable
    ? 0
    : outscoreChance(
      altBlend.moments.mean,
      altBlend.moments.sigma,
      playerBlend.moments.mean,
      playerBlend.moments.sigma,
    );
  const bothFlex =
    !unavailable
    && !altUnavailable
    && chance >= 45
    && chance < 55
    && altChance >= 45
    && altChance < 55;

  if (
    bothFlex
    && input.yourLineupWithPlayer
    && input.yourLineupWithAlternative
    && input.opponentLineup
  ) {
    const winWithPlayer = correlatedWinProbability(
      input.yourLineupWithPlayer,
      input.opponentLineup,
      weights,
    );
    const winWithAlt = correlatedWinProbability(
      input.yourLineupWithAlternative,
      input.opponentLineup,
      weights,
    );
    const winDeltaPts = Math.abs(winWithPlayer - winWithAlt) * 100;
    if (winDeltaPts <= CLOSE_CALL.startSitFlexBand.lineup_win_chance_within_pts) {
      closeCall = true;
    }
    // Flex close call: pick the option that raises matchup win chance.
    if (winWithAlt > winWithPlayer) {
      const before = input.player.playerId;
      const after = input.alternative.playerId;
      if (before !== after) {
        tiebreak = {
          rule: "flex_lineup_win_chance",
          pickBefore: before,
          pickAfter: after,
        };
        // Flip the reported chance/label toward the alternative when the
        // lineup-win rule prefers them (caller still sees both scores).
        chance = round1(100 - chance);
        label = startSitLabel(chance, false);
        reasons.push({
          factor: "close_call_lineup_win",
          source: "win_chance",
          effect: `Flex band: lineup win chance favors ${input.alternative.name}`,
        });
      }
    } else if (closeCall) {
      reasons.push({
        factor: "close_call",
        source: "win_chance",
        effect: "Flex band close call; lineup win chances within 1 point",
      });
    }
  }

  return {
    week: {
      score: chance,
      label,
      metric: "win_the_slot_chance",
      reasons,
      closeCall: closeCall || undefined,
      tiebreak,
    },
  };
}
