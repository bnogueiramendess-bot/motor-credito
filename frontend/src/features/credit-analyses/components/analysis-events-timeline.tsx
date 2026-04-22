import { Clock3 } from "lucide-react";

import { DecisionEventDto } from "@/features/credit-analyses/api/contracts";
import { buildMilestones, toneStyles } from "@/features/credit-analyses/utils/analysis-view-models";
import { formatDateTime } from "@/features/credit-analyses/utils/formatters";

type AnalysisEventsTimelineProps = {
  events: DecisionEventDto[];
  createdAt?: string | null;
  decisionCalculatedAt?: string | null;
  completedAt?: string | null;
};

export function AnalysisEventsTimeline({
  events,
  createdAt,
  decisionCalculatedAt,
  completedAt
}: AnalysisEventsTimelineProps) {
  const fallbackMilestones = buildMilestones({
    analysis: {
      id: 0,
      protocol_number: "",
      customer_id: 0,
      requested_limit: 0,
      current_limit: 0,
      exposure_amount: 0,
      annual_revenue_estimated: 0,
      analysis_status: "created",
      motor_result: null,
      final_decision: null,
      suggested_limit: null,
      final_limit: null,
      analyst_notes: null,
      decision_memory_json: null,
      decision_calculated_at: decisionCalculatedAt ?? null,
      assigned_analyst_name: null,
      created_at: createdAt ?? new Date().toISOString(),
      completed_at: completedAt ?? null
    },
    events: []
  });

  const items = events.length
    ? events.slice(0, 6).map((event) => ({
        id: String(event.id),
        title: event.description,
        meta: `${formatDateTime(event.created_at)} · ${event.actor_name}`,
        tone: event.actor_type === "system" ? ("info" as const) : ("success" as const)
      }))
    : fallbackMilestones;

  return (
    <div className="rounded-[10px] border border-[#e2e5eb] bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#6b7280]">Histórico de decisões</p>
        <Clock3 className="h-3.5 w-3.5 text-[#9ca3af]" />
      </div>

      <div className="space-y-3">
        {items.map((item, index) => {
          const styles = toneStyles(item.tone);
          return (
            <div key={item.id} className="relative flex gap-2.5 pb-3 last:pb-0">
              {index !== items.length - 1 ? <div className="absolute left-[5px] top-3 h-full w-px bg-[#e2e5eb]" /> : null}
              <span className={`mt-0.5 inline-block h-2.5 w-2.5 rounded-full ${styles.dot}`} />
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-[#374151]">{item.title}</p>
                <p className="break-words text-[10px] text-[#9ca3af]">{item.meta}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
