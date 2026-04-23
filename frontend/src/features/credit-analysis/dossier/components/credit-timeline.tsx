import { cn } from "@/shared/lib/utils";

export type CreditTimelineEvent = {
  id: string;
  date: string;
  title: string;
  description: string;
  type: "positive" | "negative";
};

type CreditTimelineProps = {
  events: CreditTimelineEvent[];
};

export function CreditTimeline({ events }: CreditTimelineProps) {
  return (
    <ol className="space-y-4">
      {events.map((event) => (
        <li key={event.id} className="relative pl-6">
          <span
            className={cn(
              "absolute left-0 top-1.5 h-3 w-3 rounded-full",
              event.type === "positive" ? "bg-emerald-500" : "bg-rose-500"
            )}
          />
          <article className="rounded-xl border border-border/80 bg-card p-4 shadow-sm transition-all hover:-translate-y-0.5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{event.date}</p>
            <p className="mt-1 text-sm font-semibold text-foreground">{event.title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{event.description}</p>
          </article>
        </li>
      ))}
    </ol>
  );
}

