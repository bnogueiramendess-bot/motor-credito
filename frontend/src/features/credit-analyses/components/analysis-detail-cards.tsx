import { CreditAnalysisDetailApiResponse } from "@/features/credit-analyses/api/contracts";
import { StatusBadge } from "@/features/credit-analyses/components/status-badge";
import { formatCurrency, formatDate, formatDateTime } from "@/features/credit-analyses/utils/formatters";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Separator } from "@/shared/components/ui/separator";

type AnalysisDetailCardsProps = {
  data: CreditAnalysisDetailApiResponse;
};

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  );
}

export function AnalysisDetailCards({ data }: AnalysisDetailCardsProps) {
  const { analysis, customer, score, decision, final_decision: finalDecision } = data;

  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <Card className="xl:col-span-1">
        <CardHeader>
          <CardTitle className="text-base">Dados do cliente</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <InfoItem label="Razao social" value={customer?.company_name ?? "Cliente nao encontrado"} />
          <InfoItem label="Documento" value={customer?.document_number ?? "Nao informado"} />
          <InfoItem label="Segmento" value={customer?.segment ?? "Nao informado"} />
          <InfoItem label="Regiao" value={customer?.region ?? "Nao informado"} />
          <InfoItem label="Inicio do relacionamento" value={formatDate(customer?.relationship_start_date)} />
        </CardContent>
      </Card>

      <Card className="xl:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Resumo da analise</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <InfoItem label="Protocolo" value={analysis.protocol_number} />
            <InfoItem label="Score" value={score ? String(score.final_score) : "Nao calculado"} />
            <InfoItem label="Faixa de score" value={score?.score_band ?? "Nao calculada"} />
            <InfoItem label="Limite solicitado" value={formatCurrency(analysis.requested_limit)} />
            <InfoItem label="Limite sugerido" value={formatCurrency(decision?.suggested_limit ?? analysis.suggested_limit)} />
            <InfoItem label="Limite final" value={formatCurrency(finalDecision?.final_limit ?? analysis.final_limit)} />
          </div>

          <Separator />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Decisao do motor</p>
              <StatusBadge type="decision" value={decision?.motor_result ?? analysis.motor_result} />
            </div>
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Decisao final do analista</p>
              <StatusBadge type="decision" value={finalDecision?.final_decision ?? analysis.final_decision} />
            </div>
          </div>

          <Separator />

          <div className="grid gap-4 sm:grid-cols-2">
            <InfoItem label="Analista responsavel" value={analysis.assigned_analyst_name ?? "Nao atribuido"} />
            <InfoItem label="Concluida em" value={formatDateTime(finalDecision?.completed_at ?? analysis.completed_at)} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
