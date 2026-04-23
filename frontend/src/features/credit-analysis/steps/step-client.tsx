"use client";

import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/components/ui/card";

export type ClientStepData = {
  cnpj: string;
  companyName: string;
  segment: string;
  region: string;
};

type StepClientProps = {
  value: ClientStepData;
  isFetchingData: boolean;
  onChange: (patch: Partial<ClientStepData>) => void;
  onFetchData: () => void;
};

function formatCnpj(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 14);
  return digits
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

const inputBaseClass =
  "mt-2 h-10 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground transition-all outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20";

export function StepClient({ value, isFetchingData, onChange, onFetchData }: StepClientProps) {
  return (
    <Card className="rounded-xl">
      <CardHeader className="pb-4">
        <CardTitle>Dados do cliente</CardTitle>
        <CardDescription>Informe o CNPJ e complete os dados cadastrais para iniciar a análise.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row">
          <label className="flex-1 text-sm font-medium text-foreground">
            CNPJ
            <input
              value={value.cnpj}
              onChange={(event) => onChange({ cnpj: formatCnpj(event.target.value) })}
              placeholder="00.000.000/0000-00"
              className={inputBaseClass}
            />
          </label>
          <div className="sm:pt-7">
            <Button
              type="button"
              variant="outline"
              onClick={onFetchData}
              disabled={isFetchingData}
              className="w-full transition-all hover:-translate-y-0.5 sm:w-auto"
            >
              {isFetchingData ? "Buscando..." : "Buscar dados"}
            </Button>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium text-foreground">
            Razão social
            <input
              value={value.companyName}
              onChange={(event) => onChange({ companyName: event.target.value })}
              placeholder="Ex.: Indústria Horizonte S/A"
              className={inputBaseClass}
            />
          </label>
          <label className="text-sm font-medium text-foreground">
            Segmento
            <input
              value={value.segment}
              onChange={(event) => onChange({ segment: event.target.value })}
              placeholder="Ex.: Metalurgia"
              className={inputBaseClass}
            />
          </label>
          <label className="text-sm font-medium text-foreground sm:col-span-2">
            Região
            <input
              value={value.region}
              onChange={(event) => onChange({ region: event.target.value })}
              placeholder="Ex.: Sudeste"
              className={inputBaseClass}
            />
          </label>
        </div>
      </CardContent>
    </Card>
  );
}

