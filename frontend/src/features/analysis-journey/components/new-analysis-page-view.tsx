"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, Upload, X } from "lucide-react";

import { listCustomers, lookupExternalCnpj, readAgriskReport, readCofaceReport, submitAnalysisJourney, submitTriageCreditRequest, triageCreditRequest } from "@/features/analysis-journey/api/analysis-journey.api";
import { AgriskImportStatus, AgriskReportReadResponse, AnalysisJourneySubmitRequest, CofaceReportReadResponse, CreditAnalysisTriageResponse, UploadFileMetadataInput } from "@/features/analysis-journey/api/contracts";
import {
  formatCnpj,
  formatCurrencyInputBRL,
  sanitizeDigits,
  toNullableNumberInput,
  toNumberInput
} from "@/features/analysis-journey/utils/formatters";
import { formatCurrencyBRL, resolveManualStatus, resolveUploadStatus } from "@/features/analysis-journey/utils/view-models";
import { ErrorState } from "@/shared/components/states/error-state";

const steps = ["IdentificaÃ§Ã£o do cliente", "InformaÃ§Ãµes para anÃ¡lise", "Dados da solicitaÃ§Ã£o", "RevisÃ£o e envio"];
type ImportSource = "agrisk" | "coface" | "internal";
type ImportStatus = "empty" | AgriskImportStatus | "success";

type ImportState = {
  notes: string;
  files: UploadFileMetadataInput[];
  status: ImportStatus;
  importedAt: string | null;
  errorMessage: string | null;
  agriskReadId: number | null;
  agriskReadPayload: AgriskReportReadResponse["read_payload"] | null;
  agriskWarnings: string[];
  cofaceReadId: number | null;
  cofaceReadPayload: CofaceReportReadResponse["read_payload"] | null;
  cofaceWarnings: string[];
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
    errorMessage: null,
    agriskReadId: null,
    agriskReadPayload: null,
    agriskWarnings: [],
    cofaceReadId: null,
    cofaceReadPayload: null,
    cofaceWarnings: []
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
  if (status === "pending") return "Pendente";
  if (status === "processing") return "Em processamento";
  if (status === "valid") return "VÃ¡lido";
  if (status === "valid_with_warnings") return "VÃ¡lido com alertas";
  if (status === "invalid") return "InvÃ¡lido";
  if (status === "success") return "Processado com sucesso";
  if (status === "error") return "Erro na leitura";
  return "Sem arquivo";
}

function isDocumentDivergenceMessage(message: string | null | undefined) {
  if (!message) return false;
  const normalized = message.toLowerCase();
  return normalized.includes("nÃ£o corresponde") || normalized.includes("nao corresponde") || normalized.includes("outro cnpj");
}

function agriskStatusBadgeLabel(state: ImportState) {
  if (state.status === "valid") {
    return "Validado";
  }
  if (state.status === "valid_with_warnings") {
    return "Validado com alertas";
  }
  if (state.status === "invalid" && isDocumentDivergenceMessage(state.errorMessage)) {
    return "CNPJ divergente";
  }
  return statusLabel(state.status);
}

function isAgriskValidatedStatus(status: ImportStatus) {
  return status === "valid" || status === "valid_with_warnings";
}

function isCofaceValidatedStatus(status: ImportStatus) {
  return status === "valid" || status === "valid_with_warnings";
}

function importStatusBadgeClass(status: ImportStatus) {
  if (status === "valid" || status === "success") return "bg-[#EAF7EE] text-[#166534]";
  if (status === "valid_with_warnings") return "bg-[#FFF7E8] text-[#92400E]";
  if (status === "pending" || status === "processing") return "bg-[#EFF6FF] text-[#1D4ED8]";
  if (status === "invalid" || status === "error") return "bg-[#FEF2F2] text-[#B91C1C]";
  return "bg-[#EEF3F8] text-[#4F647A]";
}

function importMonitorTitle(source: ImportSource) {
  return source === "internal" ?"Base importada" : "RelatÃ³rio importado";
}

function importMonitorSourceName(source: ImportSource) {
  if (source === "agrisk") return "Origem: Agrisk";
  if (source === "coface") return "Origem: COFACE";
  return "Origem: ImportaÃ§Ã£o interna";
}

function importMonitorStatusText(source: ImportSource, status: ImportStatus) {
  if (status === "pending") return "Aguardando inÃ­cio da leitura";
  if (status === "processing") return "Aguardando processamento";
  if (status === "invalid") return "RelatÃ³rio invÃ¡lido para esta anÃ¡lise";
  if (status === "valid_with_warnings") return "Dados importados com alertas";
  if (status === "error") return "Requer novo envio";
  if (source === "coface") return "DRA e indicadores prontos para anÃ¡lise";
  if (source === "internal") return "Dados internos prontos para anÃ¡lise";
  return "Dados prontos para anÃ¡lise";
}

function scoreSourceLabel(value: string | null | undefined) {
  if (!value) return "NÃ£o informado";
  if (value === "agrisk_report_primary") return "AgRisk principal";
  if (value === "boa_vista") return "Boa Vista";
  if (value === "quod") return "Quod";
  return value;
}

function confidenceLabel(value: string | null | undefined) {
  if (!value) return "NÃ£o informado";
  if (value === "high") return "Alta";
  if (value === "medium") return "MÃ©dia";
  if (value === "low") return "Baixa";
  return value;
}

function formatIsoDateToBr(value: string | null | undefined) {
  if (!value) return "NÃ£o informado";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return value;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function formatCnpjForDisplay(value: string | null | undefined) {
  const digits = sanitizeDigits(value ?? "");
  if (digits.length !== 14) return value || "NÃ£o informado";
  return formatCnpj(digits);
}

const agriskWarningLabelMap: Record<string, string> = {
  INFORMACOES_BASICAS: "InformaÃ§Ãµes bÃ¡sicas",
  INFORMACOES_CADASTRAIS: "InformaÃ§Ãµes cadastrais",
};

function formatAgriskWarning(warning: string) {
  const prefix = "Ancora critica ausente:";
  if (!warning.startsWith(prefix)) return warning;
  const rawCode = warning.slice(prefix.length).trim();
  const mapped = agriskWarningLabelMap[rawCode];
  if (mapped) return `Bloco esperado nÃ£o encontrado: ${mapped}`;
  return `Bloco esperado nÃ£o encontrado: ${rawCode.replaceAll("_", " ").toLowerCase()}`;
}

function importMonitorValueText(source: ImportSource) {
  if (source === "agrisk") return "Score, restriÃ§Ãµes e indicadores extraÃ­dos automaticamente.";
  if (source === "coface") return "DRA e indicadores corporativos extraÃ­dos automaticamente.";
  return "TÃ­tulos, vencimentos e pagamentos vinculados Ã  anÃ¡lise.";
}

function removeActionLabel(source: ImportSource) {
  return source === "internal" ?"Remover arquivo" : "Remover relatÃ³rio";
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
  const [manualGuaranteeLimitBeforeCoface, setManualGuaranteeLimitBeforeCoface] = useState<string | null>(null);

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
  const [pendingImportRawFile, setPendingImportRawFile] = useState<File | null>(null);
  const [pendingImportError, setPendingImportError] = useState<string | null>(null);
  const [isManualDrawerOpen, setIsManualDrawerOpen] = useState(false);
  const [isAgriskDataDrawerOpen, setIsAgriskDataDrawerOpen] = useState(false);
  const [isCofaceDataDrawerOpen, setIsCofaceDataDrawerOpen] = useState(false);
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
  const [triageModalOpen, setTriageModalOpen] = useState(true);
  const [triageState, setTriageState] = useState<"idle" | "loading" | "found_existing_customer" | "new_customer_external_data" | "recent_analysis_found" | "error" | "submitting" | "submitted">("idle");
  const [triageMessage, setTriageMessage] = useState<string | null>(null);
  const [triageSuggestedLimit, setTriageSuggestedLimit] = useState("R$ 0,00");
  const [triageResult, setTriageResult] = useState<CreditAnalysisTriageResponse | null>(null);
  const [triageSelectedBusinessUnit, setTriageSelectedBusinessUnit] = useState("");
  const [canCreateRequest, setCanCreateRequest] = useState(false);
  const [isEarlyReviewRequest, setIsEarlyReviewRequest] = useState(false);
  const [earlyReviewJustification, setEarlyReviewJustification] = useState("");

  const normalizedCnpj = sanitizeDigits(customer.cnpj);
  const matchedCustomers = useMemo(() => {
    if (!customersQuery.data || normalizedCnpj.length !== 14) return [];
    return customersQuery.data.filter((item) => sanitizeDigits(item.document_number) === normalizedCnpj);
  }, [customersQuery.data, normalizedCnpj]);

  const totalLimitCalculated = useMemo(() => {
    return toNumberInput(analysis.requestedLimit) + toNumberInput(analysis.currentLimit) + toNumberInput(analysis.usedLimit);
  }, [analysis.currentLimit, analysis.requestedLimit, analysis.usedLimit]);
  const exposureCalculated = useMemo(
    () => Math.max(0, totalLimitCalculated - toNumberInput(analysis.guaranteeLimit)),
    [analysis.guaranteeLimit, totalLimitCalculated]
  );
  const currencyFormatter = useMemo(() => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }), []);
  const totalLimitDisplay = currencyFormatter.format(totalLimitCalculated);
  const exposureDisplay = currencyFormatter.format(exposureCalculated);
  const hasPositiveExposure = exposureCalculated > 0;

  const hasAgriskImported = agriskImport.files.length > 0 && (agriskImport.status === "valid" || agriskImport.status === "valid_with_warnings");
  const hasInvalidAgriskImport = agriskImport.files.length > 0 && (agriskImport.status === "invalid" || agriskImport.status === "error");
  const hasCofaceImported = cofaceImport.files.length > 0 && isCofaceValidatedStatus(cofaceImport.status);
  const cofaceDecisionAmount = hasCofaceImported ?cofaceImport.cofaceReadPayload?.coface?.decision_amount ?? null : null;
  const hasCofaceCoverageImported = hasCofaceImported && cofaceDecisionAmount !== null;
  const hasInternalImported = internalImport.files.length > 0;
  const structuredSourcesCount = [hasAgriskImported, hasCofaceImported, hasInternalImported].filter(Boolean).length;
  const isManualBlocked = hasAgriskImported && hasCofaceImported && hasInternalImported;
  const hasStep2Source = manualConfigured || structuredSourcesCount > 0;
  const isStep2Ready = hasStep2Source;

  useEffect(() => {
    if (!hasAgriskImported) return;
    setManualPanel((prev) => (prev.scoreSource === "Agrisk" ?{ ...prev, scoreSource: "Serasa" } : prev));
  }, [hasAgriskImported]);

  useEffect(() => {
    if (hasCofaceCoverageImported && cofaceDecisionAmount !== null) {
      setManualGuaranteeLimitBeforeCoface((prev) => (prev === null ?analysis.guaranteeLimit : prev));
      setAnalysis((prev) => ({ ...prev, guaranteeLimit: currencyFormatter.format(Math.max(0, cofaceDecisionAmount)) }));
      return;
    }

    if (manualGuaranteeLimitBeforeCoface !== null) {
      setAnalysis((prev) => ({ ...prev, guaranteeLimit: manualGuaranteeLimitBeforeCoface }));
      setManualGuaranteeLimitBeforeCoface(null);
    }
  }, [
    analysis.guaranteeLimit,
    cofaceDecisionAmount,
    currencyFormatter,
    hasCofaceCoverageImported,
    manualGuaranteeLimitBeforeCoface
  ]);

  const submitMutation = useMutation({
    mutationFn: (payload: AnalysisJourneySubmitRequest) => submitAnalysisJourney(payload),
    onSuccess: (response) => router.push(`/analises/${response.analysis_id}`)
  });

  const lookupMutation = useMutation({
    mutationFn: (cnpj: string) => lookupExternalCnpj(cnpj),
    onSuccess: (response) => {
      if (response.status !== "ok" || !response.data) {
        setExternalLookupMessage(response.message ?? "NÃ£o foi possÃ­vel consultar os dados externos no momento.");
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
      setExternalLookupMessage("Dados cadastrais localizados automaticamente. VocÃª poderÃ¡ revisar e editar na prÃ³xima etapa.");
    },
    onError: (error: Error) =>
      setExternalLookupMessage(
        error.message || "A consulta externa estÃ¡ indisponÃ­vel no momento. Se necessÃ¡rio, informe os dados manualmente."
      )
  });

  useEffect(() => {
    const cookie = document.cookie.split("; ").find((item) => item.startsWith("gcc_permissions="));
    if (!cookie) return;
    try {
      const decoded = decodeURIComponent(cookie.split("=")[1] ?? "");
      const permissions = JSON.parse(decoded) as string[];
      setCanCreateRequest(permissions.includes("credit.request.create"));
    } catch {
      setCanCreateRequest(false);
    }
  }, []);

  const triageLookupMutation = useMutation({
    mutationFn: (cnpj: string) => triageCreditRequest({ cnpj }),
    onMutate: () => {
      setTriageState("loading");
      setTriageMessage(null);
    },
    onSuccess: (response) => {
      setTriageResult(response);
      setTriageSelectedBusinessUnit(response.customer_data.business_unit ?? "");
      const isExisting = response.found_in_portfolio;
      if (response.has_recent_analysis) {
        setTriageState("recent_analysis_found");
      } else {
        setTriageState(isExisting ? "found_existing_customer" : "new_customer_external_data");
      }
      setTriageMessage(response.message ?? null);
      setIsEarlyReviewRequest(false);
      setEarlyReviewJustification("");
      setExistingCustomerId(response.customer_data.customer_id ?? null);
      setCustomer((prev) => ({
        ...prev,
        cnpj: formatCnpj(response.customer_data.cnpj),
        companyName: response.customer_data.company_name ?? prev.companyName,
        region: response.customer_data.uf ?? prev.region
      }));
      if (response.economic_position) {
        setAnalysis((prev) => ({
          ...prev,
          currentLimit: formatCurrencyInputBRL(String(response.economic_position?.total_limit ?? 0)),
          usedLimit: formatCurrencyInputBRL(String(response.economic_position?.open_amount ?? 0))
        }));
      }
    },
    onError: (error) => {
      setTriageState("error");
      setTriageMessage(error instanceof Error ? error.message : "Falha ao consultar CNPJ.");
    }
  });

  const triageSubmitMutation = useMutation({
    mutationFn: (payload: { cnpj: string; suggested_limit: number; source: "cliente_existente_carteira" | "cliente_novo_consulta_externa"; customer_id?: number | null; company_name?: string | null; business_unit?: string | null }) =>
      submitTriageCreditRequest(payload),
    onMutate: () => setTriageState("submitting"),
    onSuccess: (response) => {
      setTriageState("submitted");
      setTriageMessage(
        isEarlyReviewRequest
          ? "SolicitaÃ§Ã£o de revisÃ£o antecipada enviada para anÃ¡lise financeira."
          : "SolicitaÃ§Ã£o enviada para anÃ¡lise financeira."
      );
      setTriageModalOpen(false);
      router.push(`/analises/monitor?analysis_id=${response.analysis_id}`);
    },
    onError: (error) => {
      setTriageState("error");
      setTriageMessage(error instanceof Error ? error.message : "Falha ao enviar solicitaÃ§Ã£o.");
    }
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
      if (normalizedCnpj.length !== 14) return "Preencha um CNPJ vÃ¡lido para continuar.";
      if (!customer.companyName.trim()) return "Preencha a razÃ£o social para continuar.";
    }

    if (stepNumber === 2 && !hasStep2Source) {
      if (hasInvalidAgriskImport) {
        return "O relatÃ³rio AgRisk enviado estÃ¡ invÃ¡lido para uso na anÃ¡lise. Substitua o arquivo para continuar.";
      }
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
        setStepError(`NÃ£o Ã© possÃ­vel avanÃ§ar para a etapa ${targetStep}. ${error}`);
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
    setPendingImportRawFile(null);
    setIsImportModalOpen(true);
  }

  function handleImportFileChange(files: FileList | null) {
    const rawFile = files?.[0] ?? null;
    const parsed = mapFiles(files);
    const selected = parsed[0] ?? null;
    if (!selected) {
      setPendingImportFile(null);
      setPendingImportRawFile(null);
      setPendingImportError(null);
      return;
    }

    if (selected.file_size > 10 * 1024 * 1024) {
      setPendingImportFile(null);
      setPendingImportRawFile(null);
      setPendingImportError("Arquivo invÃ¡lido. O tamanho mÃ¡ximo permitido Ã© 10 MB.");
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
    setPendingImportRawFile(rawFile);
  }

  async function confirmImport() {
    if (!pendingImportFile) return;
    const importedAt = new Date().toISOString();

    if (importModalSource === "agrisk") {
      if (!pendingImportRawFile) {
        setPendingImportError("NÃ£o foi possÃ­vel ler o arquivo selecionado.");
        return;
      }
      setAgriskImport((prev) => ({
        ...prev,
        files: [pendingImportFile],
        status: "processing",
        importedAt,
        errorMessage: null,
        agriskReadId: null,
        agriskReadPayload: null,
        agriskWarnings: []
      }));
      setPendingImportError(null);
      setPendingImportFile(null);
      setPendingImportRawFile(null);
      setIsAgriskDataDrawerOpen(false);
      setIsImportModalOpen(false);
      try {
        const response = await readAgriskReport(pendingImportRawFile, sanitizeDigits(customer.cnpj));
        setAgriskImport((prev) => ({
          ...prev,
          files: [pendingImportFile],
          status: response.status,
          importedAt,
          errorMessage: response.validation_message,
          agriskReadId: response.id,
          agriskReadPayload: response.read_payload,
          agriskWarnings: response.warnings
        }));
      } catch (error) {
        const message = error instanceof Error ?error.message : "Falha ao processar o relatÃ³rio AgRisk.";
        setAgriskImport((prev) => ({ ...prev, status: "error", errorMessage: message }));
      }
      return;
    } else if (importModalSource === "coface") {
      if (!pendingImportRawFile) {
        setPendingImportError("NÃ£o foi possÃ­vel ler o arquivo selecionado.");
        return;
      }
      setIsCofaceDataDrawerOpen(false);
      setCofaceImport((prev) => ({
        ...prev,
        files: [pendingImportFile],
        status: "processing",
        importedAt,
        errorMessage: null,
        cofaceReadId: null,
        cofaceReadPayload: null,
        cofaceWarnings: []
      }));
      setPendingImportError(null);
      setPendingImportFile(null);
      setPendingImportRawFile(null);
      setIsImportModalOpen(false);
      try {
        const response = await readCofaceReport(pendingImportRawFile, sanitizeDigits(customer.cnpj));
        setCofaceImport((prev) => ({
          ...prev,
          files: [pendingImportFile],
          status: response.status,
          importedAt,
          errorMessage: response.validation_message,
          cofaceReadId: response.id,
          cofaceReadPayload: response.read_payload,
          cofaceWarnings: response.warnings
        }));
      } catch (error) {
        const message = error instanceof Error ?error.message : "Falha ao processar o relatÃ³rio COFACE.";
        setCofaceImport((prev) => ({ ...prev, status: "error", errorMessage: message }));
      }
      return;
    } else {
      setInternalImport((prev) => ({ ...prev, files: [pendingImportFile], status: "processing", importedAt, errorMessage: null }));
      setTimeout(() => {
        setInternalImport((prev) => (prev.files.length > 0 ?{ ...prev, status: "success" } : prev));
      }, 900);
    }

    setPendingImportError(null);
    setPendingImportFile(null);
    setPendingImportRawFile(null);
    setIsImportModalOpen(false);
  }

  function removeImport(source: ImportSource) {
    const shouldRemove = window.confirm(
      source === "internal" ?"Deseja remover o arquivo importado desta fonte?" : "Deseja remover o relatÃ³rio importado desta fonte?"
    );
    if (!shouldRemove) return;
    if (source === "agrisk") {
      setIsAgriskDataDrawerOpen(false);
      setAgriskImport(buildDefaultImportState());
      return;
    }
    if (source === "coface") {
      setIsCofaceDataDrawerOpen(false);
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
      setOcr((prev) => (prev.files.length > 0 ?{ ...prev, status: "success" } : prev));
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
      observations: `Fonte do score: ${scoreIsFromImportedAgrisk ?"Agrisk (importado)" : manualPanel.scoreSource}; Score: ${scoreIsFromImportedAgrisk ?"informado por relatÃ³rio importado" : manualPanel.scoreValue}; DRA COFACE: ${cofaceIsFromImportedReport ?"informado por relatÃ³rio importado" : manualPanel.cofaceDra}; Faturamento interno 12 meses: ${manualPanel.internalRevenue12m || "nÃ£o informado"}`
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
        used_limit: toNumberInput(analysis.usedLimit),
        guarantee_limit: toNumberInput(analysis.guaranteeLimit),
        guarantee_limit_source: hasCofaceCoverageImported ?"coface_report" : "manual",
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
          has_commercial_history: manualConfigured ?manual.hasCommercialHistory : false,
          commercial_history_revenue: manualConfigured && manual.hasCommercialHistory ?toNullableNumberInput(manual.commercialHistoryRevenue) : null,
          contractual_avg_term_days: manualConfigured && manual.hasCommercialHistory ?toNullableNumberInput(manual.contractualAvgTermDays) : null,
          effective_avg_term_days: manualConfigured && manual.hasCommercialHistory ?toNullableNumberInput(manual.effectiveAvgTermDays) : null
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
          source_type: hasAgriskImported ?"agrisk" : hasCofaceImported ?"other" : "agrisk",
          coface_read_id: hasCofaceImported ?cofaceImport.cofaceReadId : null,
          coface_decision_amount: hasCofaceCoverageImported ?cofaceDecisionAmount : null,
          source_score: manualConfigured ?manualPanel.scoreValue : null,
          source_rating: manualConfigured ?`Fonte manual: ${manualPanel.scoreSource}` : "",
          negativations_count: Number(manual.negativationsCount || 0),
          protests_count: Number(manual.protestsCount || 0),
          lawsuits_count: manual.activeLawsuits ?1 : 0,
          has_restrictions: false,
          notes: [
            hasAgriskImported ?"Agrisk importado" : "",
            hasAgriskImported && agriskImport.agriskReadId ?`Leitura AgRisk ID: ${agriskImport.agriskReadId}` : "",
            hasAgriskImported && agriskImport.status ?`Status AgRisk: ${statusLabel(agriskImport.status)}` : "",
            hasAgriskImported && agriskImport.agriskReadPayload?.credit?.score_source
              ?`Fonte do score AgRisk: ${agriskImport.agriskReadPayload.credit.score_source}`
              : "",
            hasCofaceImported ?"COFACE importado" : "",
            hasCofaceCoverageImported && cofaceDecisionAmount !== null ?`Valor de cobertura COFACE: ${currencyFormatter.format(cofaceDecisionAmount)}` : "",
            manualConfigured && !hasCofaceImported ?`DRA COFACE manual: ${manualPanel.cofaceDra || "nÃ£o informado"}` : ""
          ]
            .filter(Boolean)
            .join(" Â· "),
          files: [...(hasAgriskImported ?agriskImport.files : []), ...cofaceImport.files]
        }
      }
    };
    submitMutation.mutate(payload);
  }

  function handleTriageLookup() {
    const digits = sanitizeDigits(customer.cnpj);
    if (digits.length !== 14) {
      setTriageState("error");
      setTriageMessage("Informe um CNPJ vÃ¡lido para continuar.");
      return;
    }
    triageLookupMutation.mutate(digits);
  }

  function handleTriageSubmit() {
    const suggested = toNumberInput(triageSuggestedLimit);
    if (suggested <= 0) {
      setTriageState("error");
      setTriageMessage("Informe o limite sugerido para submeter a solicitaÃ§Ã£o.");
      return;
    }
    if (triageResult?.has_recent_analysis && !isEarlyReviewRequest) {
      setTriageState("error");
      setTriageMessage("JÃ¡ existe uma anÃ¡lise recente para este cliente. Use a opÃ§Ã£o de revisÃ£o antecipada.");
      return;
    }
    if (isEarlyReviewRequest && !earlyReviewJustification.trim()) {
      setTriageState("error");
      setTriageMessage("Informe a justificativa para solicitar a revisÃ£o antecipada.");
      return;
    }
    if (!triageResult?.found_in_portfolio && triageResult?.requires_business_unit_selection && !triageSelectedBusinessUnit) {
      setTriageState("error");
      setTriageMessage("Selecione a Unidade de NegÃ³cio (BU) para continuar.");
      return;
    }
    const digits = sanitizeDigits(customer.cnpj);
    triageSubmitMutation.mutate({
      cnpj: digits,
      suggested_limit: suggested,
      source: triageResult?.found_in_portfolio ? "cliente_existente_carteira" : "cliente_novo_consulta_externa",
      customer_id: triageResult?.customer_data.customer_id ?? null,
      company_name: triageResult?.customer_data.company_name ?? customer.companyName,
      business_unit: triageResult?.found_in_portfolio ? (triageResult?.customer_data.business_unit ?? null) : (triageSelectedBusinessUnit || triageResult?.customer_data.business_unit || null),
      is_early_review_request: isEarlyReviewRequest,
      early_review_justification: isEarlyReviewRequest ? earlyReviewJustification.trim() : null,
      previous_analysis_id: triageResult?.last_analysis?.analysis_id ?? null
    });
  }

  if (customersQuery.isError) {
    return <ErrorState title="NÃ£o foi possÃ­vel carregar clientes" description={customersQuery.error.message} onRetry={() => customersQuery.refetch()} />;
  }

  const canContinue = step === 1 ?normalizedCnpj.length === 14 && Boolean(customer.companyName) : step === 2 ?hasStep2Source : step === 3 ?toNumberInput(analysis.requestedLimit) > 0 : true;
  const submitBlockingError = validateStep(1) ?? validateStep(2) ?? validateStep(3);
  const canSubmitJourney = !submitBlockingError && !submitMutation.isPending;
  const guaranteeOriginText = hasCofaceCoverageImported
    ? "COFACE (valor de cobertura)"
    : toNumberInput(analysis.guaranteeLimit) > 0
      ? "Informado manualmente"
      : "NÃ£o informado";
  const guaranteeDisplayText = hasCofaceCoverageImported && cofaceDecisionAmount !== null
    ? currencyFormatter.format(Math.max(0, cofaceDecisionAmount))
    : toNumberInput(analysis.guaranteeLimit) > 0
      ? formatCurrencyBRL(analysis.guaranteeLimit)
      : "NÃ£o informado";

  const consolidatedSources = [
    {
      key: "agrisk",
      name: "ImportaÃ§Ã£o Agrisk",
      isSent: hasAgriskImported,
      detail: hasAgriskImported
        ?`${agriskImport.files[0]?.original_filename ?? "Arquivo importado"} Â· ${formatFileSize(agriskImport.files[0]?.file_size ?? 0)} Â· enviado`
        : "RelatÃ³rio Agrisk nÃ£o importado"
    },
    {
      key: "coface",
      name: "ImportaÃ§Ã£o COFACE",
      isSent: hasCofaceImported,
      detail: hasCofaceImported
        ?`${cofaceImport.files[0]?.original_filename ?? "Arquivo importado"} Â· ${formatFileSize(cofaceImport.files[0]?.file_size ?? 0)} Â· enviado`
        : "RelatÃ³rio COFACE nÃ£o importado"
    },
    {
      key: "manual",
      name: "Preenchimento manual",
      isSent: manualStatus === "preenchido",
      detail: manualStatus === "preenchido" ?"Dados manuais preenchidos" : "NÃ£o preenchido"
    },
    {
      key: "ocr",
      name: "OCR DRE / BalanÃ§o",
      isSent: ocr.files.length > 0,
      detail: ocr.files.length > 0
        ?`${ocr.files[0]?.original_filename ?? "Demonstrativo anexado"} Â· ${formatFileSize(ocr.files[0]?.file_size ?? 0)} Â· enviado`
        : "Nenhum demonstrativo anexado"
    },
    {
      key: "internal",
      name: "ImportaÃ§Ã£o interna",
      isSent: hasInternalImported,
      detail: hasInternalImported
        ?`${internalImport.files[0]?.original_filename ?? "Planilha importada"} Â· ${formatFileSize(internalImport.files[0]?.file_size ?? 0)} Â· enviada`
        : "Planilha de tÃ­tulos nÃ£o importada"
    }
  ];
  const consolidatedSourcesSentCount = consolidatedSources.filter((source) => source.isSent).length;
  const customerReady = normalizedCnpj.length === 14 && Boolean(customer.companyName.trim());
  const requestedLimitReady = toNumberInput(analysis.requestedLimit) > 0;

  return (
    <section className={`readability-standard ${step === 4 ?"space-y-0 rounded-[12px] bg-[#F7F9FC]" : "space-y-4"}`}>
      {step !== 4 ?(
        <div className="flex items-center justify-between rounded-[14px] border border-[#D7E1EC] bg-white px-6 py-5">
        <div>
          <p className="text-[17px] font-semibold text-[#102033]">Nova anÃ¡lise de crÃ©dito</p>
          <p className="text-[13px] text-[#4F647A]">
            Identifique o cliente, informe os dados da solicitaÃ§Ã£o e reÃºna as informaÃ§Ãµes necessÃ¡rias para anÃ¡lise de crÃ©dito.
          </p>
          <p className="mt-1 text-[11px] text-[#8FA3B4]">A consulta externa Ã© opcional. Se necessÃ¡rio, os dados podem ser informados manualmente.</p>
        </div>
        <Link href="/analises" className="rounded-[8px] border border-[#D7E1EC] bg-white px-4 py-2 text-[12px] font-medium text-[#4F647A] hover:bg-[#f9fafb]">
          <span className="mr-1"></span> Voltar para anÃ¡lises
        </Link>
      </div>
      ) : null}

      {step !== 4 ?(
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
                    isDone ?"bg-[#295B9A] text-white" : isActive ?"bg-[#0D1B2A] text-white ring-2 ring-[#295B9A]/20" : "bg-[#EEF3F8] text-[#8FA3B4]"
                  }`}
                >
                  {isDone ?<Check className="h-3.5 w-3.5" /> : stepNumber}
                </span>
                <span className={`text-[11px] font-medium ${isDone ?"text-[#295B9A]" : isActive ?"text-[#102033]" : "text-[#8FA3B4]"}`}>{label}</span>
              </button>
              {index !== steps.length - 1 ?<div className={`mx-3 h-px flex-1 ${isDone ?"bg-[#295B9A]" : "bg-[#D7E1EC]"}`} /> : null}
            </div>
          );
        })}
      </div>
      ) : null}

      {stepError ?<div className="rounded-[8px] border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[12px] text-[#b91c1c]">{stepError}</div> : null}

      {step === 1 ?(
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
            {lookupMutation.isPending ?"Consultando dados cadastrais..." : externalLookupMessage ?? "A consulta externa Ã© opcional. Se necessÃ¡rio, os dados podem ser informados manualmente."}
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
                RazÃ£o social<RequiredMark />
                <input value={customer.companyName} onChange={(event) => setCustomer((prev) => ({ ...prev, companyName: event.target.value }))} className="mt-1 h-9 w-full rounded-[6px] border px-3 text-[12px]" />
              </label>
              <label className="text-[11px] text-[#374151]">Segmento<input value={customer.segment} onChange={(event) => setCustomer((prev) => ({ ...prev, segment: event.target.value }))} className="mt-1 h-9 w-full rounded-[6px] border px-3 text-[12px]" /></label>
              <label className="text-[11px] text-[#374151]">RegiÃ£o<input value={customer.region} onChange={(event) => setCustomer((prev) => ({ ...prev, region: event.target.value }))} className="mt-1 h-9 w-full rounded-[6px] border px-3 text-[12px]" /></label>
              <label className="text-[11px] text-[#374151]">Data de relacionamento<input type="date" value={customer.relationshipStartDate} onChange={(event) => setCustomer((prev) => ({ ...prev, relationshipStartDate: event.target.value }))} className="mt-1 h-9 w-full rounded-[6px] border px-3 text-[12px]" /></label>
              <label className="text-[11px] text-[#374151]">EndereÃ§o<input value={customer.address} onChange={(event) => setCustomer((prev) => ({ ...prev, address: event.target.value }))} className="mt-1 h-9 w-full rounded-[6px] border px-3 text-[12px]" /></label>
              <label className="text-[11px] text-[#374151]">Telefone<input value={customer.phone} onChange={(event) => setCustomer((prev) => ({ ...prev, phone: event.target.value }))} className="mt-1 h-9 w-full rounded-[6px] border px-3 text-[12px]" /></label>
              <label className="text-[11px] text-[#374151] md:col-span-2">E-mail<input value={customer.email} onChange={(event) => setCustomer((prev) => ({ ...prev, email: event.target.value }))} className="mt-1 h-9 w-full rounded-[6px] border px-3 text-[12px]" /></label>
            </div>
          </div>
        </article>
      ) : null}

      {step >= 2 ?(
        <div className={`flex items-center gap-3 bg-white ${step === 4 ?"h-[44px] border-b border-[#D7E1EC] px-7" : "rounded-[10px] border border-[#D7E1EC] px-5 py-3"}`}>
          <div className="mr-1 text-[11px] text-[#8FA3B4]">Cliente da solicitaÃ§Ã£o</div>
          <div className={`flex items-center justify-center rounded-[6px] text-[10px] font-bold ${step === 4 ?"h-[26px] w-[26px] bg-[#295B9A] text-white" : "h-7 w-7 bg-[#EEF3F8] text-[#295B9A]"}`}>
            {toInitials(customer.companyName || "Cliente")}
          </div>
          <div className="text-[13px] font-semibold text-[#102033]">{customer.companyName || "Cliente nÃ£o informado"}</div>
          <div className="text-[11px] text-[#4F647A]">{customer.cnpj || "CNPJ nÃ£o informado"}</div>
          <div className={`ml-auto rounded-full bg-[#EEF3F8] px-2.5 py-1 font-medium ${step === 4 ?"text-[11px] text-[#295B9A]" : "text-[10px] text-[#4F647A]"}`}>Etapa {step} de 4</div>
        </div>
      ) : null}

      {step === 2 ?(
        <>
          <article className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[15px] font-semibold text-[#102033]">InformaÃ§Ãµes para anÃ¡lise</p>
                <p className="text-[12px] text-[#4F647A]">Escolha como deseja estruturar os dados da anÃ¡lise. VocÃª pode combinar mÃºltiplas fontes.</p>
              </div>
              <div className="space-y-1 text-right">
                <p className="text-[11px] font-medium text-[#4F647A]">{structuredSourcesCount} de 3 fontes estruturadas preenchidas</p>
                {isStep2Ready ?<p className="text-[11px] text-[#166534]">Dados suficientes para avanÃ§ar para a prÃ³xima etapa</p> : null}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <button
                type="button"
                onClick={() => openImportModal("agrisk")}
                className={`relative flex h-full flex-col rounded-[16px] border-2 border-[#295B9A] bg-white p-6 text-left transition hover:-translate-y-0.5 ${
                  agriskImport.status !== "empty" ?"cursor-pointer hover:shadow-[0_10px_30px_rgba(16,32,51,0.08)]" : ""
                }`}
              >
                {agriskImport.status === "empty" ?(
                  <>
                    <span className="absolute left-6 top-0 -translate-y-1/2 rounded-full bg-[#295B9A] px-3 py-1 text-[10px] font-semibold text-white">Principal</span>
                    <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-[12px] bg-[#EEF3F8]">
                      <Upload className="h-5 w-5 text-[#295B9A]" />
                    </div>
                    <p className="mb-1 text-[10px] uppercase tracking-[0.6px] text-[#8FA3B4]">Consulta externa</p>
                    <p className="mb-2 text-[15px] font-semibold text-[#102033]">ImportaÃ§Ã£o Agrisk</p>
                    <p className="flex-1 text-[12px] leading-relaxed text-[#4F647A]">
                      Importe o relatÃ³rio exportado da Agrisk para leitura automÃ¡tica e estruturaÃ§Ã£o dos dados de crÃ©dito.
                    </p>
                    <p className="mt-2 border-t border-[#EEF3F8] pt-2 text-[11px] leading-relaxed text-[#8FA3B4]">
                      O sistema identifica automaticamente score, restriÃ§Ãµes e indicadores relevantes para a anÃ¡lise.
                    </p>
                    <span className="mt-4 inline-flex items-center justify-center rounded-[9px] bg-[#295B9A] px-4 py-2 text-[12px] font-medium text-white">
                      Importar relatÃ³rio Agrisk <ChevronRight className="ml-1 h-3.5 w-3.5" />
                    </span>
                  </>
                ) : (
                  <>
                    <div className="mb-3 flex items-start justify-between gap-2">
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.6px] text-[#8FA3B4]">Consulta externa</p>
                        <p className="text-[15px] font-semibold text-[#102033]">ImportaÃ§Ã£o Agrisk</p>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${importStatusBadgeClass(agriskImport.status)}`}>
                        {agriskStatusBadgeLabel(agriskImport)}
                      </span>
                    </div>
                    <div className="mb-3 flex flex-1 flex-col justify-between rounded-[10px] border border-[#D7E1EC] bg-[#F8FBFF] p-3">
                      <div>
                        <p className="text-[10px] font-medium uppercase tracking-[0.5px] text-[#8FA3B4]">{importMonitorSourceName("agrisk")}</p>
                        <p className="mt-1 text-[11px] font-semibold text-[#102033]">{importMonitorTitle("agrisk")}</p>
                        <p className="mt-1 truncate text-[11px] text-[#102033]">{agriskImport.files[0]?.original_filename ?? "Sem arquivo vinculado"}</p>
                        <p className="text-[10px] text-[#64748B]">
                          {agriskImport.files[0] ?`${formatFileSize(agriskImport.files[0].file_size)} Â· ${agriskImport.importedAt ?`Importado em ${formatImportedAt(agriskImport.importedAt)}` : "Importado"}` : agriskImport.errorMessage ?? "Falha na leitura do arquivo."}
                        </p>
                        <p className="mt-1 text-[10px] text-[#4F647A]">{importMonitorValueText("agrisk")}</p>
                        {agriskImport.status === "valid" ?(
                          <p className="mt-1 text-[10px] text-[#4F647A]">RelatÃ³rio validado e pronto para anÃ¡lise.</p>
                        ) : null}
                        {agriskImport.status === "valid_with_warnings" ?(
                          <>
                            <p className="mt-1 text-[10px] text-[#92400E]">RelatÃ³rio validado com alertas de leitura.</p>
                            <p className="mt-1 text-[10px] text-[#4F647A]">Confira os detalhes em Ver dados importados.</p>
                          </>
                        ) : null}
                        {!isAgriskValidatedStatus(agriskImport.status) && !(agriskImport.status === "invalid" && isDocumentDivergenceMessage(agriskImport.errorMessage)) ?(
                          <p className={`mt-1 text-[10px] ${agriskImport.status === "invalid" || agriskImport.status === "error" ?"text-[#B91C1C]" : "text-[#4F647A]"}`}>
                            {importMonitorStatusText("agrisk", agriskImport.status)}
                          </p>
                        ) : null}
                        {!isAgriskValidatedStatus(agriskImport.status) && agriskImport.errorMessage && !isDocumentDivergenceMessage(agriskImport.errorMessage) ?(
                          <p className={`mt-1 text-[10px] ${agriskImport.status === "invalid" ?"text-[#B91C1C]" : "text-[#4F647A]"}`}>
                            {agriskImport.errorMessage}
                          </p>
                        ) : null}
                        {agriskImport.status === "invalid" && isDocumentDivergenceMessage(agriskImport.errorMessage) ?(
                          <p className="mt-1 text-[10px] text-[#B91C1C]">
                            O CNPJ do relatÃ³rio nÃ£o corresponde ao cliente informado.
                          </p>
                        ) : null}
                        {(agriskImport.status === "invalid" || agriskImport.status === "error") && !isDocumentDivergenceMessage(agriskImport.errorMessage) ?(
                          <p className="mt-1 text-[10px] text-[#B91C1C]">
                            Este relatÃ³rio nÃ£o serÃ¡ considerado apto para anÃ¡lise atÃ© ser substituÃ­do.
                          </p>
                        ) : null}
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] font-medium">
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
                        {isAgriskValidatedStatus(agriskImport.status) && agriskImport.agriskReadPayload ?(
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setIsAgriskDataDrawerOpen(true);
                            }}
                            className="rounded-[8px] border border-[#D7E1EC] bg-white px-3 py-1.5 text-[11px] font-medium text-[#295B9A]"
                          >
                            Ver dados importados
                          </button>
                        ) : null}
                        {(agriskImport.status === "invalid" || agriskImport.status === "error") ?(
                          <span className="inline-flex items-center justify-center rounded-[9px] bg-[#295B9A] px-4 py-2 text-[12px] font-medium text-white">
                            Substituir relatÃ³rio <ChevronRight className="ml-1 h-3.5 w-3.5" />
                          </span>
                        ) : null}
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
                    ?"cursor-pointer border-[#295B9A] hover:-translate-y-0.5 hover:shadow-[0_10px_30px_rgba(16,32,51,0.08)]"
                    : "border-[#D7E1EC]"
                }`}
              >
                {cofaceImport.status === "empty" ?(
                  <>
                    <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-[12px] bg-[#F7F9FC]">
                      <Upload className="h-5 w-5 text-[#295B9A]" />
                    </div>
                    <p className="mb-1 text-[10px] uppercase tracking-[0.6px] text-[#8FA3B4]">Consulta externa</p>
                    <p className="mb-2 text-[15px] font-semibold text-[#102033]">ImportaÃ§Ã£o COFACE</p>
                    <p className="flex-1 text-[12px] leading-relaxed text-[#4F647A]">
                      Importe o relatÃ³rio exportado da COFACE para leitura automÃ¡tica dos indicadores de risco e DRA.
                    </p>
                    <p className="mt-2 border-t border-[#EEF3F8] pt-2 text-[11px] leading-relaxed text-[#8FA3B4]">
                      O sistema identifica automaticamente DRA e outros indicadores relevantes para anÃ¡lise corporativa.
                    </p>
                    <span className="mt-4 inline-flex items-center justify-center rounded-[9px] border border-[#D7E1EC] bg-[#F7F9FC] px-4 py-2 text-[12px] font-medium text-[#102033]">
                      Importar relatÃ³rio COFACE <ChevronRight className="ml-1 h-3.5 w-3.5" />
                    </span>
                  </>
                ) : (
                  <>
                    <div className="mb-3 flex items-start justify-between gap-2">
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.6px] text-[#8FA3B4]">Consulta externa</p>
                        <p className="text-[15px] font-semibold text-[#102033]">ImportaÃ§Ã£o COFACE</p>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${importStatusBadgeClass(cofaceImport.status)}`}>
                        {statusLabel(cofaceImport.status)}
                      </span>
                    </div>
                    <div className="mb-3 flex flex-1 flex-col justify-between rounded-[10px] border border-[#D7E1EC] bg-[#F8FBFF] p-3">
                      <div>
                        <p className="text-[10px] font-medium uppercase tracking-[0.5px] text-[#8FA3B4]">{importMonitorSourceName("coface")}</p>
                        <p className="mt-1 text-[11px] font-semibold text-[#102033]">{importMonitorTitle("coface")}</p>
                        <p className="mt-1 truncate text-[11px] text-[#102033]">{cofaceImport.files[0]?.original_filename ?? "Sem arquivo vinculado"}</p>
                        <p className="text-[10px] text-[#64748B]">
                          {cofaceImport.files[0] ?`${formatFileSize(cofaceImport.files[0].file_size)} Â· ${cofaceImport.importedAt ?`Importado em ${formatImportedAt(cofaceImport.importedAt)}` : "Importado"}` : cofaceImport.errorMessage ?? "Falha na leitura do arquivo."}
                        </p>
                        <p className="mt-1 text-[10px] text-[#4F647A]">{importMonitorValueText("coface")}</p>
                        <p className="mt-1 text-[10px] text-[#4F647A]">{importMonitorStatusText("coface", cofaceImport.status)}</p>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] font-medium">
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
                        {isCofaceValidatedStatus(cofaceImport.status) ?(
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setIsCofaceDataDrawerOpen(true);
                            }}
                            className="rounded-[8px] border border-[#D7E1EC] bg-white px-3 py-1.5 text-[11px] font-medium text-[#295B9A]"
                          >
                            Ver dados importados
                          </button>
                        ) : null}
                        {(cofaceImport.status === "invalid" || cofaceImport.status === "error") ?(
                          <span className="inline-flex items-center justify-center rounded-[9px] bg-[#295B9A] px-4 py-2 text-[12px] font-medium text-white">
                            Substituir relatÃ³rio <ChevronRight className="ml-1 h-3.5 w-3.5" />
                          </span>
                        ) : null}
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
                    ?"cursor-pointer border-[#295B9A] hover:-translate-y-0.5 hover:shadow-[0_10px_30px_rgba(16,32,51,0.08)]"
                    : "border-[#D7E1EC]"
                }`}
              >
                {internalImport.status === "empty" ?(
                  <>
                    <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-[12px] bg-[#F7F9FC]">
                      <Upload className="h-5 w-5 text-[#4F647A]" />
                    </div>
                    <p className="mb-1 text-[10px] uppercase tracking-[0.6px] text-[#8FA3B4]">Base interna</p>
                    <p className="mb-2 text-[15px] font-semibold text-[#102033]">ImportaÃ§Ã£o interna</p>
                    <p className="flex-1 text-[12px] leading-relaxed text-[#4F647A]">
                      Importe planilhas com tÃ­tulos, vencimentos e pagamentos para complementar a anÃ¡lise de crÃ©dito.
                    </p>
                    <p className="mt-2 border-t border-[#EEF3F8] pt-2 text-[11px] leading-relaxed text-[#8FA3B4]">
                      O sistema estrutura automaticamente os dados internos para acelerar a leitura da operaÃ§Ã£o.
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
                        <p className="text-[15px] font-semibold text-[#102033]">ImportaÃ§Ã£o interna</p>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${importStatusBadgeClass(internalImport.status)}`}>
                        {statusLabel(internalImport.status)}
                      </span>
                    </div>
                    <div className="mb-3 flex flex-1 flex-col justify-between rounded-[10px] border border-[#D7E1EC] bg-[#F8FBFF] p-3">
                      <div>
                        <p className="text-[10px] font-medium uppercase tracking-[0.5px] text-[#8FA3B4]">{importMonitorSourceName("internal")}</p>
                        <p className="mt-1 text-[11px] font-semibold text-[#102033]">{importMonitorTitle("internal")}</p>
                        <p className="mt-1 truncate text-[11px] text-[#102033]">{internalImport.files[0]?.original_filename ?? "Sem arquivo vinculado"}</p>
                        <p className="text-[10px] text-[#64748B]">
                          {internalImport.files[0] ?`${formatFileSize(internalImport.files[0].file_size)} Â· ${internalImport.importedAt ?`Importado em ${formatImportedAt(internalImport.importedAt)}` : "Importado"}` : internalImport.errorMessage ?? "Falha na leitura do arquivo."}
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
                  isManualBlocked ?"cursor-not-allowed border-[#D7E1EC] opacity-75" : "hover:border-[#295B9A]"
                }`}
              >
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-[12px] bg-[#F7F9FC]">
                  <span className="text-xl text-[#4F647A]">+</span>
                </div>
                <p className="mb-1 text-[10px] uppercase tracking-[0.6px] text-[#8FA3B4]">Entrada manual</p>
                <p className="mb-2 text-[15px] font-semibold text-[#102033]">Complemento manual</p>
                <p className="flex-1 text-[12px] leading-relaxed text-[#4F647A]">
                  Informe apenas dados internos comerciais e operacionais para complementar a anÃ¡lise.
                </p>
                {isManualBlocked ?(
                  <p className="mt-2 border-t border-[#EEF3F8] pt-2 text-[11px] leading-relaxed text-[#8FA3B4]">
                    Complemento manual indisponÃ­vel. Agrisk, COFACE e importaÃ§Ã£o interna jÃ¡ foram carregados nesta anÃ¡lise.
                  </p>
                ) : null}
                <span className="mt-4 inline-flex items-center justify-center rounded-[9px] border border-[#D7E1EC] bg-[#F7F9FC] px-4 py-2 text-[12px] font-medium text-[#102033]">
                  {isManualBlocked ?"Complemento manual indisponÃ­vel" : "Preencher manualmente"}
                </span>
              </button>
            </div>

            {ocr.files.length === 0 ?(
              <div className="flex items-center justify-between rounded-[14px] border border-dashed border-[#D7E1EC] bg-white px-6 py-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-[#D7E1EC] bg-[#F7F9FC] text-[#8FA3B4]">
                    <Upload className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-[13px] font-medium text-[#4F647A]">
                      Complementar com demonstrativos financeiros <span className="text-[10px] font-normal text-[#8FA3B4]">(opcional)</span>
                    </p>
                    <p className="text-[11px] text-[#8FA3B4]">Envio de DRE ou balanÃ§o para leitura assistida.</p>
                    {ocr.status === "error" && ocr.errorMessage ?<p className="mt-1 text-[11px] text-[#B91C1C]">{ocr.errorMessage}</p> : null}
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
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${ocr.status === "success" ?"bg-[#EAF7EE] text-[#166534]" : ocr.status === "processing" ?"bg-[#EFF6FF] text-[#1D4ED8]" : "bg-[#FEF2F2] text-[#B91C1C]"}`}>
                    {statusLabel(ocr.status)}
                  </span>
                </div>
                <div className="rounded-[10px] border border-[#D7E1EC] bg-[#F8FBFF] p-3">
                  <p className="truncate text-[11px] font-semibold text-[#102033]">{ocr.files[0]?.original_filename ?? "Sem arquivo vinculado"}</p>
                  <p className="text-[10px] text-[#64748B]">
                    {ocr.files[0] ?`${formatFileSize(ocr.files[0].file_size)} Â· ${ocr.importedAt ?`Importado em ${formatImportedAt(ocr.importedAt)}` : "Importado"}` : "Sem arquivo vinculado"}
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

          {isImportModalOpen ?(
            <div className="fixed inset-0 z-40 flex items-center justify-center bg-[#0D1B2A]/55 p-4" onClick={() => setIsImportModalOpen(false)}>
              <div className="w-full max-w-[480px] rounded-[18px] bg-white p-7 shadow-xl" onClick={(event) => event.stopPropagation()}>
                <button type="button" onClick={() => setIsImportModalOpen(false)} className="absolute hidden" />
                <div className="mb-5 flex items-start justify-between">
                  <div>
                    <p className="text-[16px] font-semibold text-[#102033]">
                      {importModalSource === "agrisk"
                        ?"Importar relatÃ³rio Agrisk"
                        : importModalSource === "coface"
                          ?"Importar relatÃ³rio COFACE"
                          : "Importar base interna"}
                    </p>
                    <p className="text-[12px] text-[#4F647A]">
                      {importModalSource === "agrisk"
                        ?"Selecione ou arraste o arquivo exportado da Agrisk para processamento automÃ¡tico."
                        : importModalSource === "coface"
                          ?"Selecione ou arraste o arquivo exportado da COFACE para leitura automÃ¡tica do DRA e indicadores de risco."
                          : "Selecione a planilha com tÃ­tulos, vencimentos e pagamentos para complementar a anÃ¡lise."}
                    </p>
                  </div>
                  <button type="button" onClick={() => setIsImportModalOpen(false)} className="flex h-7 w-7 items-center justify-center rounded-full border border-[#D7E1EC] bg-[#F7F9FC] text-[#4F647A]">
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {pendingImportFile ?(
                  <div className="mb-4 rounded-[8px] border border-[#B5D4F4] bg-[#EEF3F8] p-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-[7px] border border-[#D7E1EC] bg-white">
                        <Upload className="h-4 w-4 text-[#295B9A]" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12px] font-medium text-[#102033]">{pendingImportFile.original_filename}</p>
                        <p className="text-[11px] text-[#8FA3B4]">{formatFileSize(pendingImportFile.file_size)} Â· Arquivo selecionado</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setPendingImportFile(null);
                          setPendingImportRawFile(null);
                          setPendingImportError(null);
                        }}
                        className="text-[#8FA3B4]"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="mt-3 flex items-center gap-2 rounded-[8px] border border-[#CFE0F4] bg-white px-3 py-2 text-[11px] text-[#295B9A]">
                      <Check className="h-3.5 w-3.5" />
                      {importModalSource === "agrisk"
                        ?"Pronto para importaÃ§Ã£o. A validaÃ§Ã£o do CNPJ serÃ¡ realizada apÃ³s clicar em Importar."
                        : "Pronto para importaÃ§Ã£o."}
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
                  {["PDF Â· XLSX", "MÃ¡x. 10 MB", "1 arquivo por anÃ¡lise"].map((hint) => (
                    <span key={hint} className="rounded-[6px] bg-[#EEF3F8] px-2.5 py-1 text-[11px] text-[#4F647A]">
                      {hint}
                    </span>
                  ))}
                </div>

                {pendingImportError ?(
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

          {isAgriskDataDrawerOpen ?(
            <div className="fixed inset-0 z-40 flex justify-end bg-[#0D1B2A]/45" onClick={() => setIsAgriskDataDrawerOpen(false)}>
              <div className="flex h-full w-full max-w-[560px] flex-col bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
                <div className="flex items-start justify-between border-b border-[#EEF3F8] px-6 py-5">
                  <div>
                    <p className="text-[15px] font-semibold text-[#102033]">Dados importados do relatÃ³rio AgRisk</p>
                    <p className="text-[12px] text-[#4F647A]">Somente os dados estruturados utilizados pelo motor de crÃ©dito.</p>
                  </div>
                  <button type="button" onClick={() => setIsAgriskDataDrawerOpen(false)} className="flex h-7 w-7 items-center justify-center rounded-full border border-[#D7E1EC] bg-[#F7F9FC] text-[#4F647A]">
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto px-6 py-5">
                  <div className="mb-6">
                    <p className="mb-3 border-b border-[#EEF3F8] pb-1.5 text-[10px] font-semibold uppercase tracking-[0.7px] text-[#295B9A]">IdentificaÃ§Ã£o</p>
                    <div className="space-y-1 text-[12px] text-[#4F647A]">
                      <p><span className="font-medium text-[#102033]">RazÃ£o social:</span> {agriskImport.agriskReadPayload?.company?.name || "NÃ£o informado"}</p>
                      <p><span className="font-medium text-[#102033]">Documento:</span> {agriskImport.agriskReadPayload?.company?.document || "NÃ£o informado"}</p>
                      <p><span className="font-medium text-[#102033]">Abertura:</span> {agriskImport.agriskReadPayload?.company?.opened_at || "NÃ£o informado"}</p>
                      <p><span className="font-medium text-[#102033]">Idade:</span> {agriskImport.agriskReadPayload?.company?.age_years ?? "NÃ£o informado"}</p>
                    </div>
                  </div>

                  <div className="mb-6">
                    <p className="mb-3 border-b border-[#EEF3F8] pb-1.5 text-[10px] font-semibold uppercase tracking-[0.7px] text-[#295B9A]">CrÃ©dito</p>
                    <div className="space-y-1 text-[12px] text-[#4F647A]">
                      <p><span className="font-medium text-[#102033]">Score principal:</span> {agriskImport.agriskReadPayload?.credit?.score ?? "NÃ£o informado"}</p>
                      <p><span className="font-medium text-[#102033]">Fonte do score principal:</span> {scoreSourceLabel(agriskImport.agriskReadPayload?.credit?.score_source)}</p>
                      <p><span className="font-medium text-[#102033]">Rating:</span> {agriskImport.agriskReadPayload?.credit?.rating || "NÃ£o informado"}</p>
                      <p><span className="font-medium text-[#102033]">Probabilidade de inadimplÃªncia:</span> {agriskImport.agriskReadPayload?.credit?.default_probability != null ?`${(agriskImport.agriskReadPayload.credit.default_probability * 100).toFixed(1).replace(".", ",")}%` : "NÃ£o informado"}</p>
                      <p><span className="font-medium text-[#102033]">ClassificaÃ§Ã£o:</span> {agriskImport.agriskReadPayload?.credit?.default_probability_label || "NÃ£o informado"}</p>
                    </div>
                  </div>

                  <div className="mb-6">
                    <p className="mb-3 border-b border-[#EEF3F8] pb-1.5 text-[10px] font-semibold uppercase tracking-[0.7px] text-[#295B9A]">Restritivos</p>
                    <div className="space-y-1 text-[12px] text-[#4F647A]">
                      <p><span className="font-medium text-[#102033]">Quantidade:</span> {agriskImport.agriskReadPayload?.restrictions?.negative_events_count ?? 0}</p>
                      <p><span className="font-medium text-[#102033]">Valor total:</span> {agriskImport.agriskReadPayload?.restrictions?.negative_events_total_amount != null ?`R$ ${agriskImport.agriskReadPayload.restrictions.negative_events_total_amount.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "NÃ£o informado"}</p>
                      <p><span className="font-medium text-[#102033]">Ãšltimo apontamento:</span> {agriskImport.agriskReadPayload?.restrictions?.last_negative_event_at || "NÃ£o informado"}</p>
                    </div>
                  </div>

                  <div className="mb-6">
                    <p className="mb-3 border-b border-[#EEF3F8] pb-1.5 text-[10px] font-semibold uppercase tracking-[0.7px] text-[#295B9A]">Protestos / CCF</p>
                    <div className="space-y-1 text-[12px] text-[#4F647A]">
                      <p><span className="font-medium text-[#102033]">Protestos:</span> {agriskImport.agriskReadPayload?.protests?.count ?? 0}</p>
                      <p><span className="font-medium text-[#102033]">Valor total de protestos:</span> {agriskImport.agriskReadPayload?.protests?.total_amount != null ?`R$ ${agriskImport.agriskReadPayload.protests.total_amount.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "R$ 0,00"}</p>
                      <p><span className="font-medium text-[#102033]">CCF com registros:</span> {agriskImport.agriskReadPayload?.checks_without_funds?.has_records ?"Sim" : "NÃ£o"}</p>
                    </div>
                  </div>

                  <div className="mb-6">
                    <p className="mb-3 border-b border-[#EEF3F8] pb-1.5 text-[10px] font-semibold uppercase tracking-[0.7px] text-[#295B9A]">Consultas</p>
                    <p className="text-[12px] text-[#4F647A]"><span className="font-medium text-[#102033]">Total de consultas:</span> {agriskImport.agriskReadPayload?.consultations?.total ?? 0}</p>
                  </div>

                  <div className="mb-6">
                    <p className="mb-3 border-b border-[#EEF3F8] pb-1.5 text-[10px] font-semibold uppercase tracking-[0.7px] text-[#295B9A]">SocietÃ¡rio</p>
                    <div className="space-y-1 text-[12px] text-[#4F647A]">
                      {(agriskImport.agriskReadPayload?.ownership?.shareholding ?? []).length > 0 ?(
                        (agriskImport.agriskReadPayload?.ownership?.shareholding ?? []).map((item) => <p key={item}>{item}</p>)
                      ) : (
                        <p>Sem participaÃ§Ãµes societÃ¡rias estruturadas.</p>
                      )}
                    </div>
                  </div>

                  <div>
                    <p className="mb-3 border-b border-[#EEF3F8] pb-1.5 text-[10px] font-semibold uppercase tracking-[0.7px] text-[#295B9A]">Qualidade da leitura</p>
                    <div className="space-y-1 text-[12px] text-[#4F647A]">
                      <p><span className="font-medium text-[#102033]">ConfianÃ§a:</span> {confidenceLabel(cofaceImport.cofaceReadPayload?.read_quality?.confidence)}</p>
                      {(agriskImport.agriskWarnings ?? []).length > 0 ?(
                        <div className="mt-2 rounded-[10px] border border-[#F3D7A1] bg-[#FFF7E8] p-3">
                          <p className="text-[12px] font-semibold text-[#92400E]">Alertas de leitura</p>
                          <p className="mt-1 text-[11px] text-[#7C5A1D]">
                            Alguns blocos esperados nÃ£o foram encontrados, mas a leitura principal foi concluÃ­da.
                          </p>
                          <ul className="mt-2 list-disc space-y-1 pl-4 text-[11px] text-[#7C5A1D]">
                            {(agriskImport.agriskWarnings ?? []).map((warning) => (
                              <li key={warning}>{formatAgriskWarning(warning)}</li>
                            ))}
                          </ul>
                        </div>
                      ) : (
                        <p>Nenhum alerta identificado na leitura.</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {isCofaceDataDrawerOpen ?(
            <div className="fixed inset-0 z-40 flex justify-end bg-[#0D1B2A]/45" onClick={() => setIsCofaceDataDrawerOpen(false)}>
              <div className="flex h-full w-full max-w-[560px] flex-col bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
                <div className="flex items-start justify-between border-b border-[#EEF3F8] px-6 py-5">
                  <div>
                    <p className="text-[15px] font-semibold text-[#102033]">Dados importados do relatÃ³rio COFACE</p>
                    <p className="text-[12px] text-[#4F647A]">Somente os dados estruturados utilizados pelo motor de crÃ©dito.</p>
                  </div>
                  <button type="button" onClick={() => setIsCofaceDataDrawerOpen(false)} className="flex h-7 w-7 items-center justify-center rounded-full border border-[#D7E1EC] bg-[#F7F9FC] text-[#4F647A]">
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto px-6 py-5">
                  <div className="mb-6">
                    <p className="mb-3 border-b border-[#EEF3F8] pb-1.5 text-[10px] font-semibold uppercase tracking-[0.7px] text-[#295B9A]">IdentificaÃ§Ã£o</p>
                    <div className="space-y-1 text-[12px] text-[#4F647A]">
                      <p><span className="font-medium text-[#102033]">Empresa:</span> {cofaceImport.cofaceReadPayload?.company?.name || "NÃ£o informado"}</p>
                      <p><span className="font-medium text-[#102033]">CNPJ:</span> {formatCnpjForDisplay(cofaceImport.cofaceReadPayload?.company?.document)}</p>
                      <p><span className="font-medium text-[#102033]">EasyNumber:</span> {cofaceImport.cofaceReadPayload?.coface?.easy_number || "NÃ£o informado"}</p>
                      <p><span className="font-medium text-[#102033]">EndereÃ§o:</span> {cofaceImport.cofaceReadPayload?.company?.address || "NÃ£o informado"}</p>
                    </div>
                  </div>

                  <div className="mb-6">
                    <p className="mb-3 border-b border-[#EEF3F8] pb-1.5 text-[10px] font-semibold uppercase tracking-[0.7px] text-[#295B9A]">Indicadores COFACE</p>
                    <div className="space-y-1 text-[12px] text-[#4F647A]">
                      <p><span className="font-medium text-[#102033]">CRA:</span> {cofaceImport.cofaceReadPayload?.coface?.cra || "NÃ£o informado"}</p>
                      <p><span className="font-medium text-[#102033]">DRA:</span> {cofaceImport.cofaceReadPayload?.coface?.dra ?? "NÃ£o informado"}</p>
                      <p><span className="font-medium text-[#102033]">NotaÃ§Ã£o:</span> {cofaceImport.cofaceReadPayload?.coface?.notation || "NÃ£o informado"}</p>
                    </div>
                  </div>

                  <div className="mb-6">
                    <p className="mb-3 border-b border-[#EEF3F8] pb-1.5 text-[10px] font-semibold uppercase tracking-[0.7px] text-[#295B9A]">DecisÃ£o de crÃ©dito</p>
                    <div className="space-y-1 text-[12px] text-[#4F647A]">
                      <p><span className="font-medium text-[#102033]">Estado:</span> {cofaceImport.cofaceReadPayload?.coface?.decision_status || "NÃ£o informado"}</p>
                      <p><span className="font-medium text-[#102033]">Valor Segurado:</span> {cofaceImport.cofaceReadPayload?.coface?.decision_amount != null ?`R$ ${cofaceImport.cofaceReadPayload.coface.decision_amount.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "NÃ£o informado"}</p>
                      <p><span className="font-medium text-[#102033]">Data efetiva:</span> {formatIsoDateToBr(cofaceImport.cofaceReadPayload?.coface?.decision_effective_date)}</p>
                    </div>
                  </div>

                  <div>
                    <p className="mb-3 border-b border-[#EEF3F8] pb-1.5 text-[10px] font-semibold uppercase tracking-[0.7px] text-[#295B9A]">Qualidade da leitura</p>
                    <div className="space-y-1 text-[12px] text-[#4F647A]">
                      <p><span className="font-medium text-[#102033]">ConfianÃ§a:</span> {confidenceLabel(cofaceImport.cofaceReadPayload?.read_quality?.confidence)}</p>
                      {(cofaceImport.cofaceWarnings ?? []).length > 0 ?(
                        <div className="mt-2 rounded-[10px] border border-[#F3D7A1] bg-[#FFF7E8] p-3">
                          <p className="text-[12px] font-semibold text-[#92400E]">Alertas de leitura</p>
                          <ul className="mt-2 list-disc space-y-1 pl-4 text-[11px] text-[#7C5A1D]">
                            {(cofaceImport.cofaceWarnings ?? []).map((warning) => (
                              <li key={warning}>{warning}</li>
                            ))}
                          </ul>
                        </div>
                      ) : (
                        <p>Nenhum alerta identificado na leitura.</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {isManualDrawerOpen ?(
            <div className="fixed inset-0 z-40 flex justify-end bg-[#0D1B2A]/45" onClick={() => setIsManualDrawerOpen(false)}>
              <div className="flex h-full w-full max-w-[560px] flex-col bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
                <div className="flex items-start justify-between border-b border-[#EEF3F8] px-6 py-5">
                  <div>
                    <p className="text-[15px] font-semibold text-[#102033]">Preenchimento manual</p>
                    <p className="text-[12px] text-[#4F647A]">Informe os dados estruturados para anÃ¡lise de crÃ©dito</p>
                  </div>
                  <button type="button" onClick={() => setIsManualDrawerOpen(false)} className="flex h-7 w-7 items-center justify-center rounded-full border border-[#D7E1EC] bg-[#F7F9FC] text-[#4F647A]">
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto px-6 py-5">
                  <div className="mb-6">
                    <p className="mb-3 border-b border-[#EEF3F8] pb-1.5 text-[10px] font-semibold uppercase tracking-[0.7px] text-[#295B9A]">Scores e referÃªncias externas</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="text-[11px] font-medium text-[#4F647A]">
                        Fonte do score
                        <select
                          value={manualPanel.scoreSource}
                          onChange={(event) => setManualPanel((prev) => ({ ...prev, scoreSource: event.target.value }))}
                          className="mt-1 h-9 w-full rounded-[8px] border border-[#D7E1EC] px-3 text-[12px]"
                        >
                          <option value="Agrisk" disabled={hasAgriskImported}>
                            {hasAgriskImported ?"Agrisk  indisponÃ­vel (jÃ¡ importado)" : "Agrisk"}
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
                      {hasCofaceImported ?<span className="mt-1 block text-[10px] text-[#8FA3B4]">DRA COFACE jÃ¡ informado por relatÃ³rio importado.</span> : null}
                    </div>
                  </div>

                  <div className="mb-6">
                    <p className="mb-3 border-b border-[#EEF3F8] pb-1.5 text-[10px] font-semibold uppercase tracking-[0.7px] text-[#295B9A]">Dados comerciais internos</p>
                    <p className="mb-3 text-[11px] text-[#8FA3B4]">
                      Faturamento interno Ãºltimos 12 meses = total vendido ao cliente nos Ãºltimos 12 meses. Valor em aberto = total atualmente em aberto com o cliente.
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="text-[11px] font-medium text-[#4F647A]">
                        <span className="mb-1 block min-h-[2.5rem]">Faturamento interno Ãºltimos 12 meses (R$)</span>
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
                    <p className="mb-3 border-b border-[#EEF3F8] pb-1.5 text-[10px] font-semibold uppercase tracking-[0.7px] text-[#295B9A]">ObservaÃ§Ãµes</p>
                    <label className="text-[11px] font-medium text-[#4F647A]">
                      ConsideraÃ§Ãµes do analista <span className="ml-1 font-normal text-[#8FA3B4]">(opcional)</span>
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

      {step === 3 ?(
        <article className="space-y-3 rounded-[10px] border border-[#e2e5eb] bg-white p-4">
          <p className="text-[13px] font-medium text-[#111827]">Dados da solicitaÃ§Ã£o</p>
          <p className="text-[12px] text-[#6b7280]">Informe os dados principais da solicitaÃ§Ã£o de crÃ©dito antes de avanÃ§ar.</p>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <label className="text-[11px] text-[#374151]">Limite solicitado<RequiredMark /><input value={analysis.requestedLimit} onChange={(event) => setAnalysis((prev) => ({ ...prev, requestedLimit: formatCurrencyInputBRL(event.target.value) }))} className="mt-1 h-9 w-full rounded-[6px] border px-3 text-[12px]" /></label>
            <label className="text-[11px] text-[#374151]">Limite atual<input value={analysis.currentLimit} onChange={(event) => setAnalysis((prev) => ({ ...prev, currentLimit: formatCurrencyInputBRL(event.target.value) }))} className="mt-1 h-9 w-full rounded-[6px] border px-3 text-[12px]" /></label>
            <label className="text-[11px] text-[#374151]">Limite utilizado<input value={analysis.usedLimit} onChange={(event) => setAnalysis((prev) => ({ ...prev, usedLimit: formatCurrencyInputBRL(event.target.value) }))} className="mt-1 h-9 w-full rounded-[6px] border px-3 text-[12px]" /></label>
            <label className="text-[11px] text-[#374151]">
              Limite com garantia
              <input
                value={analysis.guaranteeLimit}
                onChange={(event) => setAnalysis((prev) => ({ ...prev, guaranteeLimit: formatCurrencyInputBRL(event.target.value) }))}
                disabled={hasCofaceCoverageImported}
                className="mt-1 h-9 w-full rounded-[6px] border px-3 text-[12px] disabled:cursor-not-allowed disabled:bg-[#f9fafb] disabled:text-[#6b7280]"
              />
              <span className="mt-1 block text-[10px] text-[#6b7280]">
                {hasCofaceCoverageImported
                  ?"Valor preenchido automaticamente a partir do relatÃ³rio COFACE (Valor de cobertura)."
                  : "Valor garantido por seguro ou garantia real."}
              </span>
              {hasCofaceCoverageImported ?(
                <span className="mt-1 inline-flex rounded-full border border-[#CFE0F4] bg-[#EEF3F8] px-2 py-0.5 text-[10px] font-medium text-[#295B9A]">
                  Origem: COFACE
                </span>
              ) : null}
            </label>
            <label className="text-[11px] text-[#374151]">Limite total<input value={totalLimitDisplay} readOnly className="mt-1 h-9 w-full rounded-[6px] border bg-[#f9fafb] px-3 text-[12px] text-[#6b7280]" /></label>
            <label className="text-[11px] text-[#374151]">
              ExposiÃ§Ã£o
              <input
                value={exposureDisplay}
                readOnly
                className={`mt-1 h-9 w-full rounded-[6px] border px-3 text-[12px] ${
                  hasPositiveExposure
                    ?"border-[#E7DDC3] bg-[#FFFCF3] text-[#6B5B2A]"
                    : "bg-[#f9fafb] text-[#6b7280]"
                }`}
              />
            </label>
            <label className="text-[11px] text-[#374151]">Analista responsÃ¡vel
              <input value={analysis.assignedAnalystName} readOnly className="mt-1 h-9 w-full rounded-[6px] border bg-[#f9fafb] px-3 text-[12px] text-[#6b7280]" />
            </label>
            <label className="text-[11px] text-[#374151] md:col-span-2 xl:col-span-3">ComentÃ¡rio
              <textarea value={analysis.comment} onChange={(event) => setAnalysis((prev) => ({ ...prev, comment: event.target.value }))} className="mt-1 min-h-16 w-full rounded-[6px] border px-3 py-2 text-[12px]" />
            </label>
          </div>
        </article>
      ) : null}

      {step === 4 ?(
        <div className="bg-[#F7F9FC] px-7 py-6">
          <div className="mb-5">
            <p className="text-[16px] font-semibold text-[#102033]">RevisÃ£o e envio para anÃ¡lise</p>
            <p className="mt-1 text-[12px] leading-relaxed text-[#4F647A]">
              Confira os dados do cliente, os limites vigentes, o valor solicitado e as fontes de informaÃ§Ã£o antes de acionar o motor de crÃ©dito.
            </p>
          </div>

          <div className="mb-5 flex items-center rounded-[12px] border border-[#D7E1EC] bg-white px-6 py-4">
            {["IdentificaÃ§Ã£o", "InformaÃ§Ãµes para anÃ¡lise", "Dados da solicitaÃ§Ã£o", "RevisÃ£o e envio"].map((label, index) => {
              const isDone = index < 3;
              const isActive = index === 3;
              return (
                <div key={label} className="flex flex-1 items-center">
                  <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold ${isDone ?"bg-[#295B9A] text-white" : isActive ?"bg-[#0D1B2A] text-white" : "bg-[#EEF3F8] text-[#8FA3B4]"}`}>
                    {isDone ?<Check className="h-3.5 w-3.5" /> : index + 1}
                  </span>
                  <span className={`ml-2 text-[11px] font-medium ${isDone ?"text-[#295B9A]" : isActive ?"text-[#102033]" : "text-[#8FA3B4]"}`}>{label}</span>
                  {index !== 3 ?<div className={`mx-3 h-px flex-1 ${isDone ?"bg-[#295B9A]" : "bg-[#D7E1EC]"}`} /> : null}
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
            <div className="space-y-4">
              <article className="rounded-[14px] border border-[#D7E1EC] bg-white p-5">
                <div className="mb-4 flex items-center justify-between">
                  <p className="text-[12px] font-semibold text-[#102033]">Dados do cliente</p>
                  <span className="rounded-[5px] border border-[#B5D4F4] bg-[#EEF3F8] px-2 py-0.5 text-[10px] font-medium text-[#295B9A]">Cadastro verificado</span>
                </div>
                <div className="grid grid-cols-1 gap-3 text-[12px] sm:grid-cols-2">
                  <div className="sm:col-span-2"><p className="text-[10px] uppercase text-[#8FA3B4]">RazÃ£o social</p><p className="text-[13px] font-medium text-[#102033]">{customer.companyName || "NÃ£o informado"}</p></div>
                  <div><p className="text-[10px] uppercase text-[#8FA3B4]">CNPJ</p><p className="text-[13px] font-medium text-[#102033]">{customer.cnpj || "NÃ£o informado"}</p></div>
                  <div><p className="text-[10px] uppercase text-[#8FA3B4]">Telefone</p><p className="text-[13px] font-medium text-[#102033]">{customer.phone || "NÃ£o informado"}</p></div>
                  <div className="sm:col-span-2"><p className="text-[10px] uppercase text-[#8FA3B4]">EndereÃ§o</p><p className="text-[13px] text-[#4F647A]">{customer.address || "NÃ£o informado"}</p></div>
                  <div><p className="text-[10px] uppercase text-[#8FA3B4]">E-mail</p><p className="text-[13px] text-[#4F647A]">{customer.email || "NÃ£o informado"}</p></div>
                  <div><p className="text-[10px] uppercase text-[#8FA3B4]">Analista responsÃ¡vel</p><p className="text-[13px] font-medium text-[#102033]">{analysis.assignedAnalystName || "NÃ£o informado"}</p></div>
                </div>
              </article>

              <article className="rounded-[14px] border border-[#D7E1EC] bg-white p-5">
                <p className="mb-4 text-[12px] font-semibold text-[#102033]">PosiÃ§Ã£o de limites e solicitaÃ§Ã£o</p>
                <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div className="rounded-[10px] border border-[#0D1B2A] bg-[#0D1B2A] px-4 py-3">
                    <p className="text-[10px] uppercase text-[rgba(255,255,255,0.45)]">Valor solicitado</p>
                    <p className="mt-1 text-[16px] font-semibold text-[#75D4EE]">{formatCurrencyBRL(analysis.requestedLimit)}</p>
                    <p className="mt-1 text-[10px] text-[rgba(255,255,255,0.35)]">Aguarda aprovaÃ§Ã£o</p>
                  </div>
                  <div className="rounded-[10px] border border-[#D7E1EC] bg-[#F7F9FC] px-4 py-3"><p className="text-[10px] uppercase text-[#8FA3B4]">Limite atual</p><p className="mt-1 text-[16px] font-semibold text-[#102033]">{formatCurrencyBRL(analysis.currentLimit)}</p></div>
                  <div className="rounded-[10px] border border-[#D7E1EC] bg-[#F7F9FC] px-4 py-3"><p className="text-[10px] uppercase text-[#8FA3B4]">Limite utilizado</p><p className="mt-1 text-[16px] font-semibold text-[#102033]">{formatCurrencyBRL(analysis.usedLimit)}</p></div>
                </div>
                <div className="rounded-[10px] border border-[#D7E1EC] bg-[#F7F9FC] px-4 py-3">
                  <div className="mb-3 flex items-center gap-2"><p className="text-[10px] font-semibold uppercase tracking-[0.6px] text-[#8FA3B4]">Estrutura com garantia (COFACE)</p><div className="h-px flex-1 bg-[#D7E1EC]" /></div>
                  <div className="grid grid-cols-1 gap-3 text-[12px] sm:grid-cols-2 lg:grid-cols-4">
                    <div><p className="text-[10px] uppercase text-[#8FA3B4]">Limite com garantia</p><p className="mt-1 text-[14px] font-semibold text-[#1A7A3A]">{guaranteeDisplayText}</p></div>
                    <div><p className="text-[10px] uppercase text-[#8FA3B4]">Origem da garantia</p><p className="mt-1 text-[13px] font-medium text-[#102033]">{guaranteeOriginText}</p></div>
                    <div><p className="text-[10px] uppercase text-[#8FA3B4]">Limite total</p><p className="mt-1 text-[14px] font-semibold text-[#295B9A]">{totalLimitDisplay}</p></div>
                    <div><p className="text-[10px] uppercase text-[#8FA3B4]">ExposiÃ§Ã£o atual</p><p className={`mt-1 text-[14px] font-semibold ${hasPositiveExposure ?"text-[#92580A]" : "text-[#102033]"}`}>{exposureDisplay}</p></div>
                  </div>
                </div>
              </article>

              <article className="rounded-[14px] border border-[#D7E1EC] bg-white p-5">
                <div className="mb-4 flex items-center justify-between">
                  <p className="text-[12px] font-semibold text-[#102033]">Fontes de informaÃ§Ã£o consolidadas</p>
                  <p className="text-[11px] text-[#8FA3B4]">{consolidatedSourcesSentCount} de {consolidatedSources.length} enviadas</p>
                </div>
                <div className="space-y-2">
                  {consolidatedSources.map((source) => (
                    <div key={source.key} className={`flex items-center gap-3 rounded-[10px] border px-3 py-2.5 ${source.isSent ?"border-[#A7DDB8] bg-[#F0FBF5]" : "border-[#D7E1EC] bg-[#F7F9FC] opacity-75"}`}>
                      <span className={`h-2 w-2 rounded-full ${source.isSent ?"bg-[#1EBD6A]" : "bg-[#C4CDD6]"}`} />
                      <div className="min-w-0 flex-1"><p className={`text-[12px] font-medium ${source.isSent ?"text-[#102033]" : "text-[#8FA3B4]"}`}>{source.name}</p><p className={`truncate text-[11px] ${source.isSent ?"text-[#4F647A]" : "text-[#C4CDD6]"}`}>{source.detail}</p></div>
                      <span className={`rounded-[5px] border px-2 py-0.5 text-[10px] font-medium ${source.isSent ?"border-[#A7DDB8] bg-[#E6F4ED] text-[#1A7A3A]" : "border-[#D7E1EC] bg-[#F7F9FC] text-[#4F647A]"}`}>{source.isSent ?"Enviado" : "NÃ£o selecionado"}</span>
                    </div>
                  ))}
                </div>
              </article>
            </div>

            <aside className="space-y-4">
              <article className="rounded-[14px] border border-[#D7E1EC] bg-white p-5">
                <p className="mb-3 text-[12px] font-semibold text-[#102033]">Analista responsÃ¡vel</p>
                <div className="mb-3 flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#295B9A] text-[12px] font-semibold text-white">{toInitials(analysis.assignedAnalystName || "Backoffice")}</div><div><p className="text-[13px] font-medium text-[#102033]">{analysis.assignedAnalystName || "Backoffice"}</p><p className="text-[11px] text-[#8FA3B4]">Cadastro e consolidaÃ§Ã£o</p></div></div>
                <p className="mb-1 text-[10px] uppercase tracking-[0.5px] text-[#8FA3B4]">ComentÃ¡rio</p>
                <div className="min-h-[64px] rounded-[8px] border border-[#D7E1EC] bg-[#F7F9FC] px-3 py-2 text-[12px] italic text-[#8FA3B4]">{analysis.comment.trim() || "Sem comentÃ¡rio registrado para esta anÃ¡lise."}</div>
              </article>

              <article className="rounded-[14px] border border-[#D7E1EC] bg-white p-5">
                <p className="mb-3 text-[12px] font-semibold text-[#102033]">PrÃ©-validaÃ§Ã£o</p>
                <div className="space-y-2.5 text-[12px]">
                  <p className={customerReady ?"text-[#102033]" : "text-[#92580A]"}>{customerReady ?"âœ“ " : "! "}Cliente identificado e vinculado</p>
                  <p className={requestedLimitReady ?"text-[#102033]" : "text-[#92580A]"}>{requestedLimitReady ?"âœ“ " : "! "}Valor solicitado informado</p>
                  <p className={consolidatedSourcesSentCount > 0 ?"text-[#102033]" : "text-[#92580A]"}>{consolidatedSourcesSentCount > 0 ?"âœ“ " : "! "}Ao menos 1 fonte enviada</p>
                  <p className={manualStatus === "preenchido" ?"text-[#102033]" : "text-[#92580A]"}>{manualStatus === "preenchido" ?"âœ“ Dados manuais preenchidos" : "! Dados manuais nÃ£o preenchidos"}</p>
                  <p className="text-[#4F647A]">{ocr.files.length > 0 ?"âœ“ OCR demonstrativos - opcional" : "- OCR demonstrativos - opcional"}</p>
                </div>
              </article>

              <article className={`rounded-[14px] border p-5 ${submitBlockingError ?"border-[#F5D06A] bg-[#FEF9EC]" : "border-[#B5D4F4] bg-[#EEF3F8]"}`}>
                <p className={`text-[12px] font-semibold ${submitBlockingError ?"text-[#92580A]" : "text-[#0C447C]"}`}>{submitBlockingError ?"PendÃªncias para acionar o motor" : "Pronto para acionar o motor"}</p>
                <p className={`mt-1 text-[11px] leading-relaxed ${submitBlockingError ?"text-[#92580A]" : "text-[#185FA5]"}`}>
                  {submitBlockingError
                    ?`Revise este ponto antes de enviar: ${submitBlockingError}`
                    : 'As informaÃ§Ãµes mÃ­nimas foram consolidadas. Clique em "Enviar para anÃ¡lise" para acionar o motor de crÃ©dito.'}
                </p>
              </article>
            </aside>
          </div>
          {submitMutation.isError ?<p className="mt-3 text-[12px] text-[#b91c1c]">{submitMutation.error.message}</p> : null}
        </div>
      ) : null}

      {step === 2 ?(
        <div className="flex items-center justify-between rounded-[12px] border border-[#D7E1EC] bg-white px-6 py-4">
          <div className="flex items-center gap-2 text-[11px] text-[#8FA3B4]">
            <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full border border-[#8FA3B4]">i</span>
            {hasInvalidAgriskImport
              ?"RelatÃ³rio AgRisk invÃ¡lido: esse insumo nÃ£o serÃ¡ usado atÃ© o envio de um arquivo vÃ¡lido."
              : "Selecione ao menos uma fonte de dados para AvanÃ§ar"}
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
              AvanÃ§ar Â· Dados da solicitaÃ§Ã£o <ChevronRight className="ml-1 h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ) : step === 4 ?(
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-[#D7E1EC] bg-white px-7 py-4">
          <div className="flex items-center gap-2 text-[11px] text-[#8FA3B4]">
            <span className="flex h-4 w-4 items-center justify-center rounded-full border border-[#8FA3B4] text-[9px]">i</span>
            Ao enviar, o motor de crÃ©dito serÃ¡ acionado automaticamente com as informaÃ§Ãµes consolidadas.
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setStep(3)} className="rounded-[8px] border border-[#D7E1EC] bg-white px-5 py-2 text-[12px] font-medium text-[#4F647A]">
              <ChevronLeft className="mr-1 inline h-3.5 w-3.5" />
              Voltar
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmitJourney}
              className="rounded-[8px] bg-[#1EBD6A] px-6 py-2 text-[12px] font-medium text-white disabled:cursor-not-allowed disabled:bg-[#D7E1EC] disabled:text-[#8FA3B4]"
            >
              {submitMutation.isPending ?"Enviando..." : "Enviar para anÃ¡lise"}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between rounded-[10px] border border-[#e2e5eb] bg-white p-3">
          <button type="button" onClick={() => setStep((prev) => Math.max(1, prev - 1))} disabled={step === 1} className="rounded-[6px] border border-[#d1d5db] px-3 py-2 text-[12px] text-[#374151] disabled:opacity-50">
            Voltar
          </button>
          {step < 4 ?(
            <button type="button" onClick={() => navigateToStep(Math.min(4, step + 1))} disabled={!canContinue} className="rounded-[6px] bg-[#1a2b5e] px-3 py-2 text-[12px] font-medium text-white disabled:opacity-50">
              AvanÃ§ar
            </button>
          ) : (
            <button type="button" onClick={submit} disabled={submitMutation.isPending} className="rounded-[6px] bg-[#059669] px-3 py-2 text-[12px] font-medium text-white disabled:opacity-50">
              {submitMutation.isPending ?"Enviando..." : "Enviar para anÃ¡lise"}
            </button>
          )}
        </div>
      )}
      {triageModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0D1B2A]/55 p-4">
          <div className="w-full max-w-[840px] rounded-[20px] border border-[#D7E1EC] bg-white p-7 shadow-[0_22px_60px_rgba(2,6,23,0.28)]">
            <div className="mb-5">
              <p className="text-[22px] font-semibold text-[#102033]">Nova solicitaÃ§Ã£o de crÃ©dito</p>
              <p className="text-[13px] text-[#4F647A]">Informe o CNPJ para localizar o cliente na carteira ou iniciar uma nova solicitaÃ§Ã£o.</p>
            </div>
            {!canCreateRequest ? <div className="mb-4 rounded-[8px] border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-[12px] text-[#B91C1C]">VocÃª nÃ£o possui permissÃ£o para criar solicitaÃ§Ãµes de crÃ©dito.</div> : null}
            <div className="mb-4 grid gap-3 md:grid-cols-[1fr_auto]">
              <input value={customer.cnpj} onChange={(event) => setCustomer((prev) => ({ ...prev, cnpj: formatCnpj(event.target.value) }))} onBlur={handleTriageLookup} className="h-11 rounded-[10px] border border-[#D7E1EC] px-3 text-[14px]" placeholder="CNPJ" />
              <button type="button" disabled={!canCreateRequest || triageLookupMutation.isPending} onClick={handleTriageLookup} className="rounded-[10px] bg-[#1E3A8A] px-5 text-[12px] font-medium text-white disabled:opacity-50">{triageLookupMutation.isPending ? "Consultando..." : "Consultar CNPJ"}</button>
            </div>
            {triageMessage ? <p className={`mb-4 text-[12px] ${triageState === "error" ? "text-[#B91C1C]" : "text-[#4F647A]"}`}>{triageMessage}</p> : null}
            {triageResult ? (
              <div className="mb-4 space-y-3">
                <div className="rounded-[12px] border border-[#D7E1EC] bg-[#F8FAFC] p-4 text-[12px] text-[#102033]">
                  <div className="mb-2 flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${triageResult.found_in_portfolio ? "bg-[#E6F4ED] text-[#166534]" : "bg-[#FFF7E8] text-[#92400E]"}`}>
                      {triageResult.found_in_portfolio ? "Cliente da carteira" : "Novo cliente"}
                    </span>
                    {!triageResult.found_in_portfolio ? <span className="text-[10px] text-[#92400E]">NÃ£o localizado na carteira</span> : null}
                  </div>
                  <p><strong>RazÃ£o Social:</strong> {triageResult.customer_data.company_name ?? "-"}</p>
                  <p><strong>CNPJ:</strong> {formatCnpj(triageResult.customer_data.cnpj)}</p>
                  <p><strong>Grupo EconÃ´mico:</strong> {triageResult.customer_data.economic_group ?? "-"}</p>
                  <p><strong>Unidade de NegÃ³cio / BU:</strong> {triageResult.customer_data.business_unit ?? "-"}</p>
                  <p><strong>Cidade/UF:</strong> {[triageResult.customer_data.city, triageResult.customer_data.uf].filter(Boolean).join("/") || "-"}</p>
                </div>
                {triageResult.found_in_portfolio ? (
                  <div className="rounded-[12px] border border-[#D7E1EC] bg-white p-4 text-[12px] text-[#102033]">
                    <p><strong>Valor em Aberto:</strong> {formatCurrencyBRL(String(triageResult.economic_position?.open_amount ?? 0))}</p>
                    <p><strong>Limite Total:</strong> {formatCurrencyBRL(String(triageResult.economic_position?.total_limit ?? 0))}</p>
                    <p><strong>Limite DisponÃ­vel:</strong> {formatCurrencyBRL(String(triageResult.economic_position?.available_limit ?? 0))}</p>
                    <p><strong>Ãšltimo limite aprovado:</strong> {triageResult.last_analysis?.approved_limit != null ? formatCurrencyBRL(String(triageResult.last_analysis.approved_limit)) : "-"}</p>
                    <p><strong>Data da Ãºltima anÃ¡lise:</strong> {triageResult.last_analysis?.date ? new Date(triageResult.last_analysis.date).toLocaleDateString("pt-BR") : "-"}</p>
                    <p><strong>Status da Ãºltima anÃ¡lise:</strong> {triageResult.last_analysis?.status ?? "-"}</p>
                  </div>
                ) : null}
                {triageResult.has_recent_analysis ? (
                  <div className="rounded-[12px] border border-[#F3D7A1] bg-[#FFF7E8] p-4 text-[12px] text-[#7C5A1D]">
                    <p className="font-semibold text-[#92400E]">AnÃ¡lise recente encontrada</p>
                    <p>Ãšltima anÃ¡lise realizada em: {triageResult.last_analysis?.date ? new Date(triageResult.last_analysis.date).toLocaleDateString("pt-BR") : "-"}</p>
                    <p>Status: {triageResult.last_analysis?.status ?? "-"}</p>
                    <p>Limite aprovado: {triageResult.last_analysis?.approved_limit != null ? formatCurrencyBRL(String(triageResult.last_analysis.approved_limit)) : "-"}</p>
                    <p>Analista responsÃ¡vel: {triageResult.last_analysis?.analyst_name ?? "-"}</p>
                    <p>Nova solicitaÃ§Ã£o padrÃ£o disponÃ­vel em: {triageResult.reanalysis_available_at ? new Date(triageResult.reanalysis_available_at).toLocaleDateString("pt-BR") : "-"}</p>
                  </div>
                ) : null}
              </div>
            ) : null}
            {(triageState === "found_existing_customer" || triageState === "new_customer_external_data" || triageState === "recent_analysis_found") ? (
              <div className="mb-4">
                {!triageResult?.found_in_portfolio && triageResult?.requires_business_unit_selection ? (
                  <label className="mb-3 block text-[12px] text-[#374151]">Unidade de NegÃƒÂ³cio / BU<RequiredMark />
                    <select
                      value={triageSelectedBusinessUnit}
                      onChange={(event) => setTriageSelectedBusinessUnit(event.target.value)}
                      className="mt-1 h-10 w-full rounded-[8px] border border-[#D7E1EC] px-3 text-[12px]"
                    >
                      <option value="">Selecione a BU</option>
                      {(triageResult?.available_business_units ?? []).map((option) => (
                        <option key={option.id} value={option.name}>{option.name}</option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {triageResult?.has_recent_analysis ? (
                  <div className="mb-3 rounded-[10px] border border-[#D7E1EC] bg-[#F8FAFC] p-3">
                    <p className="text-[12px] font-medium text-[#102033]">Solicitar revisÃ£o antecipada</p>
                    <p className="mb-2 text-[11px] text-[#4F647A]">Use esta opÃ§Ã£o apenas quando houver fato novo ou necessidade comercial relevante para antecipar a revisÃ£o do limite.</p>
                    <button type="button" onClick={() => setIsEarlyReviewRequest(true)} className="rounded-[8px] border border-[#1E3A8A] bg-white px-3 py-1.5 text-[11px] font-medium text-[#1E3A8A]">
                      Solicitar revisÃ£o antecipada
                    </button>
                    {isEarlyReviewRequest ? (
                      <label className="mt-3 block text-[12px] text-[#374151]">Justificativa da revisÃ£o antecipada<RequiredMark />
                        <textarea value={earlyReviewJustification} onChange={(event) => setEarlyReviewJustification(event.target.value)} rows={3} className="mt-1 w-full rounded-[8px] border border-[#D7E1EC] px-3 py-2 text-[12px]" />
                      </label>
                    ) : null}
                  </div>
                ) : null}
                <label className="text-[12px] text-[#374151]">Limite sugerido<RequiredMark />
                  <input value={triageSuggestedLimit} onChange={(event) => setTriageSuggestedLimit(formatCurrencyInputBRL(event.target.value))} className="mt-1 h-10 w-full rounded-[8px] border border-[#D7E1EC] px-3 text-[12px]" />
                </label>
              </div>
            ) : null}
            <div className="flex justify-end gap-2">
              <Link href="/analises" className="rounded-[8px] border border-[#D7E1EC] bg-white px-4 py-2 text-[12px] font-medium text-[#4F647A]">Cancelar</Link>
              <button type="button" disabled={!canCreateRequest || !(triageState === "found_existing_customer" || triageState === "new_customer_external_data" || triageState === "recent_analysis_found")} onClick={handleTriageSubmit} className="rounded-[8px] bg-[#1EBD6A] px-5 py-2 text-[12px] font-medium text-white disabled:opacity-50">
                {triageSubmitMutation.isPending ? "Enviando..." : "Submeter para anÃ¡lise"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}





