import type { CSSProperties } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { UNDO_DURATION_MS } from "@/undo";
import "sonner/dist/styles.css";

export function Toaster({ ...props }: ToasterProps) {
  return (
    <Sonner
      theme="light"
      className="toaster"
      position="bottom-center"
      duration={UNDO_DURATION_MS}
      offset="calc(70px + env(safe-area-inset-bottom))"
      mobileOffset="calc(70px + env(safe-area-inset-bottom))"
      style={{
        "--normal-bg": "var(--popover)",
        "--normal-text": "var(--popover-foreground)",
        "--normal-border": "var(--border)",
        "--border-radius": "var(--radius)",
      } as CSSProperties}
      {...props}
    />
  );
}
