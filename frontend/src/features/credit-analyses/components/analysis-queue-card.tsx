import Link from "next/link";

import { OperationalQueueItemDto } from "@/features/credit-analyses/api/contracts";
import { AgingIndicator } from "@/features/credit-analyses/components/aging-indicator";
import { ExternalReportStatus } from "@/features/credit-analyses/components/external-report-status";
import { WorkflowBadges } from "@/features/credit-analyses/components/workflow-badges";
import { formatCurrency } from "@/features/credit-analyses/utils/formatters";

type AnalysisQueueCardProps = {
  item: OperationalQueueItemDto;
};

export function AnalysisQueueCard({ item }: AnalysisQueueCardProps) {
  return (
    <article className="rounded-[14px] border border-[#D7E1EC] bg-white p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-[15px] font-semibold text-[#102033]">{item.customer_name}</p>
          <p className="text-[11px] text-[#4F647A]">{item.cnpj ?? "CNPJ não informado"} • {item.analysis_code}</p>
          <p className="text-[11px] text-[#8FA3B4]">Grupo: {item.economic_group ?? "-"} • BU: {item.business_unit ?? "-"}</p>
        </div>
        <WorkflowBadges status={item.current_status} isEarlyReview={item.is_early_review_request} analysisType={item.analysis_type} hasRecent={item.has_analysis_recent_badge} />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-[10px] bg-[#F8FAFC] p-3 text-[11px]">
          <p className="text-[#8FA3B4]">Solicitação</p>
          <p className="text-[#102033]">Data: {new Date(item.created_at).toLocaleDateString("pt-BR")}</p>
          <p className="text-[#102033]">Tempo em aberto: <AgingIndicator days={item.aging_days} /></p>
          <p className="text-[#102033]">Solicitante: {item.requester_name ?? "-"}</p>
          <p className="text-[#102033]">Analista: {item.assigned_analyst_name ?? "-"}</p>
        </div>
        <div className="rounded-[10px] bg-[#F8FAFC] p-3 text-[11px]">
          <p className="text-[#8FA3B4]">Contexto financeiro</p>
          <p className="text-[#102033]">Limite sugerido: {formatCurrency(item.suggested_limit ?? 0)}</p>
          <p className="text-[#102033]">Limite total: {formatCurrency(item.total_limit ?? 0)}</p>
          <p className="text-[#102033]">Limite disponível: {formatCurrency(item.available_limit ?? 0)}</p>
          <p className="text-[#102033]">Valor em aberto: {formatCurrency(item.open_amount ?? 0)}</p>
        </div>
        <div className="rounded-[10px] bg-[#F8FAFC] p-3 text-[11px]">
          <p className="text-[#8FA3B4]">Governança e relatórios</p>
          <ExternalReportStatus cofaceStatus={item.coface_status} agriskStatus={item.agrisk_status} />
          {item.is_early_review_request ? <p className="mt-2 text-[#92400E]">Justificativa: {item.early_review_justification ?? "-"}</p> : null}
          {item.previous_analysis_id ? <p className="text-[#4F647A]">Análise anterior: #{item.previous_analysis_id}</p> : null}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link href={`/analises/${item.analysis_id}`} className="rounded-[8px] bg-[#1E3A8A] px-3 py-1.5 text-[11px] font-medium text-white">Abrir análise</Link>
        <Link href={`/analises/${item.analysis_id}`} className="rounded-[8px] border border-[#D7E1EC] px-3 py-1.5 text-[11px] font-medium text-[#4F647A]">Continuar análise</Link>
        <Link href={`/analises/${item.analysis_id}`} className="rounded-[8px] border border-[#D7E1EC] px-3 py-1.5 text-[11px] font-medium text-[#4F647A]">Importar relatórios</Link>
        <Link href={`/credit-analysis/${item.analysis_id}/dossier`} className="rounded-[8px] border border-[#D7E1EC] px-3 py-1.5 text-[11px] font-medium text-[#4F647A]">Gerar dossiê</Link>
        <Link href={`/analises/${item.analysis_id}`} className="rounded-[8px] border border-[#D7E1EC] px-3 py-1.5 text-[11px] font-medium text-[#4F647A]">Submeter para aprovação</Link>
      </div>
    </article>
  );
}
