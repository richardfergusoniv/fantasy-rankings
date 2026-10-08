import { useEffect } from "react";

export function shouldWarnBeforeLeave(input: { tradeAssetCount: number; savedViewNaming: boolean; savedViewName: string }): boolean {
  return input.tradeAssetCount > 0 || (input.savedViewNaming && input.savedViewName.trim().length > 0);
}

export function useUnsavedLeaveWarning(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [active]);
}
