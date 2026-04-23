type KpiCardProps = {
  label: string;
  value: string;
  muted?: boolean;
  helper?: string;
  state?: "normal" | "warning" | "danger";
};

export function KpiCard({ label, value, muted = false, helper, state = "normal" }: KpiCardProps) {
  return (
    <div className="rounded-xl border border-[#D7E1EC] bg-white px-[18px] py-4 shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-[2px]">
      <div className="mb-1.5 text-[11px] text-[#4F647A]">{label}</div>
      <div className={muted ? "text-[15px] font-normal text-[#9CA3AF]" : "text-[18px] font-semibold text-[#102033]"}>{value}</div>

      {helper ? (
        state === "warning" ? (
          <div className="mt-1.5 inline-flex items-center gap-1 rounded bg-[#FEF9EC] px-2 py-0.5 text-[11px] text-[#D4870A]">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="#D4870A" aria-hidden="true">
              <path d="M6 1L11 10H1L6 1z" />
              <rect x="5.4" y="4.5" width="1.2" height="3" rx="0.6" />
              <rect x="5.4" y="8.2" width="1.2" height="1.2" rx="0.6" />
            </svg>
            {helper}
          </div>
        ) : (
          <div className={state === "danger" ? "mt-1.5 text-[11px] text-[#C0392B]" : "mt-1.5 text-[11px] text-[#4F647A]"}>{helper}</div>
        )
      ) : null}
    </div>
  );
}
