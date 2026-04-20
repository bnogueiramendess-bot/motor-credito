import { DecisionEventDto } from "@/features/credit-analyses/api/contracts";
import { formatDateTime } from "@/features/credit-analyses/utils/formatters";
import { Badge } from "@/shared/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";

type AnalysisEventsTimelineProps = {
  events: DecisionEventDto[];
};

export function AnalysisEventsTimeline({ events }: AnalysisEventsTimelineProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Timeline de eventos</CardTitle>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum evento registrado para esta analise.</p>
        ) : (
          <ol className="space-y-4">
            {events.map((event) => (
              <li key={event.id} className="rounded-lg border border-border/70 bg-background p-4">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge variant={event.actor_type === "system" ? "secondary" : "outline"}>
                    {event.actor_type === "system" ? "Sistema" : "Usuario"}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{formatDateTime(event.created_at)}</span>
                </div>
                <p className="text-sm font-medium">{event.description}</p>
                <p className="mt-1 text-xs text-muted-foreground">Responsavel: {event.actor_name}</p>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
