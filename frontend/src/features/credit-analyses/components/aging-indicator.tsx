type AgingIndicatorProps = {
  days: number;
};

export function AgingIndicator({ days }: AgingIndicatorProps) {
  const cls = days >= 10 ? "text-[#B91C1C]" : days >= 5 ? "text-[#92400E]" : "text-[#166534]";
  const label = days === 0 ? "Hoje" : `${days} dia${days > 1 ? "s" : ""}`;
  return <span className={`text-[11px] font-medium ${cls}`}>{label}</span>;
}
