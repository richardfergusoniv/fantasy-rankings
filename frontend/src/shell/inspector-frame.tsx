import { useEffect, useState, type ReactNode } from "react";

const DOCK_MEDIA_QUERY = "(min-width: 760px)";

export function useInspectorDockViewport(): boolean {
  const [wide, setWide] = useState(() => (
    typeof window !== "undefined" ? window.matchMedia(DOCK_MEDIA_QUERY).matches : false
  ));

  useEffect(() => {
    const media = window.matchMedia(DOCK_MEDIA_QUERY);
    const onChange = () => setWide(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return wide;
}

/** Layout wrapper for the docked player inspector column. */
export function InspectorFrame({ children }: { children: ReactNode }) {
  return (
    <aside className="inspector-frame" aria-label="Player inspector">
      {children}
    </aside>
  );
}
