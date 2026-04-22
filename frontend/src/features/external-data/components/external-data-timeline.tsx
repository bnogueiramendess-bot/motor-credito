import { DecisionEventDto } from "@/features/credit-analyses/api/contracts";
import { formatDateTime } from "@/features/credit-analyses/utils/formatters";

type ExternalDataTimelineProps = {
  events: DecisionEventDto[];
};

function isExternalDataEvent(event: DecisionEventDto) {
  if (event.event_type.includes("external_data")) {
    return true;
  }

  if (event.event_payload_json && typeof event.event_payload_json.external_data_entry_id === "number") {
    return true;
  }

  return false;
}

export function ExternalDataTimeline({ events }: ExternalDataTimelineProps) {
  const timelineItems = events.filter(isExternalDataEvent);

  return (
    <article className="rounded-[10px] border border-[#e2e5eb] bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-[13px] font-medium text-[#111827]">Timeline de eventos externos</p>
        <p className="text-[11px] text-[#6b7280]">{timelineItems.length} evento(s)</p>
      </div>

      {!timelineItems.length ? (
        <p className="text-[12px] text-[#6b7280]">Não há eventos de dados externos para esta análise.</p>
      ) : (
        <div className="space-y-2">
          {timelineItems.map((event) => (
            <div key={event.id} className="rounded-[8px] border border-[#edf0f2] bg-[#fafafa] px-3 py-2">
              <p className="text-[12px] font-medium text-[#111827]">{event.description}</p>
              <p className="text-[11px] text-[#6b7280]">
                {formatDateTime(event.created_at)} • {event.actor_name} • {event.event_type}
              </p>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}