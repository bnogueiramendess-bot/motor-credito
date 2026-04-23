"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { ProcessingOverlay } from "@/features/credit-analysis/components/processing-overlay";
import { Stepper } from "@/features/credit-analysis/components/stepper";
import { AnalysisDataStepData, StepAnalysisData } from "@/features/credit-analysis/steps/step-analysis-data";
import { ClientStepData, StepClient } from "@/features/credit-analysis/steps/step-client";
import { OperationStepData, StepOperation } from "@/features/credit-analysis/steps/step-operation";
import { Alert, AlertDescription, AlertTitle } from "@/shared/components/ui/alert";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/components/ui/card";

const STORAGE_KEY = "credit-analysis:new-wizard:v1";
const PROCESSING_MESSAGES = [
  "Analisando dados...",
  "Aplicando regras de crédito...",
  "Calculando score...",
  "Gerando recomendação..."
] as const;

type WizardState = {
  step: number;
  client: ClientStepData;
  analysisData: AnalysisDataStepData;
  operation: OperationStepData;
};

const initialState: WizardState = {
  step: 1,
  client: {
    cnpj: "",
    companyName: "",
    segment: "",
    region: ""
  },
  analysisData: {
    revenue: "",
    debt: "",
    history: "",
    externalScore: ""
  },
  operation: {
    requestedAmount: "",
    term: "",
    modality: "",
    guarantees: ""
  }
};

function sanitizeDigits(value: string) {
  return value.replace(/\D/g, "");
}

function buildValidationIssues(state: WizardState) {
  const issues: string[] = [];

  if (sanitizeDigits(state.client.cnpj).length !== 14) issues.push("Informe um CNPJ válido");
  if (!state.client.companyName.trim()) issues.push("Informe razão social");
  if (!state.analysisData.revenue.trim()) issues.push("Informe faturamento");
  if (!state.operation.requestedAmount.trim()) issues.push("Informe valor solicitado");

  return issues;
}

function firstInvalidStep(state: WizardState) {
  if (sanitizeDigits(state.client.cnpj).length !== 14 || !state.client.companyName.trim()) return 1;
  if (!state.analysisData.revenue.trim()) return 2;
  if (!state.operation.requestedAmount.trim()) return 3;
  return 4;
}

export function NewCreditAnalysisPageView() {
  const router = useRouter();
  const [state, setState] = useState<WizardState>(initialState);
  const [isFetchingClientData, setIsFetchingClientData] = useState(false);
  const [validationIssues, setValidationIssues] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingMessageIndex, setProcessingMessageIndex] = useState(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw) as WizardState;
      setState((prev) => ({ ...prev, ...parsed, step: Math.min(Math.max(parsed.step ?? 1, 1), 4) }));
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  useEffect(() => {
    if (!isProcessing) return;

    intervalRef.current = setInterval(() => {
      setProcessingMessageIndex((prev) => (prev + 1) % PROCESSING_MESSAGES.length);
    }, 550);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isProcessing]);

  useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (intervalRef.current) clearInterval(intervalRef.current);
    },
    []
  );

  const canGoNext = useMemo(() => {
    if (state.step === 1) {
      return sanitizeDigits(state.client.cnpj).length === 14 && Boolean(state.client.companyName.trim());
    }
    if (state.step === 2) return Boolean(state.analysisData.revenue.trim());
    return false;
  }, [state]);

  function handleBackStep() {
    setValidationIssues([]);
    setState((prev) => ({ ...prev, step: Math.max(1, prev.step - 1) }));
  }

  function handleNextStep() {
    if (!canGoNext) return;
    setValidationIssues([]);
    setState((prev) => ({ ...prev, step: Math.min(3, prev.step + 1) }));
  }

  function handleMockLookup() {
    if (sanitizeDigits(state.client.cnpj).length !== 14 || isFetchingClientData) return;

    setIsFetchingClientData(true);
    setTimeout(() => {
      setState((prev) => ({
        ...prev,
        client: {
          ...prev.client,
          companyName: prev.client.companyName || "Distribuidora Atlântico LTDA",
          segment: prev.client.segment || "Atacado alimentar",
          region: prev.client.region || "Sudeste"
        }
      }));
      setIsFetchingClientData(false);
    }, 650);
  }

  function handleGenerateAnalysis() {
    const issues = buildValidationIssues(state);
    if (issues.length > 0) {
      setValidationIssues(issues);
      setState((prev) => ({ ...prev, step: firstInvalidStep(prev) }));
      return;
    }

    setValidationIssues([]);
    setProcessingMessageIndex(0);
    setState((prev) => ({ ...prev, step: 4 }));
    setIsProcessing(true);

    timeoutRef.current = setTimeout(() => {
      const analysisId = `${Date.now()}`;
      window.localStorage.removeItem(STORAGE_KEY);
      router.push(`/analises/${analysisId}`);
    }, 2000);
  }

  return (
    <section className="readability-standard space-y-6 pb-2">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Nova análise</h1>
        <p className="text-sm text-muted-foreground">Fluxo guiado para montar a operação e gerar recomendação de crédito.</p>
      </header>

      <Stepper currentStep={state.step} />

      {validationIssues.length > 0 ? (
        <Alert variant="destructive" className="rounded-xl shadow-sm">
          <AlertTitle>Dados incompletos</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-1 pl-5">
              {validationIssues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="transition-all duration-300">
        {state.step === 1 ? (
          <StepClient
            value={state.client}
            isFetchingData={isFetchingClientData}
            onFetchData={handleMockLookup}
            onChange={(patch) => setState((prev) => ({ ...prev, client: { ...prev.client, ...patch } }))}
          />
        ) : null}

        {state.step === 2 ? (
          <StepAnalysisData
            value={state.analysisData}
            onChange={(patch) => setState((prev) => ({ ...prev, analysisData: { ...prev.analysisData, ...patch } }))}
          />
        ) : null}

        {state.step === 3 ? (
          <div className="space-y-6">
            <StepOperation
              value={state.operation}
              onChange={(patch) => setState((prev) => ({ ...prev, operation: { ...prev.operation, ...patch } }))}
            />
            <Card className="rounded-xl border-dashed border-2 p-6 text-center">
              <CardHeader className="p-0">
                <CardTitle className="text-xl">Pronto para análise</CardTitle>
                <CardDescription className="mx-auto max-w-xl text-sm">
                  Todos os dados foram informados. Execute o motor de crédito para gerar o rating.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0 pt-6">
                <Button size="lg" onClick={handleGenerateAnalysis} className="min-w-[220px] transition-all hover:-translate-y-0.5">
                  Gerar análise
                </Button>
              </CardContent>
            </Card>
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between rounded-xl border border-border/80 bg-card p-4 shadow-sm">
        <Button variant="outline" onClick={handleBackStep} disabled={state.step === 1} className="transition-all hover:-translate-y-0.5">
          Voltar etapa
        </Button>

        {state.step < 3 ? (
          <Button onClick={handleNextStep} disabled={!canGoNext} className="transition-all hover:-translate-y-0.5">
            Avançar etapa
          </Button>
        ) : null}
      </div>

      <ProcessingOverlay open={isProcessing} message={PROCESSING_MESSAGES[processingMessageIndex]} />
    </section>
  );
}
