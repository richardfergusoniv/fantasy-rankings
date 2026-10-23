import { useState } from "react";

const TEAM_LOGO_ALIASES: Record<string, string> = { JAC: "jax", WSH: "was", LA: "lar" };

export function teamLogoUrl(team: string | null): string | null {
  const code = team?.trim().toUpperCase();
  if (!code || !/^[A-Z]{2,3}$/.test(code)) return null;
  return `https://sleepercdn.com/images/team_logos/nfl/${TEAM_LOGO_ALIASES[code] ?? code.toLowerCase()}.png`;
}

export function playerHeadshotUrl(playerId: string): string | null {
  return /^\d+$/.test(playerId) ? `https://sleepercdn.com/content/nfl/players/thumb/${playerId}.jpg` : null;
}

function DecorativeImage({ src, className }: { src: string | null; className: string }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!src || failedSrc === src) return null;
  return <img className={className} src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailedSrc(src)} />;
}

/** Decorative: the team name is always rendered as text beside it. Renders nothing when the logo can't load. */
export function TeamLogo({ team, className = "" }: { team: string | null; className?: string }) {
  return <DecorativeImage src={teamLogoUrl(team)} className={`team-logo ${className}`.trim()} />;
}

/** Decorative: the player name is always rendered as text beside it. Defenses show their team logo instead. */
export function PlayerHeadshot({ playerId, position, team }: { playerId: string; position: string; team: string | null }) {
  if (position === "DEF") return <TeamLogo team={team ?? playerId} className="player-headshot" />;
  return <DecorativeImage src={playerHeadshotUrl(playerId)} className="player-headshot" />;
}
