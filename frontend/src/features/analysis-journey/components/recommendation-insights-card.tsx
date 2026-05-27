type RecommendationInsightsCardProps = {
  riskPrimary: string;
  riskSecondary: string;
  cofacePrimary: string;
  cofaceSecondary: string;
  exposurePrimary: string;
  exposureSecondary: string;
  overduePrimary: string;
  overdueSecondary: string;
};

export function RecommendationInsightsCard({
  riskPrimary,
  riskSecondary,
  cofacePrimary,
  cofaceSecondary,
  exposurePrimary,
  exposureSecondary,
  overduePrimary,
  overdueSecondary,
}: RecommendationInsightsCardProps) {
  return (
    <article className="rounded-[24px] p-6 shadow-[0_4px_14px_rgba(15,23,42,0.04)] border border-[#E5EAF1] bg-[linear-gradient(180deg,#FFFFFF_0%,#FAFCFF_100%)]">
      <div className="flex items-start gap-3">
        <span className="mt-1 h-10 w-[3px] rounded-full bg-[#8DB8EA]" aria-hidden="true" />
        <div>
          <p className="text-[18px] font-semibold text-[#0f172a]">Insights da Recomendação</p>
          <p className="mt-1 text-[13px] text-[#64748b]">Principais fatores considerados pelo motor na recomendação final.</p>
        </div>
      </div>
      <div className="mt-3.5 grid gap-2 sm:grid-cols-2">
        <article className="rounded-[12px] border border-[#E8EEF5]/80 bg-[#F8FAFC]/80 px-3 py-2">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-[12px] font-semibold text-[#334155]">Perfil de Risco</p>
            <span className="rounded-full border border-[#DCE7F5] bg-[#F7FAFF] px-1.5 py-0.5 text-[8px] font-medium text-[#4B6B90]">Score</span>
          </div>
          <p className="text-[12px] font-bold text-[#1f2937]">{riskPrimary}</p>
          <p className="mt-0.5 text-[10px] text-[#64748b]">{riskSecondary}</p>
        </article>
        <article className="rounded-[12px] border border-[#E8EEF5]/80 bg-[#F8FAFC]/80 px-3 py-2">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-[12px] font-semibold text-[#334155]">COFACE</p>
            <span className="rounded-full border border-[#DCE7F5] bg-[#F7FAFF] px-1.5 py-0.5 text-[8px] font-medium text-[#4B6B90]">Cobertura</span>
          </div>
          <p className="text-[12px] font-bold text-[#1f2937]">{cofacePrimary}</p>
          <p className="mt-0.5 text-[10px] text-[#64748b]">{cofaceSecondary}</p>
        </article>
        <article className="rounded-[12px] border border-[#E8EEF5]/80 bg-[#F8FAFC]/80 px-3 py-2">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-[12px] font-semibold text-[#334155]">Exposição</p>
            <span className="rounded-full border border-[#DCE7F5] bg-[#F7FAFF] px-1.5 py-0.5 text-[8px] font-medium text-[#4B6B90]">Impacto</span>
          </div>
          <p className="text-[12px] font-bold text-[#1f2937]">{exposurePrimary}</p>
          <p className="mt-0.5 text-[10px] text-[#64748b]">{exposureSecondary}</p>
        </article>
        <article className="rounded-[12px] border border-[#E8EEF5]/80 bg-[#F8FAFC]/80 px-3 py-2">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-[12px] font-semibold text-[#334155]">Overdue</p>
            <span className="rounded-full border border-[#DCE7F5] bg-[#F7FAFF] px-1.5 py-0.5 text-[8px] font-medium text-[#4B6B90]">Carteira</span>
          </div>
          <p className="text-[12px] font-bold text-[#1f2937]">{overduePrimary}</p>
          <p className="mt-0.5 text-[10px] text-[#64748b]">{overdueSecondary}</p>
        </article>
      </div>
    </article>
  );
}
