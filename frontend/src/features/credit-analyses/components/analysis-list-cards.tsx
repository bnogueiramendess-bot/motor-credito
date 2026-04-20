import Link from "next/link";

import { CreditAnalysisListApiResponse } from "@/features/credit-analyses/api/contracts";
import { StatusBadge } from "@/features/credit-analyses/components/status-badge";
import { formatCurrency, formatDateTime } from "@/features/credit-analyses/utils/formatters";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/components/ui/card";

type AnalysisListCardsProps = {
  analyses: CreditAnalysisListApiResponse;
};

export function AnalysisListCards({ analyses }: AnalysisListCardsProps) {
  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h2 className="text-xl font-semibold text-slate-900">Analises de credito</h2>
        <p className="text-sm text-slate-600">Acompanhe os dados reais retornados pelo motor e pelas decisoes registradas.</p>
      </header>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {analyses.map((analysis) => (
          <Card key={analysis.id} className="border-border/70 bg-white/90 shadow-sm">
            <CardHeader className="space-y-3">
              <div className="space-y-1">
                <CardTitle className="text-base">{analysis.customer?.company_name ?? `Cliente #${analysis.customer_id}`}</CardTitle>
                <CardDescription>Protocolo {analysis.protocol_number}</CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <StatusBadge type="analysis" value={analysis.analysis_status} />
                <StatusBadge type="decision" value={analysis.motor_result} />
                <StatusBadge type="decision" value={analysis.final_decision} />
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <dl className="grid gap-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-500">Score</dt>
                  <dd className="font-medium text-slate-900">{analysis.score ? analysis.score.final_score : "Nao calculado"}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-500">Faixa</dt>
                  <dd className="font-medium text-slate-900">{analysis.score?.score_band ?? "Nao calculada"}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-500">Limite sugerido</dt>
                  <dd className="font-medium text-slate-900">{formatCurrency(analysis.suggested_limit)}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-500">Criada em</dt>
                  <dd className="font-medium text-slate-900">{formatDateTime(analysis.created_at)}</dd>
                </div>
              </dl>

              <Button asChild className="w-full" variant="outline">
                <Link href={`/analises/${analysis.id}`}>Ver detalhe da analise</Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
