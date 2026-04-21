import { SourceViewModel } from "@/features/external-data/utils/external-data-view-models";
import { entryMethodLabel, sourceTypeLabel } from "@/features/external-data/utils/labels";
import { formatDate, formatDateTime } from "@/features/credit-analyses/utils/formatters";
import { Badge } from "@/shared/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/components/ui/table";

type ExternalDataSourcesTableProps = {
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

export function ExternalDataSourcesTable({ sources }: ExternalDataSourcesTableProps) {
  return (
    <article className="rounded-[10px] border border-[#e2e5eb] bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-[13px] font-medium text-[#111827]">Fontes consultadas</p>
        <p className="text-[11px] text-[#6b7280]">{sources.length} registro(s)</p>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Fonte</TableHead>
            <TableHead>Metodo</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Data do Relatorio</TableHead>
            <TableHead className="text-right">Arquivos</TableHead>
            <TableHead>Coleta</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sources.map((source) => {
            const status = sourceStatusLabel(source.status);
            return (
              <TableRow key={source.id}>
                <TableCell className="font-medium text-[#111827]">{sourceTypeLabel(source.source_type)}</TableCell>
                <TableCell>{entryMethodLabel(source.entry_method)}</TableCell>
                <TableCell>
                  <Badge variant={status.variant}>{status.label}</Badge>
                </TableCell>
                <TableCell>{formatDate(source.report_date)}</TableCell>
                <TableCell className="text-right">{source.files.length}</TableCell>
                <TableCell>{formatDateTime(source.created_at)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </article>
  );
}
