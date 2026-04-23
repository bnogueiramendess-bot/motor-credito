"use client";

import { ReactNode } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/components/ui/card";

export type AnalysisDataStepData = {
  revenue: string;
  debt: string;
  history: string;
  externalScore: string;
};

type StepAnalysisDataProps = {
  value: AnalysisDataStepData;
  onChange: (patch: Partial<AnalysisDataStepData>) => void;
};

const inputBaseClass =
  "mt-2 h-10 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground transition-all outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20";

function LightCard({
  title,
  description,
  children
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border/80 bg-muted/20 p-4 transition-all duration-200 hover:border-primary/30 hover:bg-primary/[0.03]">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      <div className="mt-4">{children}</div>
    </div>
  );
}

export function StepAnalysisData({ value, onChange }: StepAnalysisDataProps) {
  return (
    <Card className="rounded-xl">
      <CardHeader className="pb-4">
        <CardTitle>Base analítica</CardTitle>
        <CardDescription>Preencha os dados que alimentam o motor de análise de crédito.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-2">
          <LightCard title="Faturamento" description="Base de receita para mensurar capacidade de pagamento.">
            <input
              value={value.revenue}
              onChange={(event) => onChange({ revenue: event.target.value })}
              placeholder="Ex.: R$ 4.200.000,00 / ano"
              className={inputBaseClass}
            />
          </LightCard>

          <LightCard title="Endividamento" description="Compromissos financeiros atuais da empresa.">
            <input
              value={value.debt}
              onChange={(event) => onChange({ debt: event.target.value })}
              placeholder="Ex.: R$ 1.100.000,00"
              className={inputBaseClass}
            />
          </LightCard>

          <LightCard title="Histórico" description="Resumo da performance e comportamento de crédito recente.">
            <textarea
              value={value.history}
              onChange={(event) => onChange({ history: event.target.value })}
              placeholder="Ex.: adimplente nos últimos 24 meses..."
              className="min-h-[92px] w-full rounded-xl border border-input bg-background p-3 text-sm text-foreground transition-all outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </LightCard>

          <LightCard title="Score externo (opcional)" description="Se existir, informe o score de bureau externo.">
            <input
              value={value.externalScore}
              onChange={(event) => onChange({ externalScore: event.target.value })}
              placeholder="Ex.: 780"
              className={inputBaseClass}
            />
          </LightCard>
        </div>
      </CardContent>
    </Card>
  );
}
