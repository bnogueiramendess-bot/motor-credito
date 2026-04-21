import { FileX2 } from "lucide-react";

import { SourceViewModel } from "@/features/external-data/utils/external-data-view-models";
import { entryMethodLabel, sourceTypeLabel } from "@/features/external-data/utils/labels";
import { formatCurrency, formatDate, formatDateTime } from "@/features/credit-analyses/utils/formatters";
import { Badge } from "@/shared/components/ui/badge";

type ExternalDataSourceDetailsProps = {
  sources: SourceViewModel[];
};

function sourceStatusLabel(status: SourceViewModel["status"]) {
  if (status === "completed") {
    return { label: "Com retorno", variant: "success" as const };
  }
  if (status === "failed") {
    return { label: "Falha", variant: "danger" as const };
  }
  return { label: "Sem retorno", variant: "warning" as const };
}

function valueOrFallback(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return "Nao informado";
  }
  return String(value);
}

export function ExternalDataSourceDetails({ sources }: ExternalDataSourceDetailsProps) {
  return (
    <article className="rounded-[10px] border border-[#e2e5eb] bg-white p-4">
      <p className="mb-3 text-[13px] font-medium text-[#111827]">Detalhes por fonte</p>

      <div className="space-y-2">
        {sources.map((source) => {
          const status = sourceStatusLabel(source.status);
          return (
            <details key={source.id} className="rounded-[8px] border border-[#e5e7eb] bg-[#fafafa] open:bg-white">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-[12px] font-medium text-[#111827]">
                    {sourceTypeLabel(source.source_type)} #{source.id}
                  </p>
                  <p className="text-[11px] text-[#6b7280]">
                    {entryMethodLabel(source.entry_method)} • {formatDateTime(source.created_at)}
                  </p>
                </div>
                <Badge variant={status.variant}>{status.label}</Badge>
              </summary>

              <div className="space-y-3 border-t border-[#edf0f2] px-3 py-3">
                {source.detail_fetch_status === "failed" ? (
                  <div className="flex items-start gap-2 rounded-[8px] border border-rose-200 bg-rose-50 p-3">
                    <FileX2 className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                    <p className="text-[11px] text-rose-700">Detalhe indisponivel para esta fonte: {source.detail_fetch_error ?? "erro nao informado"}.</p>
                  </div>
                ) : (
                  <>
                    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-[6px] bg-[#f9fafb] p-2">
                        <p className="text-[10px] text-[#9ca3af]">Data do relatorio</p>
                        <p className="text-[12px] font-medium text-[#111827]">{formatDate(source.report_date)}</p>
                      </div>
                      <div className="rounded-[6px] bg-[#f9fafb] p-2">
                        <p className="text-[10px] text-[#9ca3af]">Score da fonte</p>
                        <p className="text-[12px] font-medium text-[#111827]">{valueOrFallback(source.source_score)}</p>
                      </div>
                      <div className="rounded-[6px] bg-[#f9fafb] p-2">
                        <p className="text-[10px] text-[#9ca3af]">Rating</p>
                        <p className="text-[12px] font-medium text-[#111827]">{valueOrFallback(source.source_rating)}</p>
                      </div>
                      <div className="rounded-[6px] bg-[#f9fafb] p-2">
                        <p className="text-[10px] text-[#9ca3af]">Restricoes</p>
                        <p className="text-[12px] font-medium text-[#111827]">{source.has_restrictions ? "Sim" : "Nao"}</p>
                      </div>
                    </div>

                    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-[6px] border border-[#edf0f2] p-2">
                        <p className="text-[10px] text-[#9ca3af]">Protestos</p>
                        <p className="text-[12px] text-[#111827]">
                          {source.protests_count} • {formatCurrency(source.protests_amount)}
                        </p>
                      </div>
                      <div className="rounded-[6px] border border-[#edf0f2] p-2">
                        <p className="text-[10px] text-[#9ca3af]">Acoes judiciais</p>
                        <p className="text-[12px] text-[#111827]">
                          {source.lawsuits_count} • {formatCurrency(source.lawsuits_amount)}
                        </p>
                      </div>
                      <div className="rounded-[6px] border border-[#edf0f2] p-2">
                        <p className="text-[10px] text-[#9ca3af]">Cheques sem fundo</p>
                        <p className="text-[12px] text-[#111827]">{source.bounced_checks_count}</p>
                      </div>
                      <div className="rounded-[6px] border border-[#edf0f2] p-2">
                        <p className="text-[10px] text-[#9ca3af]">Arquivos vinculados</p>
                        <p className="text-[12px] text-[#111827]">{source.files.length}</p>
                      </div>
                    </div>

                    <div className="grid gap-2 md:grid-cols-2">
                      <div className="rounded-[6px] border border-[#edf0f2] p-2">
                        <p className="text-[10px] text-[#9ca3af]">Receita declarada</p>
                        <p className="text-[12px] text-[#111827]">{formatCurrency(source.declared_revenue)}</p>
                      </div>
                      <div className="rounded-[6px] border border-[#edf0f2] p-2">
                        <p className="text-[10px] text-[#9ca3af]">Endividamento declarado</p>
                        <p className="text-[12px] text-[#111827]">{formatCurrency(source.declared_indebtedness)}</p>
                      </div>
                    </div>

                    <div className="rounded-[6px] border border-[#edf0f2] p-2">
                      <p className="text-[10px] text-[#9ca3af]">Observacoes</p>
                      <p className="text-[12px] text-[#111827]">{valueOrFallback(source.notes)}</p>
                    </div>

                    <div className="rounded-[6px] border border-[#edf0f2] p-2">
                      <p className="text-[10px] text-[#9ca3af]">Arquivos</p>
                      {source.files.length ? (
                        <div className="mt-1 space-y-1">
                          {source.files.map((file) => (
                            <p key={file.id} className="break-all text-[11px] text-[#374151]">
                              {file.original_filename} • {file.mime_type} • {file.file_size} bytes
                            </p>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[12px] text-[#6b7280]">Nenhum arquivo vinculado.</p>
                      )}
                    </div>
                  </>
                )}
              </div>
            </details>
          );
        })}
      </div>
    </article>
  );
}
