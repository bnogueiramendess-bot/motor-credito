"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, Upload, X } from "lucide-react";

import { listCustomers, lookupExternalCnpj, submitAnalysisJourney } from "@/features/analysis-journey/api/analysis-journey.api";
import { AnalysisJourneySubmitRequest, UploadFileMetadataInput } from "@/features/analysis-journey/api/contracts";
import {
  formatCnpj,
  formatCurrencyInputBRL,
  sanitizeDigits,
  toNullableNumberInput,
  toNumberInput
} from "@/features/analysis-journey/utils/formatters";
import { formatCurrencyBRL, resolveManualStatus, resolveUploadStatus } from "@/features/analysis-journey/utils/view-models";
import { ErrorState } from "@/shared/components/states/error-state";

const steps = ["Identificação do cliente", "Informações para análise", "Dados da solicitação", "Revisão e envio"];
type ImportSource = "agrisk" | "coface" | "internal";
type ImportStatus = "empty" | "processing" | "success" | "error";

type ImportState = {
  notes: string;
  files: UploadFileMetadataInput[];
  status: ImportStatus;
  importedAt: string | null;
  errorMessage: string | null;
};

type OcrState = {
  enabled: boolean;
  additionalFields: string;
  files: UploadFileMetadataInput[];
  status: ImportStatus;
  importedAt: string | null;
  errorMessage: string | null;
};

function RequiredMark() {
  return <span className="ml-1 text-[#dc2626]">*</span>;
}

function mapFiles(input: FileList | null): UploadFileMetadataInput[] {
  if (!input) return [];
  return Array.from(input).map((file) => ({
    original_filename: file.name,
    mime_type: file.type || "application/octet-stream",
    file_size: file.size
  }));
}

function labelStatus(status: string) {
  if (status === "enviado" || status === "preenchido") return "border-[#bbf7d0] bg-[#f0fdf4] text-[#166534]";
  if (status.includes("nao enviado") || status.includes("nao preenchido")) return "border-[#fde68a] bg-[#fffbeb] text-[#92400e]";
  return "border-[#e5e7eb] bg-[#f9fafb] text-[#4b5563]";
}

function formatFileSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function toInitials(name: string) {
  const words = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "CL";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

function formatImportedAt(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(date);
}

function buildDefaultImportState(): ImportState {
  return {
    notes: "",
    files: [],
    status: "empty",
    importedAt: null,
    errorMessage: null
  };
}

function buildDefaultOcrState(): OcrState {
  return {
    enabled: false,
    additionalFields: "",
    files: [],
    status: "empty",
    importedAt: null,
    errorMessage: null
  };
}

function statusLabel(status: ImportStatus) {
  if (status === "processing") return "Em processamento";
  if (status === "success") return "Processado com sucesso";
  if (status === "error") return "Erro na leitura";
  return "Sem arquivo";
}

function importMonitorTitle(source: ImportSource) {
  return source === "internal" ? "Base importada" : "Relatório importado";
}

function importMonitorSourceName(source: ImportSource) {
  if (source === "agrisk") return "Origem: Agrisk";
  if (source === "coface") return "Origem: COFACE";
  return "Origem: Importação interna";
}

function importMonitorStatusText(source: ImportSource, status: ImportStatus) {
  if (status === "processing") return "Aguardando processamento";
  if (status === "error") return "Requer novo envio";
  if (source === "coface") return "DRA e indicadores prontos para análise";
  if (source === "internal") return "Dados internos prontos para análise";
  return "Dados prontos para análise";
}

function importMonitorValueText(source: ImportSource) {
  if (source === "agrisk") return "Score, restrições e indicadores extraídos automaticamente.";
  if (source === "coface") return "DRA e indicadores corporativos extraídos automaticamente.";
  return "Títulos, vencimentos e pagamentos vinculados à análise.";
}

function removeActionLabel(source: ImportSource) {
  return source === "internal" ? "Remover arquivo" : "Remover relatório";
}

export function NewAnalysisPageView() {
  const router = useRouter();
  const customersQuery = useQuery({ queryKey: ["customers"], queryFn: listCustomers });

  const [step, setStep] = useState(1);
  const [stepError, setStepError] = useState<string | null>(null);
  const [existingCustomerId, setExistingCustomerId] = useState<number | null>(null);
  const [externalLookupMessage, setExternalLookupMessage] = useState<string | null>(null);

  const [customer, setCustomer] = useState({
    companyName: "",
    cnpj: "",
    segment: "",
    region: "",
    relationshipStartDate: "",
    address: "",
    phone: "",
    email: ""
  });

  const [analysis, setAnalysis] = useState({
    requestedLimit: "R$ 0,00",
    currentLimit: "R$ 0,00",
    usedLimit: "R$ 0,00",
    guaranteeLimit: "R$ 0,00",
    assignedAnalystName: "Backoffice",
    comment: ""
  });

  const [manual, setManual] = useState({
    negativationsCount: "0",
    negativationsAmount: "R$ 0,00",
    protestsCount: "0",
    protestsAmount: "R$ 0,00",
    activeLawsuits: false,
    observations: "",
    comments: "",
    hasCommercialHistory: false,
    commercialHistoryRevenue: "R$ 0,00",
    contractualAvgTermDays: "",
    effectiveAvgTermDays: ""
  });
  const [manualConfigured, setManualConfigured] = useState(false);
  const [ocr, setOcr] = useState<OcrState>(buildDefaultOcrState());
  const [internalImport, setInternalImport] = useState<ImportState>(buildDefaultImportState());
  const [agriskImport, setAgriskImport] = useState<ImportState>(buildDefaultImportState());
  const [cofaceImport, setCofaceImport] = useState<ImportState>(buildDefaultImportState());

  const [importModalSource, setImportModalSource] = useState<ImportSource>("agrisk");
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [pendingImportFile, setPendingImportFile] = useState<UploadFileMetadataInput | null>(null);
  const [pendingImportError, setPendingImportError] = useState<string | null>(null);
  const [isManualDrawerOpen, setIsManualDrawerOpen] = useState(false);
  const [manualPanel, setManualPanel] = useState({
    scoreSource: "Serasa",
    scoreValue: 610,
    cofaceDra: 6.5,
    internalRevenue12m: "",
    outstandingValue: "",
    pmrContractual: "",
    pmrEffective: "",
    analystNotes: ""
  });

  const importInputRef = useRef<HTMLInputElement | null>(null);
  const ocrInputRef = useRef<HTMLInputElement | null>(null);

  const normalizedCnpj = sanitizeDigits(customer.cnpj);
  const matchedCustomers = useMemo(() => {
    if (!customersQuery.data || normalizedCnpj.length !== 14) return [];
    return customersQuery.data.filter((item) => sanitizeDigits(item.document_number) === normalizedCnpj);
  }, [customersQuery.data, normalizedCnpj]);

  const totalLimitCalculated = useMemo(() => {
    return toNumberInput(analysis.requestedLimit) + toNumberInput(analysis.currentLimit) + toNumberInput(analysis.usedLimit);
  }, [analysis.currentLimit, analysis.requestedLimit, analysis.usedLimit]);
  const exposureCalculated = useMemo(() => totalLimitCalculated - toNumberInput(analysis.guaranteeLimit), [analysis.guaranteeLimit, totalLimitCalculated]);
  const currencyFormatter = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const totalLimitDisplay = currencyFormatter.format(totalLimitCalculated);
  const exposureDisplay = currencyFormatter.format(exposureCalculated);

  const hasAgriskImported = agriskImport.files.length > 0;
  const hasCofaceImported = cofaceImport.files.length > 0;
  const hasInternalImported = internalImport.files.length > 0;
  const structuredSourcesCount = [hasAgriskImported, hasCofaceImported, hasInternalImported].filter(Boolean).length;
  const isManualBlocked = hasAgriskImported && hasCofaceImported && hasInternalImported;
  const hasStep2Source = manualConfigured || structuredSourcesCount > 0;
  const isStep2Ready = hasStep2Source;

  useEffect(() => {
    if (!hasAgriskImported) return;
    setManualPanel((prev) => (prev.scoreSource === "Agrisk" ? { ...prev, scoreSource: "Serasa" } : prev));
  }, [hasAgriskImported]);

  const submitMutation = useMutation({
    mutationFn: (payload: AnalysisJourneySubmitRequest) => submitAnalysisJourney(payload),
    onSuccess: (response) => router.push(`/analises/${response.analysis_id}`)
  });

  const lookupMutation = useMutation({
    mutationFn: (cnpj: string) => lookupExternalCnpj(cnpj),
    onSuccess: (response) => {
      if (response.status !== "ok" || !response.data) {
        setExternalLookupMessage(response.message ?? "Não foi possível consultar os dados externos no momento.");
        return;
      }

      const addr = response.data.address;
      const parts = [addr.logradouro, addr.numero, addr.complemento, addr.bairro, addr.municipio, addr.uf].filter(Boolean);
      const address = [parts.join(", "), addr.cep].filter(Boolean).join(" - ");

      setCustomer((prev) => ({
        ...prev,
        companyName: response.data?.razao_social || prev.companyName,
        phone: response.data?.telefone || prev.phone,
        email: response.data?.email || prev.email,
        address: address || prev.address
      }));
      setExternalLookupMessage("Dados cadastrais localizados automaticamente. Você poderá revisar e editar na próxima etapa.");
    },
    onError: () => setExternalLookupMessage("A consulta externa está indisponível no momento. Se necessário, informe os dados manualmente.")
  });

  const manualStatus = resolveManualStatus({ ...manual, enabled: manualConfigured });
  const ocrStatus = resolveUploadStatus(ocr);
  const internalStatus = resolveUploadStatus({ enabled: internalImport.files.length > 0, files: internalImport.files });
  const agriskStatus = resolveUploadStatus({ enabled: agriskImport.files.length > 0, files: agriskImport.files });
  const cofaceStatus = resolveUploadStatus({ enabled: cofaceImport.files.length > 0, files: cofaceImport.files });

  function reuseCustomer(customerId: number) {
    const target = customersQuery.data?.find((item) => item.id === customerId);
    if (!target) return;
    setExistingCustomerId(target.id);
    setCustomer((prev) => ({
      ...prev,
      companyName: target.company_name,
      cnpj: formatCnpj(target.document_number),
      segment: target.segment,
      region: target.region,
      relationshipStartDate: target.relationship_start_date ?? ""
    }));
  }

  function handleCnpjBlur() {
    if (existingCustomerId || normalizedCnpj.length !== 14) return;
    setExternalLookupMessage(null);
    lookupMutation.mutate(normalizedCnpj);
  }

  function validateStep(stepNumber: number): string | null {
    if (stepNumber === 1) {
      if (normalizedCnpj.length !== 14) return "Preencha um CNPJ válido para continuar.";
      if (!customer.companyName.trim()) return "Preencha a razão social para continuar.";
    }

    if (stepNumber === 2 && !hasStep2Source) {
      return "Selecione ao menos uma fonte de dados para continuar.";
    }

    if (stepNumber === 3 && toNumberInput(analysis.requestedLimit) <= 0) {
      return "Preencha Limite solicitado com valor maior que zero.";
    }

    return null;
  }

  function navigateToStep(targetStep: number) {
    if (targetStep === step) return;
    if (targetStep < step) {
      setStepError(null);
      setStep(targetStep);
      return;
    }
    for (let s = step; s < targetStep; s += 1) {
      const error = validateStep(s);
      if (error) {
        setStepError(`Não é possível avançar para a etapa ${targetStep}. ${error}`);
        return;
      }
    }
    setStepError(null);
    setStep(targetStep);
  }

  function openImportModal(source: ImportSource) {
    setImportModalSource(source);
    setPendingImportFile(
      source === "agrisk" ? agriskImport.files[0] ?? null : source === "coface" ? cofaceImport.files[0] ?? null : internalImport.files[0] ?? null
    );
    setPendingImportError(null);
    setIsImportModalOpen(true);
  }

  function handleImportFileChange(files: FileList | null) {
    const parsed = mapFiles(files);
    const selected = parsed[0] ?? null;
    if (!selected) {
      setPendingImportFile(null);
      setPendingImportError(null);
      return;
    }

    if (selected.file_size > 10 * 1024 * 1024) {
      setPendingImportFile(null);
      setPendingImportError("Arquivo inválido. O tamanho máximo permitido é 10 MB.");
      if (importModalSource === "agrisk") {
        setAgriskImport((prev) => ({ ...prev, status: "error", errorMessage: "Falha na leitura do arquivo (tamanho excedido)." }));
      } else if (importModalSource === "coface") {
        setCofaceImport((prev) => ({ ...prev, status: "error", errorMessage: "Falha na leitura do arquivo (tamanho excedido)." }));
      } else {
        setInternalImport((prev) => ({ ...prev, status: "error", errorMessage: "Falha na leitura do arquivo (tamanho excedido)." }));
      }
      return;
    }

    setPendingImportError(null);
    setPendingImportFile(selected);
  }

  function confirmImport() {
    if (!pendingImportFile) return;
    const importedAt = new Date().toISOString();

    if (importModalSource === "agrisk") {
      setAgriskImport((prev) => ({ ...prev, files: [pendingImportFile], status: "processing", importedAt, errorMessage: null }));
      setTimeout(() => {
        setAgriskImport((prev) => (prev.files.length > 0 ? { ...prev, status: "success" } : prev));
      }, 900);
    } else if (importModalSource === "coface") {
      setCofaceImport((prev) => ({ ...prev, files: [pendingImportFile], status: "processing", importedAt, errorMessage: null }));
      setTimeout(() => {
        setCofaceImport((prev) => (prev.files.length > 0 ? { ...prev, status: "success" } : prev));
      }, 900);
    } else {
      setInternalImport((prev) => ({ ...prev, files: [pendingImportFile], status: "processing", importedAt, errorMessage: null }));
      setTimeout(() => {
        setInternalImport((prev) => (prev.files.length > 0 ? { ...prev, status: "success" } : prev));
      }, 900);
    }

    setPendingImportError(null);
    setIsImportModalOpen(false);
  }

  function removeImport(source: ImportSource) {
    const shouldRemove = window.confirm(
      source === "internal" ? "Deseja remover o arquivo importado desta fonte?" : "Deseja remover o relatório importado desta fonte?"
    );
    if (!shouldRemove) return;
    if (source === "agrisk") {
      setAgriskImport(buildDefaultImportState());
      return;
    }
    if (source === "coface") {
      setCofaceImport(buildDefaultImportState());
      return;
    }
    setInternalImport(buildDefaultImportState());
  }

  function handleOcrFileChange(files: FileList | null) {
    const parsed = mapFiles(files);
    const selected = parsed[0] ?? null;
    if (!selected) return;

    if (selected.file_size > 10 * 1024 * 1024) {
      setOcr((prev) => ({
        ...prev,
        enabled: false,
        files: [],
        status: "error",
        importedAt: null,
        errorMessage: "Falha na leitura do arquivo (tamanho excedido)."
      }));
      return;
    }

    const importedAt = new Date().toISOString();
    setOcr((prev) => ({
      ...prev,
      enabled: true,
      files: [selected],
      status: "processing",
      importedAt,
      errorMessage: null
    }));
    setTimeout(() => {
      setOcr((prev) => (prev.files.length > 0 ? { ...prev, status: "success" } : prev));
    }, 900);
  }

  function removeOcrImport() {
    const shouldRemove = window.confirm("Deseja remover o demonstrativo importado?");
    if (!shouldRemove) return;
    setOcr(buildDefaultOcrState());
  }

  function saveManualDrawer() {
    const scoreIsFromImportedAgrisk = hasAgriskImported && manualPanel.scoreSource === "Agrisk";
    const cofaceIsFromImportedReport = hasCofaceImported;

    setManualConfigured(true);
    setManual((prev) => ({
      ...prev,
      comments: manualPanel.analystNotes,
      observations: `Fonte do score: ${scoreIsFromImportedAgrisk ? "Agrisk (importado)" : manualPanel.scoreSource}; Score: ${scoreIsFromImportedAgrisk ? "informado por relatório importado" : manualPanel.scoreValue}; DRA COFACE: ${cofaceIsFromImportedReport ? "informado por relatório importado" : manualPanel.cofaceDra}; Faturamento interno 12 meses: ${manualPanel.internalRevenue12m || "não informado"}`
    }));
    setIsManualDrawerOpen(false);
  }

  function submit() {
    const payload: AnalysisJourneySubmitRequest = {
      existing_customer_id: existingCustomerId,
      customer: {
        company_name: customer.companyName,
        document_number: sanitizeDigits(customer.cnpj),
        segment: customer.segment,
        region: customer.region,
        relationship_start_date: customer.relationshipStartDate || null,
        address: customer.address,
        phone: customer.phone
      },
      analysis: {
        requested_limit: toNumberInput(analysis.requestedLimit),
        current_limit: toNumberInput(analysis.currentLimit),
        exposure_amount: exposureCalculated,
        annual_revenue_estimated: toNumberInput(manualPanel.internalRevenue12m),
        assigned_analyst_name: analysis.assignedAnalystName
      },
      inputs: {
        manual: {
          enabled: manualConfigured,
          negativations_count: Number(manual.negativationsCount || 0),
          negativations_amount: toNumberInput(manual.negativationsAmount),
          protests_count: Number(manual.protestsCount || 0),
          protests_amount: toNumberInput(manual.protestsAmount),
          active_lawsuits: manual.activeLawsuits,
          observations: manual.observations,
          comments: manual.comments,
          has_commercial_history: manualConfigured ? manual.hasCommercialHistory : false,
          commercial_history_revenue: manualConfigured && manual.hasCommercialHistory ? toNullableNumberInput(manual.commercialHistoryRevenue) : null,
          contractual_avg_term_days: manualConfigured && manual.hasCommercialHistory ? toNullableNumberInput(manual.contractualAvgTermDays) : null,
          effective_avg_term_days: manualConfigured && manual.hasCommercialHistory ? toNullableNumberInput(manual.effectiveAvgTermDays) : null
        },
        ocr: {
          enabled: ocr.enabled,
          active: null,
          liabilities: null,
          equity: null,
          gross_revenue: null,
          net_revenue: null,
          costs: null,
          expenses: null,
          profit: null,
          additional_fields: ocr.additionalFields,
          files: ocr.files
        },
        internal_import: {
          enabled: internalImport.files.length > 0,
          rows_count: null,
          template_validated: internalImport.files.length > 0,
          notes: internalImport.notes,
          files: internalImport.files
        },
        external_import: {
          enabled: hasAgriskImported || hasCofaceImported,
          source_type: hasAgriskImported ? "agrisk" : hasCofaceImported ? "other" : "agrisk",
          source_score: manualConfigured ? manualPanel.scoreValue : null,
          source_rating: manualConfigured ? `Fonte manual: ${manualPanel.scoreSource}` : "",
          negativations_count: Number(manual.negativationsCount || 0),
          protests_count: Number(manual.protestsCount || 0),
          lawsuits_count: manual.activeLawsuits ? 1 : 0,
          has_restrictions: false,
          notes: [
            hasAgriskImported ? "Agrisk importado" : "",
            hasCofaceImported ? "COFACE importado" : "",
            manualConfigured && !hasCofaceImported ? `DRA COFACE manual: ${manualPanel.cofaceDra || "não informado"}` : ""
          ]
            .filter(Boolean)
            .join(" · "),
          files: [...agriskImport.files, ...cofaceImport.files]
        }
      }
    };
    submitMutation.mutate(payload);
  }

  if (customersQuery.isError) {
    return <ErrorState title="Não foi possível carregar clientes" description={customersQuery.error.message} onRetry={() => customersQuery.refetch()} />;
  }

  const canContinue = step === 1 ? normalizedCnpj.length === 14 && Boolean(customer.companyName) : step === 2 ? hasStep2Source : step === 3 ? toNumberInput(analysis.requestedLimit) > 0 : true;

  return (
    <section className="readability-standard space-y-4">
      <div className="flex items-center justify-between rounded-[14px] border border-[#D7E1EC] bg-white px-6 py-5">
        <div>
          <p className="text-[17px] font-semibold text-[#102033]">Nova análise de crédito</p>
          <p className="text-[13px] text-[#4F647A]">
            Identifique o cliente, informe os dados da solicitação e reúna as informações necessárias para análise de crédito.
          </p>
          <p className="mt-1 text-[11px] text-[#8FA3B4]">A consulta externa é opcional. Se necessário, os dados podem ser informados manualmente.</p>
        </div>
        <Link href="/analises" className="rounded-[8px] border border-[#D7E1EC] bg-white px-4 py-2 text-[12px] font-medium text-[#4F647A] hover:bg-[#f9fafb]">
          <span className="mr-1">←</span> Voltar para análises
        </Link>
      </div>

      <div className="flex items-center rounded-[12px] border border-[#D7E1EC] bg-white px-6 py-4">
        {steps.map((label, index) => {
          const stepNumber = index + 1;
          const isDone = stepNumber < step;
          const isActive = stepNumber === step;
          return (
            <div key={label} className="flex flex-1 items-center">
              <button type="button" onClick={() => navigateToStep(stepNumber)} className="flex items-center gap-2 text-left">
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold ${
                    isDone ? "bg-[#295B9A] text-white" : isActive ? "bg-[#0D1B2A] text-white ring-2 ring-[#295B9A]/20" : "bg-[#EEF3F8] text-[#8FA3B4]"
                  }`}
                >
                  {isDone ? <Check className="h-3.5 w-3.5" /> : stepNumber}
                </span>
                <span className={`text-[11px] font-medium ${isDone ? "text-[#295B9A]" : isActive ? "text-[#102033]" : "text-[#8FA3B4]"}`}>{label}</span>
              </button>
              {index !== steps.length - 1 ? <div className={`mx-3 h-px flex-1 ${isDone ? "bg-[#295B9A]" : "bg-[#D7E1EC]"}`} /> : null}
            </div>
          );
        })}
      </div>

      {stepError ? <div className="rounded-[8px] border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[12px] text-[#b91c1c]">{stepError}</div> : null}

      {step === 1 ? (
        <article className="space-y-3 rounded-[10px] border border-[#e2e5eb] bg-white p-4">
          <p className="text-[13px] font-medium text-[#111827]">Informe o CNPJ para identificar o cliente</p>
          <label className="block text-[12px] text-[#374151]">
            CNPJ<RequiredMark />
            <input
              value={customer.cnpj}
              onChange={(event) => {
                setExistingCustomerId(null);
                setCustomer((prev) => ({ ...prev, cnpj: formatCnpj(event.target.value) }));
              }}
              onBlur={handleCnpjBlur}
              className="mt-1 h-9 w-full rounded-[6px] border border-[#d1d5db] px-3 text-[12px]"
              placeholder="00.000.000/0000-00"
            />
          </label>
          <p className="text-[12px] text-[#6b7280]">
            {lookupMutation.isPending ? "Consultando dados cadastrais..." : externalLookupMessage ?? "A consulta externa é opcional. Se necessário, os dados podem ser informados manualmente."}
          </p>

          {matchedCustomers.map((item) => (
            <div key={item.id} className="flex items-center justify-between rounded-[8px] border border-[#bbf7d0] bg-[#f0fdf4] p-3 text-[12px]">
              <span>{item.company_name}</span>
              <button type="button" onClick={() => reuseCustomer(item.id)} className="rounded-[6px] bg-[#166534] px-3 py-1 text-[11px] text-white">
                Reaproveitar cadastro
              </button>
            </div>
          ))}

          <div className="rounded-[8px] border border-[#e2e5eb] bg-[#f9fafb] p-3">
            <p className="mb-2 text-[12px] font-medium text-[#111827]">Dados do cliente</p>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-[11px] text-[#374151]">
                Razão social<RequiredMark />
                <input value={customer.companyName} onChange={(event) => setCustomer((prev) => ({ ...prev, companyName: event.target.value }))} className="mt-1 h-9 w-full rounded-[6px] border px-3 text-[12px]" />
              </label>
              <label className="text-[11px] text-[#374151]">Segmento<input value={customer.segment} onChange={(event) => setCustomer((prev) => ({ ...prev, segment: event.target.value }))} className="mt-1 h-9 w-full rounded-[6px] border px-3 text-[12px]" /></label>
              <label className="text-[11px] text-[#374151]">Região<input value={customer.region} onChange={(event) => setCustomer((prev) => ({ ...prev, region: event.target.value }))} className="mt-1 h-9 w-full rounded-[6px] border px-3 text-[12px]" /></label>
              <label className="text-[11px] text-[#374151]">Data de relacionamento<input type="date" value={customer.relationshipStartDate} onChange={(event) => setCustomer((prev) => ({ ...prev, relationshipStartDate: event.target.value }))} className="mt-1 h-9 w-full rounded-[6px] border px-3 text-[12px]" /></label>
              <label className="text-[11px] text-[#374151]">Endereço<input value={customer.address} onChange={(event) => setCustomer((prev) => ({ ...prev, address: event.target.value }))} className="mt-1 h-9 w-full rounded-[6px] border px-3 text-[12px]" /></label>
              <label className="text-[11px] text-[#374151]">Telefone<input value={customer.phone} onChange={(event) => setCustomer((prev) => ({ ...prev, phone: event.target.value }))} className="mt-1 h-9 w-full rounded-[6px] border px-3 text-[12px]" /></label>
              <label className="text-[11px] text-[#374151] md:col-span-2">E-mail<input value={customer.email} onChange={(event) => setCustomer((prev) => ({ ...prev, email: event.target.value }))} className="mt-1 h-9 w-full rounded-[6px] border px-3 text-[12px]" /></label>
            </div>
          </div>
        </article>
      ) : null}

      {step >= 2 ? (
        <div className="flex items-center gap-3 rounded-[10px] border border-[#D7E1EC] bg-white px-5 py-3">
          <div className="mr-1 text-[11px] text-[#8FA3B4]">Cliente da solicitação</div>
          <div className="flex h-7 w-7 items-center justify-center rounded-[6px] bg-[#EEF3F8] text-[10px] font-bold text-[#295B9A]">
            {toInitials(customer.companyName || "Cliente")}
          </div>
          <div className="text-[13px] font-semibold text-[#102033]">{customer.companyName || "Cliente não informado"}</div>
          <div className="text-[11px] text-[#4F647A]">{customer.cnpj || "CNPJ não informado"}</div>
          <div className="ml-auto rounded-full bg-[#EEF3F8] px-2.5 py-1 text-[10px] font-medium text-[#4F647A]">Etapa {step} de 4</div>
        </div>
      ) : null}

      {step === 2 ? (
        <>
          <article className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[15px] font-semibold text-[#102033]">Informações para análise</p>
                <p className="text-[12px] text-[#4F647A]">Escolha como deseja estruturar os dados da análise. Você pode combinar múltiplas fontes.</p>
              </div>
              <div className="space-y-1 text-right">
                <p className="text-[11px] font-medium text-[#4F647A]">{structuredSourcesCount} de 3 fontes estruturadas preenchidas</p>
                {isStep2Ready ? <p className="text-[11px] text-[#166534]">Dados suficientes para avançar para a próxima etapa</p> : null}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <button
                type="button"
                onClick={() => openImportModal("agrisk")}
                className={`relative flex h-full flex-col rounded-[16px] border-2 border-[#295B9A] bg-white p-6 text-left transition hover:-translate-y-0.5 ${
                  agriskImport.status !== "empty" ? "cursor-pointer hover:shadow-[0_10px_30px_rgba(16,32,51,0.08)]" : ""
                }`}
              >
                {agriskImport.status === "empty" ? (
                  <>
                    <span className="absolute left-6 top-0 -translate-y-1/2 rounded-full bg-[#295B9A] px-3 py-1 text-[10px] font-semibold text-white">Principal</span>
                    <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-[12px] bg-[#EEF3F8]">
                      <Upload className="h-5 w-5 text-[#295B9A]" />
                    </div>
                    <p className="mb-1 text-[10px] uppercase tracking-[0.6px] text-[#8FA3B4]">Consulta externa</p>
                    <p className="mb-2 text-[15px] font-semibold text-[#102033]">Importação Agrisk</p>
                    <p className="flex-1 text-[12px] leading-relaxed text-[#4F647A]">
                      Importe o relatório exportado da Agrisk para leitura automática e estruturação dos dados de crédito.
                    </p>
                    <p className="mt-2 border-t border-[#EEF3F8] pt-2 text-[11px] leading-relaxed text-[#8FA3B4]">
                      O sistema identifica automaticamente score, restrições e indicadores relevantes para a análise.
                    </p>
                    <span className="mt-4 inline-flex items-center justify-center rounded-[9px] bg-[#295B9A] px-4 py-2 text-[12px] font-medium text-white">
                      Importar relatório Agrisk <ChevronRight className="ml-1 h-3.5 w-3.5" />
                    </span>
                  </>
                ) : (
                  <>
                    <div className="mb-3 flex items-start justify-between gap-2">
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.6px] text-[#8FA3B4]">Consulta externa</p>
                        <p className="text-[15px] font-semibold text-[#102033]">Importação Agrisk</p>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${agriskImport.status === "success" ? "bg-[#EAF7EE] text-[#166534]" : agriskImport.status === "processing" ? "bg-[#EFF6FF] text-[#1D4ED8]" : "bg-[#FEF2F2] text-[#B91C1C]"}`}>
                        {statusLabel(agriskImport.status)}
                      </span>
                    </div>
                    <div className="mb-3 flex flex-1 flex-col justify-between rounded-[10px] border border-[#D7E1EC] bg-[#F8FBFF] p-3">
                      <div>
                        <p className="text-[10px] font-medium uppercase tracking-[0.5px] text-[#8FA3B4]">{importMonitorSourceName("agrisk")}</p>
                        <p className="mt-1 text-[11px] font-semibold text-[#102033]">{importMonitorTitle("agrisk")}</p>
                        <p className="mt-1 truncate text-[11px] text-[#102033]">{agriskImport.files[0]?.original_filename ?? "Sem arquivo vinculado"}</p>
                        <p className="text-[10px] text-[#64748B]">
                          {agriskImport.files[0] ? `${formatFileSize(agriskImport.files[0].file_size)} · ${agriskImport.importedAt ? `Importado em ${formatImportedAt(agriskImport.importedAt)}` : "Importado"}` : agriskImport.errorMessage ?? "Falha na leitura do arquivo."}
                        </p>
                        <p className="mt-1 text-[10px] text-[#4F647A]">{importMonitorValueText("agrisk")}</p>
                        <p className="mt-1 text-[10px] text-[#4F647A]">{importMonitorStatusText("agrisk", agriskImport.status)}</p>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-3 text-[10px] font-medium">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            removeImport("agrisk");
                          }}
                          className="rounded-[8px] border border-[#F5D0D0] px-3 py-1.5 text-[#B91C1C] transition hover:bg-[#FEF2F2]"
                        >
                          {removeActionLabel("agrisk")}
                        </button>
                        <span className="inline-flex items-center justify-center rounded-[9px] bg-[#295B9A] px-4 py-2 text-[12px] font-medium text-white">
                          Substituir relatório <ChevronRight className="ml-1 h-3.5 w-3.5" />
                        </span>
                      </div>
                    </div>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => openImportModal("coface")}
                className={`flex h-full flex-col rounded-[16px] border bg-white p-6 text-left transition hover:border-[#295B9A] ${
                  cofaceImport.status !== "empty"
                    ? "cursor-pointer border-[#295B9A] hover:-translate-y-0.5 hover:shadow-[0_10px_30px_rgba(16,32,51,0.08)]"
                    : "border-[#D7E1EC]"
                }`}
              >
                {cofaceImport.status === "empty" ? (
                  <>
                    <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-[12px] bg-[#F7F9FC]">
                      <Upload className="h-5 w-5 text-[#295B9A]" />
                    </div>
                    <p className="mb-1 text-[10px] uppercase tracking-[0.6px] text-[#8FA3B4]">Consulta externa</p>
                    <p className="mb-2 text-[15px] font-semibold text-[#102033]">Importação COFACE</p>
                    <p className="flex-1 text-[12px] leading-relaxed text-[#4F647A]">
                      Importe o relatório exportado da COFACE para leitura automática dos indicadores de risco e DRA.
                    </p>
                    <p className="mt-2 border-t border-[#EEF3F8] pt-2 text-[11px] leading-relaxed text-[#8FA3B4]">
                      O sistema identifica automaticamente DRA e outros indicadores relevantes para análise corporativa.
                    </p>
                    <span className="mt-4 inline-flex items-center justify-center rounded-[9px] border border-[#D7E1EC] bg-[#F7F9FC] px-4 py-2 text-[12px] font-medium text-[#102033]">
                      Importar relatório COFACE <ChevronRight className="ml-1 h-3.5 w-3.5" />
                    </span>
                  </>
                ) : (
                  <>
                    <div className="mb-3 flex items-start justify-between gap-2">
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.6px] text-[#8FA3B4]">Consulta externa</p>
                        <p className="text-[15px] font-semibold text-[#102033]">Importação COFACE</p>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${cofaceImport.status === "success" ? "bg-[#EAF7EE] text-[#166534]" : cofaceImport.status === "processing" ? "bg-[#EFF6FF] text-[#1D4ED8]" : "bg-[#FEF2F2] text-[#B91C1C]"}`}>
                        {statusLabel(cofaceImport.status)}
                      </span>
                    </div>
                    <div className="mb-3 flex flex-1 flex-col justify-between rounded-[10px] border border-[#D7E1EC] bg-[#F8FBFF] p-3">
                      <div>
                        <p className="text-[10px] font-medium uppercase tracking-[0.5px] text-[#8FA3B4]">{importMonitorSourceName("coface")}</p>
                        <p className="mt-1 text-[11px] font-semibold text-[#102033]">{importMonitorTitle("coface")}</p>
                        <p className="mt-1 truncate text-[11px] text-[#102033]">{cofaceImport.files[0]?.original_filename ?? "Sem arquivo vinculado"}</p>
                        <p className="text-[10px] text-[#64748B]">
                          {cofaceImport.files[0] ? `${formatFileSize(cofaceImport.files[0].file_size)} · ${cofaceImport.importedAt ? `Importado em ${formatImportedAt(cofaceImport.importedAt)}` : "Importado"}` : cofaceImport.errorMessage ?? "Falha na leitura do arquivo."}
                        </p>
                        <p className="mt-1 text-[10px] text-[#4F647A]">{importMonitorValueText("coface")}</p>
                        <p className="mt-1 text-[10px] text-[#4F647A]">{importMonitorStatusText("coface", cofaceImport.status)}</p>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-3 text-[10px] font-medium">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            removeImport("coface");
                          }}
                          className="rounded-[8px] border border-[#F5D0D0] px-3 py-1.5 text-[#B91C1C] transition hover:bg-[#FEF2F2]"
                        >
                          {removeActionLabel("coface")}
                        </button>
                        <span className="inline-flex items-center justify-center rounded-[9px] border border-[#D7E1EC] bg-[#F7F9FC] px-4 py-2 text-[12px] font-medium text-[#102033]">
                          Substituir relatório <ChevronRight className="ml-1 h-3.5 w-3.5" />
                        </span>
                      </div>
                    </div>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => openImportModal("internal")}
                className={`flex h-full flex-col rounded-[16px] border bg-white p-6 text-left transition hover:border-[#295B9A] ${
                  internalImport.status !== "empty"
                    ? "cursor-pointer border-[#295B9A] hover:-translate-y-0.5 hover:shadow-[0_10px_30px_rgba(16,32,51,0.08)]"
                    : "border-[#D7E1EC]"
                }`}
              >
                {internalImport.status === "empty" ? (
                  <>
                    <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-[12px] bg-[#F7F9FC]">
                      <Upload className="h-5 w-5 text-[#4F647A]" />
                    </div>
                    <p className="mb-1 text-[10px] uppercase tracking-[0.6px] text-[#8FA3B4]">Base interna</p>
                    <p className="mb-2 text-[15px] font-semibold text-[#102033]">Importação interna</p>
                    <p className="flex-1 text-[12px] leading-relaxed text-[#4F647A]">
                      Importe planilhas com títulos, vencimentos e pagamentos para complementar a análise de crédito.
                    </p>
                    <p className="mt-2 border-t border-[#EEF3F8] pt-2 text-[11px] leading-relaxed text-[#8FA3B4]">
                      O sistema estrutura automaticamente os dados internos para acelerar a leitura da operação.
                    </p>
                    <span className="mt-4 inline-flex items-center justify-center rounded-[9px] border border-[#D7E1EC] bg-[#F7F9FC] px-4 py-2 text-[12px] font-medium text-[#102033]">
                      Importar planilha interna
                    </span>
                  </>
                ) : (
                  <>
                    <div className="mb-3 flex items-start justify-between gap-2">
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.6px] text-[#8FA3B4]">Base interna</p>
                        <p className="text-[15px] font-semibold text-[#102033]">Importação interna</p>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${internalImport.status === "success" ? "bg-[#EAF7EE] text-[#166534]" : internalImport.status === "processing" ? "bg-[#EFF6FF] text-[#1D4ED8]" : "bg-[#FEF2F2] text-[#B91C1C]"}`}>
                        {statusLabel(internalImport.status)}
                      </span>
                    </div>
                    <div className="mb-3 flex flex-1 flex-col justify-between rounded-[10px] border border-[#D7E1EC] bg-[#F8FBFF] p-3">
                      <div>
                        <p className="text-[10px] font-medium uppercase tracking-[0.5px] text-[#8FA3B4]">{importMonitorSourceName("internal")}</p>
                        <p className="mt-1 text-[11px] font-semibold text-[#102033]">{importMonitorTitle("internal")}</p>
                        <p className="mt-1 truncate text-[11px] text-[#102033]">{internalImport.files[0]?.original_filename ?? "Sem arquivo vinculado"}</p>
                        <p className="text-[10px] text-[#64748B]">
                          {internalImport.files[0] ? `${formatFileSize(internalImport.files[0].file_size)} · ${internalImport.importedAt ? `Importado em ${formatImportedAt(internalImport.importedAt)}` : "Importado"}` : internalImport.errorMessage ?? "Falha na leitura do arquivo."}
                        </p>
                        <p className="mt-1 text-[10px] text-[#4F647A]">{importMonitorValueText("internal")}</p>
                        <p className="mt-1 text-[10px] text-[#4F647A]">{importMonitorStatusText("internal", internalImport.status)}</p>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-3 text-[10px] font-medium">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            removeImport("internal");
                          }}
                          className="rounded-[8px] border border-[#F5D0D0] px-3 py-1.5 text-[#B91C1C] transition hover:bg-[#FEF2F2]"
                        >
                          {removeActionLabel("internal")}
                        </button>
                        <span className="inline-flex items-center justify-center rounded-[9px] border border-[#D7E1EC] bg-[#F7F9FC] px-4 py-2 text-[12px] font-medium text-[#102033]">
                          Substituir arquivo
                        </span>
                      </div>
                    </div>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  if (!isManualBlocked) setIsManualDrawerOpen(true);
                }}
                disabled={isManualBlocked}
                className={`flex h-full flex-col rounded-[16px] border bg-white p-6 text-left transition ${
                  isManualBlocked ? "cursor-not-allowed border-[#D7E1EC] opacity-75" : "hover:border-[#295B9A]"
                }`}
              >
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-[12px] bg-[#F7F9FC]">
                  <span className="text-xl text-[#4F647A]">+</span>
                </div>
                <p className="mb-1 text-[10px] uppercase tracking-[0.6px] text-[#8FA3B4]">Entrada manual</p>
                <p className="mb-2 text-[15px] font-semibold text-[#102033]">Complemento manual</p>
                <p className="flex-1 text-[12px] leading-relaxed text-[#4F647A]">
                  Informe apenas dados internos comerciais e operacionais para complementar a análise.
                </p>
                {isManualBlocked ? (
                  <p className="mt-2 border-t border-[#EEF3F8] pt-2 text-[11px] leading-relaxed text-[#8FA3B4]">
                    Complemento manual indisponível. Agrisk, COFACE e importação interna já foram carregados nesta análise.
                  </p>
                ) : null}
                <span className="mt-4 inline-flex items-center justify-center rounded-[9px] border border-[#D7E1EC] bg-[#F7F9FC] px-4 py-2 text-[12px] font-medium text-[#102033]">
                  {isManualBlocked ? "Complemento manual indisponível" : "Preencher manualmente"}
                </span>
              </button>
            </div>

            {ocr.files.length === 0 ? (
              <div className="flex items-center justify-between rounded-[14px] border border-dashed border-[#D7E1EC] bg-white px-6 py-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-[#D7E1EC] bg-[#F7F9FC] text-[#8FA3B4]">
                    <Upload className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-[13px] font-medium text-[#4F647A]">
                      Complementar com demonstrativos financeiros <span className="text-[10px] font-normal text-[#8FA3B4]">(opcional)</span>
                    </p>
                    <p className="text-[11px] text-[#8FA3B4]">Envio de DRE ou balanço para leitura assistida.</p>
                    {ocr.status === "error" && ocr.errorMessage ? <p className="mt-1 text-[11px] text-[#B91C1C]">{ocr.errorMessage}</p> : null}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => ocrInputRef.current?.click()}
                  className="rounded-[8px] border border-[#D7E1EC] bg-white px-4 py-2 text-[12px] font-medium text-[#4F647A]"
                >
                  Enviar demonstrativo
                </button>
                <input ref={ocrInputRef} type="file" className="hidden" onChange={(event) => handleOcrFileChange(event.target.files)} />
              </div>
            ) : (
              <div className="rounded-[14px] border border-[#D7E1EC] bg-white px-6 py-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[13px] font-medium text-[#4F647A]">
                      Complementar com demonstrativos financeiros <span className="text-[10px] font-normal text-[#8FA3B4]">(opcional)</span>
                    </p>
                    <p className="text-[11px] text-[#8FA3B4]">Demonstrativo importado</p>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${ocr.status === "success" ? "bg-[#EAF7EE] text-[#166534]" : ocr.status === "processing" ? "bg-[#EFF6FF] text-[#1D4ED8]" : "bg-[#FEF2F2] text-[#B91C1C]"}`}>
                    {statusLabel(ocr.status)}
                  </span>
                </div>
                <div className="rounded-[10px] border border-[#D7E1EC] bg-[#F8FBFF] p-3">
                  <p className="truncate text-[11px] font-semibold text-[#102033]">{ocr.files[0]?.original_filename ?? "Sem arquivo vinculado"}</p>
                  <p className="text-[10px] text-[#64748B]">
                    {ocr.files[0] ? `${formatFileSize(ocr.files[0].file_size)} · ${ocr.importedAt ? `Importado em ${formatImportedAt(ocr.importedAt)}` : "Importado"}` : "Sem arquivo vinculado"}
                  </p>
                  <p className="mt-1 text-[10px] text-[#4F647A]">Demonstrativos prontos para leitura assistida</p>
                </div>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={removeOcrImport}
                    className="rounded-[8px] border border-[#F5D0D0] px-3 py-1.5 text-[11px] font-medium text-[#B91C1C] transition hover:bg-[#FEF2F2]"
                  >
                    Remover demonstrativo
                  </button>
                  <button
                    type="button"
                    onClick={() => ocrInputRef.current?.click()}
                    className="rounded-[8px] border border-[#D7E1EC] bg-[#F7F9FC] px-4 py-2 text-[12px] font-medium text-[#102033]"
                  >
                    Substituir demonstrativo
                  </button>
                </div>
                <input ref={ocrInputRef} type="file" className="hidden" onChange={(event) => handleOcrFileChange(event.target.files)} />
              </div>
            )}
          </article>

          {isImportModalOpen ? (
            <div className="fixed inset-0 z-40 flex items-center justify-center bg-[#0D1B2A]/55 p-4" onClick={() => setIsImportModalOpen(false)}>
              <div className="w-full max-w-[480px] rounded-[18px] bg-white p-7 shadow-xl" onClick={(event) => event.stopPropagation()}>
                <button type="button" onClick={() => setIsImportModalOpen(false)} className="absolute hidden" />
                <div className="mb-5 flex items-start justify-between">
                  <div>
                    <p className="text-[16px] font-semibold text-[#102033]">
                      {importModalSource === "agrisk"
                        ? "Importar relatório Agrisk"
                        : importModalSource === "coface"
                          ? "Importar relatório COFACE"
                          : "Importar base interna"}
                    </p>
                    <p className="text-[12px] text-[#4F647A]">
                      {importModalSource === "agrisk"
                        ? "Selecione ou arraste o arquivo exportado da Agrisk para processamento automático."
                        : importModalSource === "coface"
                          ? "Selecione ou arraste o arquivo exportado da COFACE para leitura automática do DRA e indicadores de risco."
                          : "Selecione a planilha com títulos, vencimentos e pagamentos para complementar a análise."}
                    </p>
                  </div>
                  <button type="button" onClick={() => setIsImportModalOpen(false)} className="flex h-7 w-7 items-center justify-center rounded-full border border-[#D7E1EC] bg-[#F7F9FC] text-[#4F647A]">
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {pendingImportFile ? (
                  <div className="mb-4 rounded-[8px] border border-[#B5D4F4] bg-[#EEF3F8] p-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-[7px] border border-[#D7E1EC] bg-white">
                        <Upload className="h-4 w-4 text-[#295B9A]" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12px] font-medium text-[#102033]">{pendingImportFile.original_filename}</p>
                        <p className="text-[11px] text-[#8FA3B4]">{formatFileSize(pendingImportFile.file_size)} · Pronto para importar</p>
                      </div>
                      <button type="button" onClick={() => setPendingImportFile(null)} className="text-[#8FA3B4]">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="mt-3 flex items-center gap-2 rounded-[8px] border border-[#A7DDB8] bg-[#F0FBF5] px-3 py-2 text-[11px] text-[#1A7A3A]">
                      <Check className="h-3.5 w-3.5" />
                      Arquivo válido. Os dados serão extraídos automaticamente.
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => importInputRef.current?.click()}
                    className="mb-4 w-full rounded-[12px] border-[1.5px] border-dashed border-[#D7E1EC] bg-[#F7F9FC] px-5 py-8 text-center hover:border-[#295B9A] hover:bg-[#EEF3F8]"
                  >
                    <span className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-[10px] bg-[#EEF3F8] text-[#295B9A]">
                      <Upload className="h-5 w-5" />
                    </span>
                    <p className="text-[13px] font-medium text-[#102033]">Arraste o arquivo aqui</p>
                    <p className="text-[11px] text-[#8FA3B4]">ou clique para selecionar</p>
                    <span className="mt-2 inline-block rounded-[8px] border border-[#D7E1EC] bg-white px-4 py-1.5 text-[12px] font-medium text-[#295B9A]">Selecionar arquivo</span>
                  </button>
                )}

                <div className="mb-4 flex flex-wrap gap-2">
                  {["PDF · XLSX", "Máx. 10 MB", "1 arquivo por análise"].map((hint) => (
                    <span key={hint} className="rounded-[6px] bg-[#EEF3F8] px-2.5 py-1 text-[11px] text-[#4F647A]">
                      {hint}
                    </span>
                  ))}
                </div>

                {pendingImportError ? (
                  <div className="mb-4 rounded-[8px] border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-[11px] text-[#B91C1C]">
                    {pendingImportError}
                  </div>
                ) : null}

                <input ref={importInputRef} type="file" className="hidden" onChange={(event) => handleImportFileChange(event.target.files)} />

                <div className="flex justify-end gap-2 border-t border-[#EEF3F8] pt-4">
                  <button type="button" onClick={() => setIsImportModalOpen(false)} className="rounded-[8px] border border-[#D7E1EC] bg-white px-4 py-2 text-[12px] font-medium text-[#4F647A]">
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={confirmImport}
                    disabled={!pendingImportFile}
                    className="rounded-[8px] bg-[#295B9A] px-5 py-2 text-[12px] font-medium text-white disabled:cursor-not-allowed disabled:bg-[#D7E1EC] disabled:text-[#8FA3B4]"
                  >
                    Importar
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {isManualDrawerOpen ? (
            <div className="fixed inset-0 z-40 flex justify-end bg-[#0D1B2A]/45" onClick={() => setIsManualDrawerOpen(false)}>
              <div className="flex h-full w-full max-w-[560px] flex-col bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
                <div className="flex items-start justify-between border-b border-[#EEF3F8] px-6 py-5">
                  <div>
                    <p className="text-[15px] font-semibold text-[#102033]">Preenchimento manual</p>
                    <p className="text-[12px] text-[#4F647A]">Informe os dados estruturados para análise de crédito</p>
                  </div>
                  <button type="button" onClick={() => setIsManualDrawerOpen(false)} className="flex h-7 w-7 items-center justify-center rounded-full border border-[#D7E1EC] bg-[#F7F9FC] text-[#4F647A]">
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto px-6 py-5">
                  <div className="mb-6">
                    <p className="mb-3 border-b border-[#EEF3F8] pb-1.5 text-[10px] font-semibold uppercase tracking-[0.7px] text-[#295B9A]">Scores e referências externas</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="text-[11px] font-medium text-[#4F647A]">
                        Fonte do score
                        <select
                          value={manualPanel.scoreSource}
                          onChange={(event) => setManualPanel((prev) => ({ ...prev, scoreSource: event.target.value }))}
                          className="mt-1 h-9 w-full rounded-[8px] border border-[#D7E1EC] px-3 text-[12px]"
                        >
                          <option value="Agrisk" disabled={hasAgriskImported}>
                            {hasAgriskImported ? "Agrisk — indisponível (já importado)" : "Agrisk"}
                          </option>
                          <option value="Serasa">Serasa</option>
                          <option value="SCR/Bacen">SCR/Bacen</option>
                          <option value="Outro">Outro</option>
                        </select>
                      </label>
                      <div className="text-[11px] font-medium text-[#4F647A]">
                        Score
                        <div className="mt-1 rounded-[8px] border border-[#D7E1EC] px-3 py-2">
                          <div className="flex items-center gap-3">
                            <input
                              type="range"
                              min={0}
                              max={1000}
                              value={manualPanel.scoreValue}
                              onChange={(event) => setManualPanel((prev) => ({ ...prev, scoreValue: Number(event.target.value) }))}
                              className="w-full"
                            />
                            <span className="min-w-[38px] text-right text-[16px] font-semibold text-[#295B9A]">{manualPanel.scoreValue}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mb-6">
                    <p className="mb-3 border-b border-[#EEF3F8] pb-1.5 text-[10px] font-semibold uppercase tracking-[0.7px] text-[#295B9A]">COFACE</p>
                    <div className="text-[11px] font-medium text-[#4F647A]">
                      DRA COFACE (0 a 10)
                      <div className="mt-1 rounded-[8px] border border-[#D7E1EC] px-3 py-2">
                        <div className="flex items-center gap-3">
                          <input
                            type="range"
                            min={0}
                            max={10}
                            step={0.1}
                            value={manualPanel.cofaceDra}
                            onChange={(event) => setManualPanel((prev) => ({ ...prev, cofaceDra: Number(event.target.value) }))}
                            disabled={hasCofaceImported}
                            className="w-full disabled:cursor-not-allowed"
                          />
                          <span className="min-w-[38px] text-right text-[16px] font-semibold text-[#295B9A]">{manualPanel.cofaceDra.toFixed(1)}</span>
                        </div>
                      </div>
                      {hasCofaceImported ? <span className="mt-1 block text-[10px] text-[#8FA3B4]">DRA COFACE já informado por relatório importado.</span> : null}
                    </div>
                  </div>

                  <div className="mb-6">
                    <p className="mb-3 border-b border-[#EEF3F8] pb-1.5 text-[10px] font-semibold uppercase tracking-[0.7px] text-[#295B9A]">Dados comerciais internos</p>
                    <p className="mb-3 text-[11px] text-[#8FA3B4]">
                      Faturamento interno últimos 12 meses = total vendido ao cliente nos últimos 12 meses. Valor em aberto = total atualmente em aberto com o cliente.
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="text-[11px] font-medium text-[#4F647A]">
                        <span className="mb-1 block min-h-[2.5rem]">Faturamento interno últimos 12 meses (R$)</span>
                        <input value={manualPanel.internalRevenue12m} onChange={(event) => setManualPanel((prev) => ({ ...prev, internalRevenue12m: formatCurrencyInputBRL(event.target.value) }))} className="h-9 w-full rounded-[8px] border border-[#D7E1EC] px-3 text-[12px]" />
                      </label>
                      <label className="text-[11px] font-medium text-[#4F647A]">
                        <span className="mb-1 block min-h-[2.5rem]">Valor em aberto (R$)</span>
                        <input value={manualPanel.outstandingValue} onChange={(event) => setManualPanel((prev) => ({ ...prev, outstandingValue: formatCurrencyInputBRL(event.target.value) }))} className="h-9 w-full rounded-[8px] border border-[#D7E1EC] px-3 text-[12px]" />
                      </label>
                    </div>
                  </div>

                  <div className="mb-6">
                    <p className="mb-3 border-b border-[#EEF3F8] pb-1.5 text-[10px] font-semibold uppercase tracking-[0.7px] text-[#295B9A]">Indicadores operacionais</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="text-[11px] font-medium text-[#4F647A]">PMR contratual (dias)<input value={manualPanel.pmrContractual} onChange={(event) => setManualPanel((prev) => ({ ...prev, pmrContractual: event.target.value }))} className="mt-1 h-9 w-full rounded-[8px] border border-[#D7E1EC] px-3 text-[12px]" /></label>
                      <label className="text-[11px] font-medium text-[#4F647A]">PMR efetivo (dias)<input value={manualPanel.pmrEffective} onChange={(event) => setManualPanel((prev) => ({ ...prev, pmrEffective: event.target.value }))} className="mt-1 h-9 w-full rounded-[8px] border border-[#D7E1EC] px-3 text-[12px]" /></label>
                    </div>
                  </div>

                  <div>
                    <p className="mb-3 border-b border-[#EEF3F8] pb-1.5 text-[10px] font-semibold uppercase tracking-[0.7px] text-[#295B9A]">Observações</p>
                    <label className="text-[11px] font-medium text-[#4F647A]">
                      Considerações do analista <span className="ml-1 font-normal text-[#8FA3B4]">(opcional)</span>
                      <textarea value={manualPanel.analystNotes} onChange={(event) => setManualPanel((prev) => ({ ...prev, analystNotes: event.target.value }))} rows={4} className="mt-1 w-full rounded-[8px] border border-[#D7E1EC] px-3 py-2 text-[12px]" />
                    </label>
                  </div>
                </div>

                <div className="flex justify-end gap-2 border-t border-[#EEF3F8] px-6 py-4">
                  <button type="button" onClick={() => setIsManualDrawerOpen(false)} className="rounded-[8px] border border-[#D7E1EC] bg-white px-5 py-2 text-[12px] font-medium text-[#4F647A]">
                    Cancelar
                  </button>
                  <button type="button" onClick={saveManualDrawer} className="rounded-[8px] bg-[#0D1B2A] px-6 py-2 text-[12px] font-medium text-white">
                    Salvar dados
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {step === 3 ? (
        <article className="space-y-3 rounded-[10px] border border-[#e2e5eb] bg-white p-4">
          <p className="text-[13px] font-medium text-[#111827]">Dados da solicitação</p>
          <p className="text-[12px] text-[#6b7280]">Informe os dados principais da solicitação de crédito antes de avançar.</p>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <label className="text-[11px] text-[#374151]">Limite solicitado<RequiredMark /><input value={analysis.requestedLimit} onChange={(event) => setAnalysis((prev) => ({ ...prev, requestedLimit: formatCurrencyInputBRL(event.target.value) }))} className="mt-1 h-9 w-full rounded-[6px] border px-3 text-[12px]" /></label>
            <label className="text-[11px] text-[#374151]">Limite atual<input value={analysis.currentLimit} onChange={(event) => setAnalysis((prev) => ({ ...prev, currentLimit: formatCurrencyInputBRL(event.target.value) }))} className="mt-1 h-9 w-full rounded-[6px] border px-3 text-[12px]" /></label>
            <label className="text-[11px] text-[#374151]">Limite utilizado<input value={analysis.usedLimit} onChange={(event) => setAnalysis((prev) => ({ ...prev, usedLimit: formatCurrencyInputBRL(event.target.value) }))} className="mt-1 h-9 w-full rounded-[6px] border px-3 text-[12px]" /></label>
            <label className="text-[11px] text-[#374151]">
              Limite com garantia
              <input value={analysis.guaranteeLimit} onChange={(event) => setAnalysis((prev) => ({ ...prev, guaranteeLimit: formatCurrencyInputBRL(event.target.value) }))} className="mt-1 h-9 w-full rounded-[6px] border px-3 text-[12px]" />
              <span className="mt-1 block text-[10px] text-[#6b7280]">Valor garantido por seguro ou garantia real.</span>
            </label>
            <label className="text-[11px] text-[#374151]">Limite total<input value={totalLimitDisplay} readOnly className="mt-1 h-9 w-full rounded-[6px] border bg-[#f9fafb] px-3 text-[12px] text-[#6b7280]" /></label>
            <label className="text-[11px] text-[#374151]">Exposição<input value={exposureDisplay} readOnly className="mt-1 h-9 w-full rounded-[6px] border bg-[#f9fafb] px-3 text-[12px] text-[#6b7280]" /></label>
            <label className="text-[11px] text-[#374151]">Analista responsável
              <input value={analysis.assignedAnalystName} readOnly className="mt-1 h-9 w-full rounded-[6px] border bg-[#f9fafb] px-3 text-[12px] text-[#6b7280]" />
            </label>
            <label className="text-[11px] text-[#374151] md:col-span-2 xl:col-span-3">Comentário
              <textarea value={analysis.comment} onChange={(event) => setAnalysis((prev) => ({ ...prev, comment: event.target.value }))} className="mt-1 min-h-16 w-full rounded-[6px] border px-3 py-2 text-[12px]" />
            </label>
          </div>
        </article>
      ) : null}

      {step === 4 ? (
        <article className="space-y-4 rounded-[10px] border border-[#e2e5eb] bg-white p-4 text-[12px]">
          <div>
            <p className="text-[13px] font-medium text-[#111827]">Revise as informações antes de enviar para análise</p>
            <p className="text-[12px] text-[#6b7280]">Confira os dados do cliente, da solicitação e das informações complementares antes de seguir.</p>
          </div>

          <section className="rounded-[8px] border border-[#e5e7eb] p-3">
            <p>Razão social: <strong>{customer.companyName || "-"}</strong></p>
            <p>CNPJ: <strong>{customer.cnpj || "-"}</strong></p>
            <p>Endereço: <strong>{customer.address || "-"}</strong></p>
            <p>Telefone: <strong>{customer.phone || "-"}</strong></p>
            <p>E-mail: <strong>{customer.email || "-"}</strong></p>
          </section>

          <section className="rounded-[8px] border border-[#e5e7eb] p-3">
            <p>Limite solicitado: <strong>{formatCurrencyBRL(analysis.requestedLimit)}</strong></p>
            <p>Limite atual: <strong>{formatCurrencyBRL(analysis.currentLimit)}</strong></p>
            <p>Limite utilizado: <strong>{formatCurrencyBRL(analysis.usedLimit)}</strong></p>
            <p>Limite com garantia: <strong>{formatCurrencyBRL(analysis.guaranteeLimit)}</strong></p>
            <p>Limite total: <strong>{totalLimitDisplay}</strong></p>
            <p>Exposição: <strong>{exposureDisplay}</strong></p>
            <p>Analista responsável: <strong>{analysis.assignedAnalystName || "-"}</strong></p>
            <p>Comentário: <strong>{analysis.comment || "-"}</strong></p>
          </section>

          <section className="rounded-[8px] border border-[#e5e7eb] p-3">
            <div className={`rounded-[6px] border px-3 py-2 ${labelStatus(manualStatus)}`}>Manual: {manualStatus}</div>
            <div className={`mt-2 rounded-[6px] border px-3 py-2 ${labelStatus(ocrStatus)}`}>OCR DRE/Balanço: {ocrStatus}</div>
            <div className={`mt-2 rounded-[6px] border px-3 py-2 ${labelStatus(agriskStatus)}`}>Importação Agrisk: {agriskStatus}</div>
            <div className={`mt-2 rounded-[6px] border px-3 py-2 ${labelStatus(cofaceStatus)}`}>Importação COFACE: {cofaceStatus}</div>
            <div className={`mt-2 rounded-[6px] border px-3 py-2 ${labelStatus(internalStatus)}`}>Importação interna: {internalStatus}</div>
          </section>

          {manualConfigured ? (
            <section className="rounded-[8px] border border-[#e5e7eb] p-3">
              <p>Negativações: <strong>{manual.negativationsCount || "0"}</strong></p>
              <p>Valor total de Negativações: <strong>{formatCurrencyBRL(manual.negativationsAmount)}</strong></p>
              <p>Protestos: <strong>{manual.protestsCount || "0"}</strong></p>
              <p>Valor total de protestos: <strong>{formatCurrencyBRL(manual.protestsAmount)}</strong></p>
              <p>Processos judiciais ativos: <strong>{manual.activeLawsuits ? "Sim" : "Não"}</strong></p>
            </section>
          ) : null}

          {submitMutation.isError ? <p className="text-[#b91c1c]">{submitMutation.error.message}</p> : null}
        </article>
      ) : null}

      {step === 2 ? (
        <div className="flex items-center justify-between rounded-[12px] border border-[#D7E1EC] bg-white px-6 py-4">
          <div className="flex items-center gap-2 text-[11px] text-[#8FA3B4]">
            <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full border border-[#8FA3B4]">i</span>
            Selecione ao menos uma fonte de dados para Avançar
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setStep((prev) => Math.max(1, prev - 1))} className="inline-flex items-center rounded-[8px] border border-[#D7E1EC] bg-white px-4 py-2 text-[12px] font-medium text-[#4F647A]">
              <ChevronLeft className="mr-1 h-3.5 w-3.5" /> Etapa anterior
            </button>
            <button
              type="button"
              onClick={() => navigateToStep(3)}
              disabled={!hasStep2Source}
              className="inline-flex items-center rounded-[8px] bg-[#0D1B2A] px-5 py-2 text-[12px] font-medium text-white disabled:cursor-not-allowed disabled:bg-[#D7E1EC] disabled:text-[#8FA3B4]"
            >
              Avançar · Dados da solicitação <ChevronRight className="ml-1 h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between rounded-[10px] border border-[#e2e5eb] bg-white p-3">
          <button type="button" onClick={() => setStep((prev) => Math.max(1, prev - 1))} disabled={step === 1} className="rounded-[6px] border border-[#d1d5db] px-3 py-2 text-[12px] text-[#374151] disabled:opacity-50">
            Voltar
          </button>
          {step < 4 ? (
            <button type="button" onClick={() => navigateToStep(Math.min(4, step + 1))} disabled={!canContinue} className="rounded-[6px] bg-[#1a2b5e] px-3 py-2 text-[12px] font-medium text-white disabled:opacity-50">
              Avançar
            </button>
          ) : (
            <button type="button" onClick={submit} disabled={submitMutation.isPending} className="rounded-[6px] bg-[#059669] px-3 py-2 text-[12px] font-medium text-white disabled:opacity-50">
              {submitMutation.isPending ? "Enviando..." : "Enviar para análise"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

