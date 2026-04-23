type RecommendationBannerProps = {
  title: string;
  subtitle: string;
  limitSuggested: string;
  risk: string;
  confidence: string;
  confidencePercent: number;
};

export function RecommendationBanner({
  title,
  subtitle,
  limitSuggested,
  risk,
  confidence,
  confidencePercent
}: RecommendationBannerProps) {
  return (
    <div className="mb-6 grid grid-cols-1 items-center gap-4 rounded-[14px] border border-[#D7E1EC] border-l-[3.5px] border-l-[#E8B83A] bg-white px-5 py-4 shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-[2px] lg:grid-cols-[auto_1fr_auto_auto_auto]">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-[#F5D06A] bg-[#FEF9EC]">
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
          <path d="M11 2L13.5 8.5H20L14.5 12.5L16.5 19L11 15L5.5 19L7.5 12.5L2 8.5H8.5L11 2Z" stroke="#D4870A" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      </div>

      <div>
        <div className="mb-[3px] text-[10px] font-medium uppercase tracking-[0.6px] text-[#D4870A]">Recomendação do motor · v3.2</div>
        <div className="text-base font-semibold text-[#102033]">{title}</div>
        <div className="mt-0.5 text-xs text-[#4F647A]">{subtitle}</div>
      </div>

      <div className="flex flex-col items-center border-r border-[#EEF3F8] px-4">
        <div className="mb-[3px] text-[10px] text-[#4F647A]">Limite sugerido</div>
        <div className="text-[15px] font-semibold text-[#C0392B]">{limitSuggested}</div>
      </div>

      <div className="flex flex-col items-center border-r border-[#EEF3F8] px-4">
        <div className="mb-[3px] text-[10px] text-[#4F647A]">Risco</div>
        <div className="text-[15px] font-semibold text-[#D4870A]">{risk}</div>
      </div>

      <div className="flex flex-col items-center">
        <div className="mb-[3px] text-[10px] text-[#4F647A]">Confiança do modelo</div>
        <div className="text-[15px] font-semibold text-[#102033]">{confidence}</div>
        <div className="mt-[5px] h-[5px] w-20 overflow-hidden rounded-[3px] bg-[#EEF3F8]">
          <div className="h-full rounded-[3px] bg-[#295B9A]" style={{ width: `${confidencePercent}%` }} />
        </div>
      </div>
    </div>
  );
}
