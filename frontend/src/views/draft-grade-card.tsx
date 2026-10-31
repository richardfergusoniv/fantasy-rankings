import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { api } from "../api";
import { CardHero } from "../components/card-hero";
import { ordinal } from "../projected-standings-view";
import { personalQueryKey, useViewerIdentity } from "../viewer-scope";

/** The league's draft grade for the signed-in team; both the summary card and the recap table read it. */
export function useDraftGrade(leagueId: string) {
  // The grade depends on who is signed in, so it is keyed (and cleared on sign-out) like the other personal queries.
  const viewer = useViewerIdentity();
  return useQuery({
    queryKey: personalQueryKey(viewer, "draft-grade", leagueId),
    queryFn: () => api.getDraftGrade({ leagueId }),
    staleTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

/** Raised summary at the top of My team: the draft graded on draft day and again today. Shows nothing until a grade exists. */
export function DraftGradeCard({ leagueId }: { leagueId: string }) {
  const grade = useDraftGrade(leagueId).data?.grade;
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
