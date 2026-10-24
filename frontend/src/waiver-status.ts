/** One-line waiver standing, e.g. "FAAB $63 of $100 left · Waiver #4 of 12". */
export type WaiverStatusLike = {
  type: "faab" | "rolling" | "reverse_standings" | null;
  budget: number | null;
  remaining: number | null;
  position: number | null;
  teams: number;
};

export function waiverStatusLabel(waivers: WaiverStatusLike | null | undefined): string | null {
  if (!waivers) return null;
  const parts: string[] = [];
  if (waivers.type === "faab" && waivers.budget !== null && waivers.remaining !== null) {
    parts.push(`FAAB $${waivers.remaining} of $${waivers.budget} left`);
  }
  if (waivers.position !== null) {
    parts.push(`Waiver #${waivers.position}${waivers.teams > 0 ? ` of ${waivers.teams}` : ""}`);
  }
  if (waivers.type === "rolling") parts.push("rolling");
  if (waivers.type === "reverse_standings") parts.push("reverse standings");
  return parts.length > 0 ? parts.join(" · ") : null;
}
