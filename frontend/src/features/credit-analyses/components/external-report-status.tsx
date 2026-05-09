type ExternalReportStatusProps = {
  cofaceStatus: string;
  agriskStatus: string;
};

function badge(status: string) {
  if (status === "importado" || status === "validado") return "bg-[#E6F4ED] text-[#166534]";
  if (status === "com_restricao") return "bg-[#FEF2F2] text-[#B91C1C]";
  return "bg-[#F3F4F6] text-[#4B5563]";
}

export function ExternalReportStatus({ cofaceStatus, agriskStatus }: ExternalReportStatusProps) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-semibold">
      <span className={`rounded-full px-2 py-0.5 ${badge(cofaceStatus)}`}>COFACE: {cofaceStatus}</span>
      <span className={`rounded-full px-2 py-0.5 ${badge(agriskStatus)}`}>AgRisk: {agriskStatus}</span>
    </div>
  );
}
