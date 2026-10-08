import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function Stat({
  label,
  value,
  hint,
  tone = "neutral",
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "neutral" | "positive" | "negative";
  className?: string;
}) {
  return (
    <Card className={cn("gap-1 py-3 shadow-none", className)}>
      <CardHeader className="gap-1 px-3">
        <CardDescription>{label}</CardDescription>
        <CardTitle
          className={cn(
            "text-2xl font-semibold tabular-nums tracking-tight",
            tone === "positive" && "text-[var(--stat-strength-readable)]",
            tone === "negative" && "text-[var(--stat-weakness-readable)]",
          )}
        >
          {value}
        </CardTitle>
      </CardHeader>
      {hint ? <CardContent className="px-3 text-xs text-muted-foreground">{hint}</CardContent> : null}
    </Card>
  );
}
