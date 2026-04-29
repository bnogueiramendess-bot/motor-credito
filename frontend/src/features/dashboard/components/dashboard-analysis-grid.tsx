import { DashboardAnalysisCard } from "@/features/dashboard/components/dashboard-analysis-card";
import { DashboardAnalysisCardViewModel } from "@/features/dashboard/utils/dashboard-analysis-view-models";
import { EmptyState } from "@/shared/components/states/empty-state";

type DashboardAnalysisGridProps = {
  analyses: DashboardAnalysisCardViewModel[];
  filteredCount: number;
};

export function DashboardAnalysisGrid({ analyses, filteredCount }: DashboardAnalysisGridProps) {
  if (!analyses.length) {
    return (
      <EmptyState
        title="Nenhuma análise encontrada"
        description="Ajuste os filtros de busca para encontrar registros do backend."
      />
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-xl font-semibold tracking-[-0.01em] text-[#111827]">Clientes em destaque</h2>
        <p className="text-sm text-[#6b7280]">
          {filteredCount > 12 ? "Mostrando 12 mais prioritárias" : `${filteredCount} registro(s) exibido(s)`}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {analyses.map((analysis) => (
          <DashboardAnalysisCard key={analysis.id} analysis={analysis} />
        ))}
      </div>
    </section>
  );
}
