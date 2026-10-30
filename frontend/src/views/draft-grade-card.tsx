import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { api } from "../api";
import { CardHero } from "../components/card-hero";
import { ordinal } from "../projected-standings-view";

/** Raised summary at the top of My team: the draft graded on draft day and again today. Shows nothing until a grade exists. */
export function DraftGradeCard({ leagueId }: { leagueId: string }) {
  const query = useQuery({
    queryKey: ["draft-grade", leagueId],
    queryFn: () => api.getDraftGrade({ leagueId }),
    staleTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const grade = query.data?.grade;
  if (!grade) return null;

  const items = [
    { label: "Draft day", result: grade.draftDay },
    { label: "Today", result: grade.today },
  ].flatMap(({ label, result }) => (result ? [{ label, value: result.letter, sub: `${ordinal(result.rank)} of ${result.of}` }] : []));
  if (items.length === 0) return null;

  return (
    <Card className="draft-grade gap-0 py-0 shadow-sm">
      <div className="draft-grade-eyebrow">Draft grade</div>
      <CardHero ariaLabel="Draft grade" items={items} />
    </Card>
  );
}
