import type { PositionFilter } from "../dashboard-types";

/** Visible label for Rankings/Waivers position tabs (ROOK matches QB/RB casing). */
export function positionFilterTabLabel(item: PositionFilter): string {
  if (item === "DEF") return "DST";
  if (item === "ROOKIES") return "ROOK";
  return item;
}

/** Accessible name when the visible label is abbreviated. */
export function positionFilterTabAriaLabel(item: PositionFilter): string | undefined {
  return item === "ROOKIES" ? "Rookies" : undefined;
}
