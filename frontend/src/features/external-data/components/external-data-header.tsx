import { Building2, FileSearch } from "lucide-react";

import { CreditAnalysisDto, CustomerDto } from "@/features/credit-analyses/api/contracts";
import { analysisStatusLabel } from "@/features/credit-analyses/utils/labels";
import { formatCurrency, formatDate } from "@/features/credit-analyses/utils/formatters";
import { Badge } from "@/shared/components/ui/badge";

type ExternalDataHeaderProps = {
  analysis: CreditAnalysisDto;
  customer: CustomerDto | null;
};

export function ExternalDataHeader({ analysis, customer }: ExternalDataHeaderProps) {
  return (
    <article className="rounded-[10px] border border-[#e2e5eb] bg-white px-4 py-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#6b7280]">Contexto da analise</p>
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-[#e8edf7] text-[#1a2b5e]">
              <Building2 className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-[15px] font-medium text-[#111827]">{customer?.company_name ?? `Cliente #${analysis.customer_id}`}</p>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[#6b7280]">
                <p>
                  CNPJ: <span className="font-medium text-[#374151]">{customer?.document_number ?? "Nao informado"}</span>
                </p>
                <p>
                  Protocolo: <span className="font-medium text-[#374151]">{analysis.protocol_number}</span>
                </p>
                <p>
                  Limite solicitado: <span className="font-medium text-[#374151]">{formatCurrency(analysis.requested_limit)}</span>
                </p>
                <p>
                  Relacionamento: <span className="font-medium text-[#374151]">{formatDate(customer?.relationship_start_date)}</span>
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="secondary" className="gap-1 rounded-[6px] px-2 py-1 text-[10px]">
            <FileSearch className="h-3 w-3" />
            Dados Externos
          </Badge>
          <Badge variant="outline" className="rounded-[6px] px-2 py-1 text-[10px]">
            {analysisStatusLabel(analysis.analysis_status)}
          </Badge>
        </div>
      </div>
    </article>
  );
}
