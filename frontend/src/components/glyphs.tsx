import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Plus, X } from "lucide-react";

/** Line icons for controls, so a close, back or add looks the same on every screen. */
export const CloseGlyph = () => <X size={16} strokeWidth={2} aria-hidden="true" />;
export const BackGlyph = () => <ChevronLeft size={16} strokeWidth={2} aria-hidden="true" />;
export const ChevronGlyph = () => <ChevronRight size={14} strokeWidth={2.4} aria-hidden="true" />;
export const PlusGlyph = () => <Plus size={16} strokeWidth={2} aria-hidden="true" />;
export const SortGlyph = ({ ascending }: { ascending: boolean }) => (ascending ? <ArrowUp size={12} strokeWidth={2.4} aria-hidden="true" /> : <ArrowDown size={12} strokeWidth={2.4} aria-hidden="true" />);

/** The drawn up or down triangle used for every movement (rank, value, depth chart, ticker). */
export function MoveTriangle({ direction }: { direction: "up" | "down" }) {
  return <i className={`move-tri is-${direction}`} aria-hidden="true" />;
}
