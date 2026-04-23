"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/components/ui/card";

export type OperationStepData = {
  requestedAmount: string;
  term: string;
  modality: string;
  guarantees: string;
};

type StepOperationProps = {
  value: OperationStepData;
  onChange: (patch: Partial<OperationStepData>) => void;
};

const inputBaseClass =
  "mt-2 h-10 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground transition-all outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20";

export function StepOperation({ value, onChange }: StepOperationProps) {
  return (
    <Card className="rounded-xl">
      <CardHeader className="pb-4">
        <CardTitle>Dados da operação</CardTitle>
        <CardDescription>Defina as condições da operação a ser submetida ao motor.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm font-medium text-foreground">
            Valor solicitado
            <input
              value={value.requestedAmount}
              onChange={(event) => onChange({ requestedAmount: event.target.value })}
              placeholder="Ex.: R$ 350.000,00"
              className={inputBaseClass}
            />
          </label>

          <label className="text-sm font-medium text-foreground">
            Prazo
            <input
              value={value.term}
              onChange={(event) => onChange({ term: event.target.value })}
              placeholder="Ex.: 24 meses"
              className={inputBaseClass}
            />
          </label>

          <label className="text-sm font-medium text-foreground">
            Modalidade
            <input
              value={value.modality}
              onChange={(event) => onChange({ modality: event.target.value })}
              placeholder="Ex.: Capital de giro"
              className={inputBaseClass}
            />
          </label>

          <label className="text-sm font-medium text-foreground">
            Garantias
            <input
              value={value.guarantees}
              onChange={(event) => onChange({ guarantees: event.target.value })}
              placeholder="Ex.: Recebíveis + aval"
              className={inputBaseClass}
            />
          </label>
        </div>
      </CardContent>
    </Card>
  );
}

