import { useEffect, useRef } from "react";

type LinkedPlayerSyncOptions<T> = {
  linkedPlayerId: string | null;
  isOpen: boolean;
  currentPlayerId: string | null;
  resolve: (playerId: string) => T | null;
  open: (player: T) => void;
  close: () => void;
  onMiss: () => void;
  onFound: () => void;
  ready?: boolean;
};

export function useLinkedPlayerSync<T>(options: LinkedPlayerSyncOptions<T>): void {
  const appliedId = useRef<string | null>(null);
  const reportedMiss = useRef<string | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const current = optionsRef.current;
    const linkedPlayerId = current.linkedPlayerId;
    if (!linkedPlayerId) {
      appliedId.current = null;
      reportedMiss.current = null;
      if (current.isOpen) current.close();
      return;
    }
    if (appliedId.current === linkedPlayerId) return;
    if (current.ready === false) return;
    const player = current.resolve(linkedPlayerId);
    if (!player) {
      if (reportedMiss.current !== linkedPlayerId) {
        reportedMiss.current = linkedPlayerId;
        current.onMiss();
      }
      return;
    }
    if (reportedMiss.current === linkedPlayerId) current.onFound();
    reportedMiss.current = null;
    appliedId.current = linkedPlayerId;
    if (current.currentPlayerId !== linkedPlayerId) current.open(player);
  }, [options.linkedPlayerId, options.ready]);
}
