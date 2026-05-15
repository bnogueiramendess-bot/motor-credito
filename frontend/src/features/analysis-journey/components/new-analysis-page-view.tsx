"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Building2, Check, ChevronLeft, ChevronRight, CreditCard, Info, Lock, Search, Upload, X } from "lucide-react";

import { checkExistingCreditAnalysis, createCommercialReference, createCreditAnalysisDraft, deleteAnalysisDocument, deleteCommercialReference, getAnalysisRequestMetadata, listAnalysisDocuments, listCommercialReferences, lookupExternalCnpj, readAgriskReport, readCofaceReport, saveAnalysisRequestMetadata, submitAnalysisJourney, triageCreditRequest, uploadAnalysisDocument } from "@/features/analysis-journey/api/analysis-journey.api";
import { AgriskImportStatus, AgriskReportReadResponse, AnalysisDocumentDto, AnalysisJourneySubmitRequest, CofaceReportReadResponse, CommercialReference, CreditAnalysisExistingCheckResponse, CreditAnalysisTriageResponse, UploadFileMetadataInput } from "@/features/analysis-journey/api/contracts";
import { getCreditAnalysisDetail } from "@/features/credit-analyses/api/credit-analyses.api";
import { getExternalDataDashboard } from "@/features/external-data/api/external-data.api";
import {
  formatCnpj,
  formatCurrencyInputBRL,
  sanitizeDigits,
  toNullableNumberInput,
  toNumberInput
} from "@/features/analysis-journey/utils/formatters";
import { formatCurrencyBRL, resolveManualStatus, resolveUploadStatus } from "@/features/analysis-journey/utils/view-models";
import { ErrorState } from "@/shared/components/states/error-state";
import { getEffectivePermissions, hasPermission } from "@/shared/lib/auth/permissions";

const steps = ["Identificação do cliente", "Informações para análise", "Dados da solicitação", "Revisão e envio"];
type ImportSource = "agrisk" | "coface";
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

type Step1DocumentType =
  | "ficha_cadastral"
  | "contrato_social"
  | "ecd_ecf"
  | "autorizacao_bacen"
  | "outros_documentos"
  | "financial_statements_and_trial_balances";

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
  if (status === "valid") return "Válido";
  if (status === "valid_with_warnings") return "Válido com alertas";
  if (status === "invalid") return "Inválido";
  if (status === "success") return "Processado com sucesso";
  if (status === "error") return "Erro na leitura";
  return "Sem arquivo";
}

function isDocumentDivergenceMessage(message: string | null | undefined) {
  if (!message) return false;
  const normalized = message.toLowerCase();
  return normalized.includes("não corresponde") || normalized.includes("nao corresponde") || normalized.includes("outro cnpj");
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

function importMonitorTitle(_: ImportSource) {
  return "Relatório importado";
}

function importMonitorSourceName(source: ImportSource) {
  if (source === "agrisk") return "Origem: Agrisk";
  if (source === "coface") return "Origem: COFACE";
  return "Origem: Externa";
}

function importMonitorStatusText(source: ImportSource, status: ImportStatus) {
  if (status === "pending") return "Aguardando início da leitura";
  if (status === "processing") return "Aguardando processamento";
  if (status === "invalid") return "Relatório inválido para esta análise";
  if (status === "valid_with_warnings") return "Dados importados com alertas";
  if (status === "error") return "Requer novo envio";
  if (source === "coface") return "DRA e indicadores prontos para análise";
  return "Dados prontos para análise";
}

function scoreSourceLabel(value: string | null | undefined) {
  if (!value) return "Não informado";
  if (value === "agrisk_report_primary") return "AgRisk principal";
  if (value === "boa_vista") return "Boa Vista";
  if (value === "quod") return "Quod";
  return value;
}

function confidenceLabel(value: string | null | undefined) {
  if (!value) return "Não informado";
  if (value === "high") return "Alta";
  if (value === "medium") return "Média";
  if (value === "low") return "Baixa";
  return value;
}

function formatIsoDateToBr(value: string | null | undefined) {
  if (!value) return "Não informado";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return value;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function formatCnpjForDisplay(value: string | null | undefined) {
  const digits = sanitizeDigits(value ?? "");
  if (digits.length !== 14) return value || "Não informado";
  return formatCnpj(digits);
}

const agriskWarningLabelMap: Record<string, string> = {
  INFORMACOES_BASICAS: "Informações básicas",
  INFORMACOES_CADASTRAIS: "Informações cadastrais",
};

function formatAgriskWarning(warning: string) {
  const prefix = "Ancora critica ausente:";
  if (!warning.startsWith(prefix)) return warning;
  const rawCode = warning.slice(prefix.length).trim();
  const mapped = agriskWarningLabelMap[rawCode];
  if (mapped) return `Bloco esperado não encontrado: ${mapped}`;
  return `Bloco esperado não encontrado: ${rawCode.replaceAll("_", " ").toLowerCase()}`;
}

function importMonitorValueText(source: ImportSource) {
  if (source === "agrisk") return "Score, restrições e indicadores extraídos automaticamente.";
  if (source === "coface") return "DRA e indicadores corporativos extraídos automaticamente.";
  return "Dados estruturados para análise.";
}

function removeActionLabel(_: ImportSource) {
  return "Remover relatório";
}

const step1DocumentDefinitions: Array<{ key: Step1DocumentType; label: string }> = [
  { key: "ficha_cadastral", label: "Ficha Cadastral" },
  { key: "contrato_social", label: "Contrato Social / Última Alteração" },
  { key: "ecd_ecf", label: "ECD / ECF" },
  { key: "autorizacao_bacen", label: "Autorização consulta BACEN" },
  { key: "outros_documentos", label: "Outros documentos" },
  { key: "financial_statements_and_trial_balances", label: "Demonstrações Financeiras e Balancetes" }
];

type NewAnalysisPageViewProps = {
  mode?: "create" | "workspace";
  analysisId?: number;
};

export function NewAnalysisPageView({ mode = "create", analysisId }: NewAnalysisPageViewProps) {
  const router = useRouter();
  const isWorkspaceMode = mode === "workspace";
  const [draftAnalysisId, setDraftAnalysisId] = useState<number | null>(null);
  const [draftCnpj, setDraftCnpj] = useState<string | null>(null);
  const activeAnalysisId = analysisId ?? draftAnalysisId;
  const hasStep1Workspace = Number.isFinite(activeAnalysisId) && (activeAnalysisId ?? 0) > 0;
  const [step, setStep] = useState(1);
  const [stepError, setStepError] = useState<string | null>(null);
  const [existingCustomerId, setExistingCustomerId] = useState<number | null>(null);
  const [externalLookupMessage, setExternalLookupMessage] = useState<string | null>(null);

  const [customer, setCustomer] = useState({
    companyName: "",
    cnpj: ""
  });
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");

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
  const [triageModalOpen, setTriageModalOpen] = useState(!isWorkspaceMode);
  const [triageState, setTriageState] = useState<"idle" | "loading" | "found_existing_customer" | "new_customer_external_data" | "recent_analysis_found" | "error" | "submitting" | "submitted">("idle");
  const [triageMessage, setTriageMessage] = useState<string | null>(null);
  const [triageResult, setTriageResult] = useState<CreditAnalysisTriageResponse | null>(null);
  const [governanceStatus, setGovernanceStatus] = useState<CreditAnalysisExistingCheckResponse | null>(null);
  const [triageSelectedBusinessUnit, setTriageSelectedBusinessUnit] = useState("");
  const [canCreateRequest, setCanCreateRequest] = useState(false);
  const [isEarlyReviewRequest, setIsEarlyReviewRequest] = useState(false);
  const [earlyReviewJustification, setEarlyReviewJustification] = useState("");
  const [workspaceHydrated, setWorkspaceHydrated] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [requestTermDays, setRequestTermDays] = useState("");
  const [requestBusinessUnit, setRequestBusinessUnit] = useState("");
  const [requestCustomerType, setRequestCustomerType] = useState("");
  const [requestOperationModality, setRequestOperationModality] = useState("");
  const isRequestedLimitFocusedRef = useRef(false);
  const [commercialReferenceForm, setCommercialReferenceForm] = useState({
    name: "",
    phone: "",
    email: "",
    error: ""
  });
  const [documentUploadFeedback, setDocumentUploadFeedback] = useState<{ type: "error" | "success"; message: string } | null>(null);

  const workspaceDetailQuery = useQuery({
    queryKey: ["workspace-analysis-detail", analysisId],
    queryFn: () => getCreditAnalysisDetail(analysisId as number),
    enabled: isWorkspaceMode && Number.isFinite(analysisId) && (analysisId ?? 0) > 0
  });
  const workspaceExternalDataQuery = useQuery({
    queryKey: ["workspace-analysis-external-data", analysisId],
    queryFn: () => getExternalDataDashboard(analysisId as number),
    enabled: isWorkspaceMode && Number.isFinite(analysisId) && (analysisId ?? 0) > 0
  });
  const step1MetadataQuery = useQuery({
    queryKey: ["analysis-step1-metadata", activeAnalysisId],
    queryFn: () => getAnalysisRequestMetadata(activeAnalysisId as number),
    enabled: hasStep1Workspace
  });
  const step1DocumentsQuery = useQuery({
    queryKey: ["analysis-step1-documents", activeAnalysisId],
    queryFn: () => listAnalysisDocuments(activeAnalysisId as number),
    enabled: hasStep1Workspace
  });
  const commercialReferencesQuery = useQuery({
    queryKey: ["analysis-commercial-references", activeAnalysisId],
    queryFn: () => listCommercialReferences(activeAnalysisId as number),
    enabled: hasStep1Workspace
  });

  const normalizedCnpj = sanitizeDigits(customer.cnpj);

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
  const hasInternalDataAvailable = Boolean(triageResult?.found_in_portfolio || (isWorkspaceMode && triageSelectedBusinessUnit.trim().length > 0));
  const hasInternalFinancialData = Boolean(triageResult?.economic_position);
  const structuredSourcesCount = [hasAgriskImported, hasCofaceImported, hasInternalDataAvailable].filter(Boolean).length;
  const isManualBlocked = hasAgriskImported && hasCofaceImported && hasInternalDataAvailable;
  const hasStep2Source = manualConfigured || structuredSourcesCount > 0;
  const isStep2Ready = hasStep2Source;
  const internalOpenAmount = Number(triageResult?.economic_position?.open_amount ?? 0);
  const internalTotalLimit = Number(triageResult?.economic_position?.total_limit ?? toNumberInput(analysis.currentLimit));
  const internalAvailableLimit = Number(
    triageResult?.economic_position?.available_limit ?? Math.max(0, internalTotalLimit - internalOpenAmount)
  );
  const internalExposure = toNumberInput(analysis.requestedLimit) + toNumberInput(analysis.currentLimit) + toNumberInput(analysis.usedLimit);
  const internalOverdue = triageResult?.economic_position && internalOpenAmount > 0 ? internalOpenAmount : null;
  const internalNotDue =
    triageResult?.economic_position && internalTotalLimit > 0
      ? Math.max(0, internalTotalLimit - internalOpenAmount)
      : null;
  const internalOperationalStatus = workspaceDetailQuery.data?.analysis?.analysis_status ?? null;
  const internalBehaviorLabel = triageResult?.has_recent_analysis ? "cliente com histórico recente" : "histórico estável";
  const hasInternalFinancialSnapshot = hasInternalFinancialData;

  useEffect(() => {
    if (!hasAgriskImported) return;
    setManualPanel((prev) => (prev.scoreSource === "Agrisk" ?{ ...prev, scoreSource: "Serasa" } : prev));
  }, [hasAgriskImported]);

  useEffect(() => {
    if (!triageModalOpen) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [triageModalOpen]);

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
        setExternalLookupMessage(response.message ?? "Não foi possível consultar os dados externos no momento.");
        return;
      }

      setCustomer((prev) => ({
        ...prev,
        companyName: response.data?.razao_social || prev.companyName
      }));
      setContactPhone((prev) => prev || response.data?.telefone || "");
      setContactEmail((prev) => prev || response.data?.email || "");
      setExternalLookupMessage("Dados cadastrais localizados automaticamente. Você poderá revisar e editar na próxima etapa.");
    },
    onError: (error: Error) =>
      setExternalLookupMessage(
        error.message || "A consulta externa está indisponível no momento. Se necessário, informe os dados manualmente."
      )
  });

  useEffect(() => {
    const permissions = getEffectivePermissions();
    setCanCreateRequest(hasPermission("credit.request.create", permissions));
  }, []);

  useEffect(() => {
    if (!isWorkspaceMode) return;

    if (!Number.isFinite(analysisId) || (analysisId ?? 0) <= 0) {
      setWorkspaceError("ID da análise inválido para abrir o workspace.");
      return;
    }
    if (workspaceDetailQuery.isLoading || workspaceExternalDataQuery.isLoading) return;
    if (workspaceDetailQuery.isError) {
      setWorkspaceError(workspaceDetailQuery.error instanceof Error ? workspaceDetailQuery.error.message : "Falha ao carregar análise.");
      return;
    }
    if (workspaceExternalDataQuery.isError) {
      setWorkspaceError(workspaceExternalDataQuery.error instanceof Error ? workspaceExternalDataQuery.error.message : "Falha ao carregar relatórios importados.");
      return;
    }
    if (!workspaceDetailQuery.data || !workspaceExternalDataQuery.data) return;

    const detail = workspaceDetailQuery.data;
    const external = workspaceExternalDataQuery.data;
    const analysisRecord = detail.analysis;
    const customerRecord = detail.customer;
    const triageSubmission =
      analysisRecord.decision_memory_json &&
      typeof analysisRecord.decision_memory_json === "object" &&
      analysisRecord.decision_memory_json.triage_submission &&
      typeof analysisRecord.decision_memory_json.triage_submission === "object"
        ? (analysisRecord.decision_memory_json.triage_submission as Record<string, unknown>)
        : null;
    const buName = typeof triageSubmission?.business_unit === "string" ? triageSubmission.business_unit : "";

    if (!analysisRecord?.id || !analysisRecord?.customer_id || !customerRecord?.id || !customerRecord?.document_number || !customerRecord?.company_name || !buName) {
      setWorkspaceError("Não foi possível abrir o workspace: dados obrigatórios da análise estão incompletos.");
      return;
    }

    const toCurrency = (value: number | string | null | undefined) => formatCurrencyBRL(String(value ?? 0));
    const entries = external.entries ?? [];
    const byNewest = [...entries].sort((a, b) => (new Date(b.created_at).getTime() || 0) - (new Date(a.created_at).getTime() || 0));
    const agriskEntry = byNewest.find((entry) => entry.source_type === "agrisk");
    const cofaceEntry = byNewest.find((entry) => /coface/i.test(entry.notes ?? ""));

    const mapImportedFiles = (entry: typeof entries[number] | undefined): UploadFileMetadataInput[] =>
      (entry?.files ?? []).map((file) => ({
        original_filename: file.original_filename,
        mime_type: file.mime_type,
        file_size: file.file_size
      }));
    const parseReadId = (notes: string | null | undefined, marker: string) => {
      if (!notes) return null;
      const match = new RegExp(`${marker}:\\s*(\\d+)`, "i").exec(notes);
      return match ? Number(match[1]) : null;
    };

    setExistingCustomerId(customerRecord.id);
    setTriageSelectedBusinessUnit(buName);
    setCustomer((prev) => ({
      ...prev,
      companyName: customerRecord.company_name,
      cnpj: formatCnpj(customerRecord.document_number),
    }));
    setAnalysis((prev) => ({
      ...prev,
      requestedLimit: toCurrency(analysisRecord.requested_limit),
      currentLimit: toCurrency(analysisRecord.current_limit),
      usedLimit: "R$ 0,00",
      guaranteeLimit: "R$ 0,00",
      assignedAnalystName: analysisRecord.assigned_analyst_name ?? prev.assignedAnalystName,
      comment: analysisRecord.analyst_notes ?? prev.comment,
    }));
    setAnalysis((prev) => ({
      ...prev,
      requestedLimit: toCurrency(analysisRecord.suggested_limit)
    }));
    setManualPanel((prev) => ({
      ...prev,
      scoreValue: detail.score?.final_score ?? prev.scoreValue,
      analystNotes: analysisRecord.analyst_notes ?? prev.analystNotes
    }));
    setAgriskImport((prev) => ({
      ...prev,
      files: mapImportedFiles(agriskEntry),
      status: agriskEntry ?"valid" : "empty",
      importedAt: agriskEntry?.created_at ?? null,
      agriskReadId: parseReadId(agriskEntry?.notes, "Leitura AgRisk ID"),
    }));
    setCofaceImport((prev) => ({
      ...prev,
      files: mapImportedFiles(cofaceEntry),
      status: cofaceEntry ?"valid" : "empty",
      importedAt: cofaceEntry?.created_at ?? null,
      cofaceReadId: parseReadId(cofaceEntry?.notes, "Leitura COFACE ID"),
    }));
    setTriageModalOpen(false);
    setStep(2);
    setWorkspaceError(null);
    setWorkspaceHydrated(true);
  }, [
    analysisId,
    isWorkspaceMode,
    workspaceDetailQuery.data,
    workspaceDetailQuery.error,
    workspaceDetailQuery.isError,
    workspaceDetailQuery.isLoading,
    workspaceExternalDataQuery.data,
    workspaceExternalDataQuery.error,
    workspaceExternalDataQuery.isError,
    workspaceExternalDataQuery.isLoading
  ]);

  const triageLookupMutation = useMutation({
    mutationFn: (cnpj: string) => triageCreditRequest({ cnpj }),
    onMutate: () => {
      setTriageState("loading");
      setTriageMessage(null);
    },
    onSuccess: async (response) => {
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
        companyName: response.customer_data.company_name ?? prev.companyName
      }));
      if (response.economic_position) {
        setAnalysis((prev) => ({
          ...prev,
          currentLimit: formatCurrencyInputBRL(String(response.economic_position?.total_limit ?? 0)),
          usedLimit: formatCurrencyInputBRL(String(response.economic_position?.open_amount ?? 0))
        }));
      }
      try {
        const existing = await checkExistingCreditAnalysis(response.customer_data.cnpj);
        setGovernanceStatus(existing);
        const isBlocked = existing.state === "in_progress" || existing.state === "recently_completed";
        if (isBlocked) {
          setTriageModalOpen(false);
          return;
        }
      } catch {
        setGovernanceStatus(null);
      }
      const responseCnpj = sanitizeDigits(response.customer_data.cnpj);
      if (!activeAnalysisId || (draftCnpj !== responseCnpj && !isWorkspaceMode)) {
        setTriageMessage("Preparando solicitação...");
        try {
          await createDraftMutation.mutateAsync(response);
        } catch {
          setTriageState("error");
          setTriageMessage("Não foi possível iniciar a solicitação. Tente novamente.");
          return;
        }
      }
      setTriageModalOpen(false);
    },
    onError: (error) => {
      setTriageState("error");
      setTriageMessage(error instanceof Error ? error.message : "Falha ao consultar CNPJ.");
    }
  });
  const createDraftMutation = useMutation({
    mutationFn: (response: CreditAnalysisTriageResponse) =>
      createCreditAnalysisDraft({
        cnpj: response.customer_data.cnpj,
        customer_name: response.customer_data.company_name ?? null,
        economic_group: response.customer_data.economic_group ?? null,
        business_unit: (response.customer_data.business_unit ?? triageSelectedBusinessUnit) || null,
        source: response.found_in_portfolio ? "portfolio" : "external"
      }),
    onSuccess: (draft) => {
      setDraftAnalysisId(draft.analysis_id);
      setDraftCnpj(draft.cnpj);
      setExistingCustomerId(draft.customer_id);
    }
  });
  const saveStep1MetadataMutation = useMutation({
    mutationFn: (payload: { requested_limit: number | null; requested_term_days: number | null; business_unit: string | null; customer_type: string | null; operation_modality: string | null; contact_name: string | null; contact_phone: string | null; contact_email: string | null }) =>
      saveAnalysisRequestMetadata(activeAnalysisId as number, payload),
    onSuccess: () => {
      step1MetadataQuery.refetch();
    }
  });
  const uploadStep1DocumentMutation = useMutation({
    mutationFn: (payload: { documentType: Step1DocumentType; file: File }) => uploadAnalysisDocument(activeAnalysisId as number, payload.documentType, payload.file),
    onSuccess: async () => {
      await step1DocumentsQuery.refetch();
      setDocumentUploadFeedback({ type: "success", message: "Arquivo enviado com sucesso." });
    },
    onError: () => {
      setDocumentUploadFeedback({ type: "error", message: "Não foi possível enviar o arquivo. Tente novamente." });
    }
  });
  const deleteStep1DocumentMutation = useMutation({
    mutationFn: (documentId: number) => deleteAnalysisDocument(activeAnalysisId as number, documentId),
    onSuccess: async () => {
      await step1DocumentsQuery.refetch();
    },
    onError: () => {
      setDocumentUploadFeedback({ type: "error", message: "Não foi possível remover o arquivo. Tente novamente." });
    }
  });
  const createCommercialReferenceMutation = useMutation({
    mutationFn: (payload: { name: string; phone: string | null; email: string | null }) =>
      createCommercialReference(activeAnalysisId as number, payload),
    onSuccess: () => {
      commercialReferencesQuery.refetch();
    }
  });
  const deleteCommercialReferenceMutation = useMutation({
    mutationFn: (referenceId: number) => deleteCommercialReference(activeAnalysisId as number, referenceId),
    onSuccess: () => {
      commercialReferencesQuery.refetch();
    }
  });

  useEffect(() => {
    if (!step1MetadataQuery.data) return;
    const payload = step1MetadataQuery.data;
    if (payload.requested_limit !== null && !isRequestedLimitFocusedRef.current) {
      setAnalysis((prev) => ({ ...prev, requestedLimit: formatCurrencyBRL(String(payload.requested_limit)) }));
    }
    setRequestTermDays(payload.requested_term_days !== null ? String(payload.requested_term_days) : "");
    setRequestBusinessUnit(payload.business_unit ?? "");
    setRequestCustomerType(payload.customer_type ?? "");
    setRequestOperationModality(payload.operation_modality ?? "");
    setContactName(payload.contact_name ?? "");
    setContactPhone(payload.contact_phone ?? "");
    setContactEmail(payload.contact_email ?? "");
  }, [step1MetadataQuery.data]);

  const manualStatus = resolveManualStatus({ ...manual, enabled: manualConfigured });
  const ocrStatus = resolveUploadStatus(ocr);
  const agriskStatus = resolveUploadStatus({ enabled: agriskImport.files.length > 0, files: agriskImport.files });
  const cofaceStatus = resolveUploadStatus({ enabled: cofaceImport.files.length > 0, files: cofaceImport.files });

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
      if (hasInvalidAgriskImport) {
        return "O relatório AgRisk enviado está inválido para uso na análise. Substitua o arquivo para continuar.";
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
    if (isGovernanceBlocked && targetStep > 1) {
      setStepError("Não é possível avançar enquanto existir bloqueio de governança para este CNPJ.");
      return;
    }
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
      source === "agrisk" ? agriskImport.files[0] ?? null : cofaceImport.files[0] ?? null
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
      setPendingImportError("Arquivo inválido. O tamanho máximo permitido é 10 MB.");
      if (importModalSource === "agrisk") {
        setAgriskImport((prev) => ({ ...prev, status: "error", errorMessage: "Falha na leitura do arquivo (tamanho excedido)." }));
      } else if (importModalSource === "coface") {
        setCofaceImport((prev) => ({ ...prev, status: "error", errorMessage: "Falha na leitura do arquivo (tamanho excedido)." }));
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
        setPendingImportError("Não foi possível ler o arquivo selecionado.");
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
        const message = error instanceof Error ?error.message : "Falha ao processar o relatório AgRisk.";
        setAgriskImport((prev) => ({ ...prev, status: "error", errorMessage: message }));
      }
      return;
    } else if (importModalSource === "coface") {
      if (!pendingImportRawFile) {
        setPendingImportError("Não foi possível ler o arquivo selecionado.");
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
        const message = error instanceof Error ?error.message : "Falha ao processar o relatório COFACE.";
        setCofaceImport((prev) => ({ ...prev, status: "error", errorMessage: message }));
      }
      return;
    }

    setPendingImportError(null);
    setPendingImportFile(null);
    setPendingImportRawFile(null);
    setIsImportModalOpen(false);
  }

  function removeImport(source: ImportSource) {
    const shouldRemove = window.confirm("Deseja remover o relatório importado desta fonte?");
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
      observations: `Fonte do score: ${scoreIsFromImportedAgrisk ?"Agrisk (importado)" : manualPanel.scoreSource}; Score: ${scoreIsFromImportedAgrisk ?"informado por relatório importado" : manualPanel.scoreValue}; DRA COFACE: ${cofaceIsFromImportedReport ?"informado por relatório importado" : manualPanel.cofaceDra}; Faturamento interno 12 meses: ${manualPanel.internalRevenue12m || "não informado"}`
    }));
    setIsManualDrawerOpen(false);
  }

  function submit() {
    if (isGovernanceBlocked) {
      setStepError("A abertura de nova solicitação está bloqueada para este cliente neste momento.");
      return;
    }
    const payload: AnalysisJourneySubmitRequest = {
      existing_customer_id: existingCustomerId,
      customer: {
        company_name: customer.companyName,
        document_number: sanitizeDigits(customer.cnpj),
        segment: "",
        region: "",
        relationship_start_date: null,
        address: "",
        phone: ""
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
          enabled: false,
          rows_count: null,
          template_validated: false,
          notes: hasInternalDataAvailable
            ? "Dados internos da carteira vinculados automaticamente pela base corporativa de AR."
            : "Sem dados internos de carteira disponíveis no momento.",
          files: []
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
            manualConfigured && !hasCofaceImported ?`DRA COFACE manual: ${manualPanel.cofaceDra || "não informado"}` : ""
          ]
            .filter(Boolean)
            .join(" · "),
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
      setTriageMessage("Informe um CNPJ válido para continuar.");
      return;
    }
    triageLookupMutation.mutate(digits);
  }

  const isGovernanceBlocked =
    governanceStatus?.state === "in_progress" || governanceStatus?.state === "recently_completed";
  const isGovernanceInProgress = governanceStatus?.state === "in_progress";
  const isGovernanceRecentlyCompleted = governanceStatus?.state === "recently_completed";
  const governanceDecisionDateLabel = governanceStatus?.decision_date
    ? new Date(governanceStatus.decision_date).toLocaleDateString("pt-BR")
    : null;
  const governanceNextAllowedDateLabel = governanceStatus?.next_allowed_date
    ? new Date(governanceStatus.next_allowed_date).toLocaleDateString("pt-BR")
    : null;

  const canContinue = step === 1 ?normalizedCnpj.length === 14 && Boolean(customer.companyName) && !isGovernanceBlocked : step === 2 ?hasStep2Source : step === 3 ?toNumberInput(analysis.requestedLimit) > 0 : true;
  const submitBlockingError = validateStep(1) ?? validateStep(2) ?? validateStep(3);
  const canSubmitJourney = !submitBlockingError && !submitMutation.isPending && !isGovernanceBlocked;
  const guaranteeOriginText = hasCofaceCoverageImported
    ? "COFACE (valor de cobertura)"
    : toNumberInput(analysis.guaranteeLimit) > 0
      ? "Informado manualmente"
      : "Não informado";
  const guaranteeDisplayText = hasCofaceCoverageImported && cofaceDecisionAmount !== null
    ? currencyFormatter.format(Math.max(0, cofaceDecisionAmount))
    : toNumberInput(analysis.guaranteeLimit) > 0
      ? formatCurrencyBRL(analysis.guaranteeLimit)
      : "Não informado";

  const consolidatedSources = [
    {
      key: "agrisk",
      name: "Importação Agrisk",
      isSent: hasAgriskImported,
      detail: hasAgriskImported
        ?`${agriskImport.files[0]?.original_filename ?? "Arquivo importado"} · ${formatFileSize(agriskImport.files[0]?.file_size ?? 0)} · enviado`
        : "Relatório Agrisk não importado"
    },
    {
      key: "coface",
      name: "Importação COFACE",
      isSent: hasCofaceImported,
      detail: hasCofaceImported
        ?`${cofaceImport.files[0]?.original_filename ?? "Arquivo importado"} · ${formatFileSize(cofaceImport.files[0]?.file_size ?? 0)} · enviado`
        : "Relatório COFACE não importado"
    },
    {
      key: "manual",
      name: "Preenchimento manual",
      isSent: manualStatus === "preenchido",
      detail: manualStatus === "preenchido" ?"Dados manuais preenchidos" : "Não preenchido"
    },
    {
      key: "ocr",
      name: "OCR DRE / Balanço",
      isSent: ocr.files.length > 0,
      detail: ocr.files.length > 0
        ?`${ocr.files[0]?.original_filename ?? "Demonstrativo anexado"} · ${formatFileSize(ocr.files[0]?.file_size ?? 0)} · enviado`
        : "Nenhum demonstrativo anexado"
    },
    {
      key: "internal",
      name: "Dados internos da carteira",
      isSent: hasInternalDataAvailable,
      detail: hasInternalDataAvailable
        ? "Dados financeiros e histórico disponíveis automaticamente"
        : "Sem histórico interno disponível para o cliente"
    }
  ];
  const consolidatedSourcesSentCount = consolidatedSources.filter((source) => source.isSent).length;
  const customerReady = normalizedCnpj.length === 14 && Boolean(customer.companyName.trim());
  const requestedLimitReady = toNumberInput(analysis.requestedLimit) > 0;
  const uploadedStep1Documents = step1DocumentsQuery.data ?? [];
  const commercialReferences: CommercialReference[] = commercialReferencesQuery.data ?? [];
  const financialDocumentType: Step1DocumentType = "financial_statements_and_trial_balances";
  const checklistDocumentDefinitions = step1DocumentDefinitions.filter((definition) => definition.key !== financialDocumentType);
  const financialDocuments = uploadedStep1Documents.filter((item) => item.document_type === financialDocumentType);
  const documentsByType = new Map<Step1DocumentType, AnalysisDocumentDto>();
  for (const item of uploadedStep1Documents) {
    if (item.document_type === financialDocumentType) continue;
    if (!documentsByType.has(item.document_type as Step1DocumentType)) {
      documentsByType.set(item.document_type as Step1DocumentType, item);
    }
  }
  const sentDocumentsCount = checklistDocumentDefinitions.filter((definition) => documentsByType.has(definition.key)).length + (financialDocuments.length > 0 ? 1 : 0);
  const totalDocumentsCount = step1DocumentDefinitions.length;
  const documentalRatio = totalDocumentsCount > 0 ? sentDocumentsCount / totalDocumentsCount : 0;
  const documentalBadge = sentDocumentsCount === totalDocumentsCount ? "Completo" : documentalRatio > 0.5 ? "Parcial" : "Crítico";

  function saveStep1MetadataPatch(patch: Partial<{ requestedLimit: string; termDays: string; businessUnit: string; customerType: string; operationModality: string; contactName: string; contactPhone: string; contactEmail: string }>) {
    if (!hasStep1Workspace) return;
    const nextRequested = patch.requestedLimit ?? analysis.requestedLimit;
    const nextTerm = patch.termDays ?? requestTermDays;
    const nextBu = patch.businessUnit ?? requestBusinessUnit;
    const nextType = patch.customerType ?? requestCustomerType;
    const nextModality = patch.operationModality ?? requestOperationModality;
    const nextContactName = patch.contactName ?? contactName;
    const nextContactPhone = patch.contactPhone ?? contactPhone;
    const nextContactEmail = patch.contactEmail ?? contactEmail;
    saveStep1MetadataMutation.mutate({
      requested_limit: toNumberInput(nextRequested),
      requested_term_days: nextTerm.trim() ? Number(nextTerm) : null,
      business_unit: nextBu.trim() || null,
      customer_type: nextType.trim() || null,
      operation_modality: nextModality.trim() || null,
      contact_name: nextContactName.trim() || null,
      contact_phone: nextContactPhone.trim() || null,
      contact_email: nextContactEmail.trim() || null
    });
  }

  function labelDocumentStatus(status: string) {
    if (status === "aprovado") return "Aprovado";
    if (status === "rejeitado") return "Rejeitado";
    if (status === "enviado") return "Enviado";
    return "Pendente";
  }

  function formatPhoneInput(value: string) {
    const digits = value.replace(/\D/g, "").slice(0, 11);
    if (digits.length <= 2) return digits;
    if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }

  function normalizeRequestedLimitDraft(value: string) {
    return value.replace(/[^\d.,]/g, "");
  }

  function commitRequestedLimit(value: string) {
    const numericValue = toNumberInput(value);
    const formattedValue = formatCurrencyBRL(String(numericValue));
    setAnalysis((prev) => ({ ...prev, requestedLimit: formattedValue }));
    saveStep1MetadataPatch({ requestedLimit: formattedValue });
  }

  async function handleStep1DocumentUpload(documentType: Step1DocumentType, file: File | null | undefined) {
    if (!file) {
      setDocumentUploadFeedback({ type: "error", message: "Arquivo inválido ou ausente." });
      return;
    }
    if (!hasStep1Workspace) {
      setDocumentUploadFeedback({ type: "error", message: "Não foi possível preparar a solicitação para upload. Consulte o CNPJ novamente." });
      return;
    }
    setDocumentUploadFeedback(null);
    await uploadStep1DocumentMutation.mutateAsync({ documentType, file });
  }

  async function handleFinancialDocumentsUpload(files: File[]) {
    if (files.length === 0) {
      setDocumentUploadFeedback({ type: "error", message: "Arquivo inválido ou ausente." });
      return;
    }
    if (!hasStep1Workspace) {
      setDocumentUploadFeedback({ type: "error", message: "Não foi possível preparar a solicitação para upload. Consulte o CNPJ novamente." });
      return;
    }
    setDocumentUploadFeedback(null);
    for (const file of files) {
      await uploadStep1DocumentMutation.mutateAsync({ documentType: financialDocumentType, file });
    }
  }

  function isBasicEmailValid(value: string) {
    const normalized = value.trim();
    if (!normalized) return true;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
  }

  function handleAddCommercialReference() {
    if (!hasStep1Workspace) {
      setCommercialReferenceForm((prev) => ({ ...prev, error: "Consulte o CNPJ novamente para iniciar a solicitação." }));
      return;
    }
    const name = commercialReferenceForm.name.trim();
    const phone = commercialReferenceForm.phone.trim();
    const email = commercialReferenceForm.email.trim();

    if (!name) {
      setCommercialReferenceForm((prev) => ({ ...prev, error: "Informe o nome da referência." }));
      return;
    }
    if (!phone && !email) {
      setCommercialReferenceForm((prev) => ({ ...prev, error: "Informe ao menos telefone ou e-mail." }));
      return;
    }
    if (email && !isBasicEmailValid(email)) {
      setCommercialReferenceForm((prev) => ({ ...prev, error: "Informe um e-mail válido." }));
      return;
    }

    createCommercialReferenceMutation.mutate(
      { name, phone: phone || null, email: email || null },
      {
        onSuccess: () => {
          setCommercialReferenceForm({ name: "", phone: "", email: "", error: "" });
        },
        onError: (error) => {
          setCommercialReferenceForm((prev) => ({
            ...prev,
            error: error instanceof Error ? error.message : "Falha ao adicionar referência comercial."
          }));
        }
      }
    );
  }

  if (isWorkspaceMode && (workspaceDetailQuery.isLoading || workspaceExternalDataQuery.isLoading || !workspaceHydrated)) {
    if (!workspaceError) {
      return <div className="rounded-[12px] border border-[#D7E1EC] bg-white p-6 text-[13px] text-[#4F647A]">Carregando workspace da análise...</div>;
    }
  }

  if (isWorkspaceMode && workspaceError) {
    return (
      <ErrorState
        title="Não foi possível abrir o workspace operacional"
        description={workspaceError}
      />
    );
  }

  return (
    <section className={`readability-standard ${step === 4 ?"space-y-0 rounded-[12px] bg-[#F7F9FC]" : "space-y-4"}`}>
      <div
        aria-hidden={triageModalOpen}
        className={triageModalOpen ? "pointer-events-none select-none blur-[3px] opacity-55 scale-[0.985] transition duration-200 ease-out" : "transition duration-200 ease-out"}
      >
      {step !== 4 ?(
        <div className="flex items-center justify-between rounded-[14px] border border-[#D7E1EC] bg-white px-6 py-5">
        <div>
          <p className="text-[17px] font-semibold text-[#102033]">Nova análise de crédito</p>
          <p className="text-[13px] text-[#4F647A]">
            Identifique o cliente, informe os dados da solicitação e reúna as informações necessárias para análise de crédito.
          </p>
          <p className="mt-1 text-[11px] text-[#8FA3B4]">A consulta externa é opcional. Se necessário, os dados podem ser informados manualmente.</p>
        </div>
        <Link href="/analises" className="rounded-[8px] border border-[#D7E1EC] bg-white px-4 py-2 text-[12px] font-medium text-[#4F647A] hover:bg-[#f9fafb]">
          <span className="mr-1"></span> Voltar para análises
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
          {triageResult ? (
            <div className="space-y-3 rounded-[12px] border border-[#D7E1EC] bg-[#FCFDFE] p-4">
              <p className="text-[13px] font-semibold text-[#102033]">Resultado da Consulta do Cliente</p>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className={`inline-flex items-center gap-2 rounded-[999px] border px-2.5 py-1 text-[11px] font-medium ${triageResult.found_in_portfolio ? "border-[#BBF7D0] bg-[#F0FDF4] text-[#166534]" : "border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]"}`}>
                  <Building2 className="h-3.5 w-3.5" />
                  {triageResult.found_in_portfolio ? "Cliente localizado na carteira" : "Cliente localizado em base externa"}
                </div>
                <button type="button" onClick={() => setTriageModalOpen(true)} className="rounded-[8px] border border-[#D7E1EC] bg-white px-3 py-1.5 text-[11px] font-medium text-[#102033] hover:bg-[#F2F6FB]">
                  Consultar outro CNPJ
                </button>
              </div>

              <div className="overflow-hidden rounded-[12px] border border-[#D7E1EC] bg-white">
                <div className="grid grid-cols-1 md:grid-cols-2">
                  <div className="flex flex-col gap-2 border-b border-[#D7E1EC] p-4 md:border-b-0 md:border-r">
                    <span className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${triageResult.found_in_portfolio ? "bg-[#EAF3DE] text-[#3B6D11]" : "bg-[#FFF7E8] text-[#92400E]"}`}>
                      <Building2 className="h-3 w-3" />
                      {triageResult.found_in_portfolio ? "Cliente da carteira" : "Novo cliente"}
                    </span>
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#8FA3B4]">Razão social</p>
                      <p className="text-[13px] font-medium text-[#102033]">{triageResult.customer_data.company_name ?? "-"}</p>
                    </div>
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#8FA3B4]">CNPJ</p>
                      <p className="font-mono text-[13px] font-medium text-[#102033]">{formatCnpj(triageResult.customer_data.cnpj)}</p>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 p-4">
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#8FA3B4]">Grupo econômico</p>
                      <p className="text-[13px] font-medium text-[#102033]">{triageResult.customer_data.economic_group ?? "-"}</p>
                    </div>
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#8FA3B4]">Unidade de negócio / BU</p>
                      <p className="text-[13px] font-medium text-[#102033]">{triageResult.customer_data.business_unit ?? "-"}</p>
                    </div>
                  </div>
                </div>
              </div>

              {triageResult.found_in_portfolio ? (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div className="rounded-[12px] border border-[#E5EAF1] bg-white px-4 py-3">
                    <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#4F647A]">Valor em aberto</p>
                    <p className="text-[16px] font-medium text-[#7A4D10]">{formatCurrencyBRL(String(triageResult.economic_position?.open_amount ?? 0))}</p>
                  </div>
                  <div className="rounded-[12px] border border-[#E5EAF1] bg-white px-4 py-3">
                    <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#4F647A]">Limite total</p>
                    <p className="text-[16px] font-medium text-[#102033]">{formatCurrencyBRL(String(triageResult.economic_position?.total_limit ?? 0))}</p>
                  </div>
                  <div className="rounded-[12px] border border-[#E5EAF1] bg-white px-4 py-3">
                    <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#4F647A]">Disponível</p>
                    <p className="text-[16px] font-medium text-[#1A6644]">{formatCurrencyBRL(String(triageResult.economic_position?.available_limit ?? 0))}</p>
                  </div>
                </div>
              ) : null}

              {!triageResult.found_in_portfolio && triageResult.requires_business_unit_selection ? (
                <label className="block text-[12px] text-[#374151]">
                  Unidade de Negócio / BU<RequiredMark />
                  <select value={triageSelectedBusinessUnit} onChange={(event) => setTriageSelectedBusinessUnit(event.target.value)} className="mt-1 h-10 w-full rounded-[8px] border border-[#D7E1EC] px-3 text-[12px]">
                    <option value="">Selecione a BU</option>
                    {(triageResult.available_business_units ?? []).map((option) => (
                      <option key={option.id} value={option.name}>{option.name}</option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
          ) : (
            <div className="rounded-[10px] border border-dashed border-[#D7E1EC] bg-[#F9FBFD] px-4 py-3 text-[12px] text-[#4F647A]">
              Abra o popup de nova solicitação, informe o CNPJ e clique em Consultar para carregar os dados do cliente nesta etapa.
            </div>
          )}

          {triageResult && governanceStatus ? (
            <div
              className={`rounded-[10px] border px-4 py-3 text-[12px] ${
                isGovernanceRecentlyCompleted
                  ? "border-[#F5B5B5] bg-[#FEF2F2] text-[#B91C1C]"
                  : isGovernanceInProgress
                    ? "border-[#BFDBFE] bg-[#EFF6FF] text-[#1D4ED8]"
                    : governanceStatus.state === "completed_expired"
                      ? "border-[#D7E1EC] bg-white text-[#334155]"
                      : "border-[#D7E1EC] bg-white text-[#334155]"
              }`}
            >
              <p className="font-medium">{governanceStatus.message}</p>
              {governanceDecisionDateLabel ? <p className="mt-1">Última decisão em: {governanceDecisionDateLabel}.</p> : null}
              {governanceNextAllowedDateLabel && isGovernanceRecentlyCompleted ? (
                <p className="mt-1">Nova análise disponível a partir de: {governanceNextAllowedDateLabel}.</p>
              ) : null}
              {isGovernanceInProgress ? (
                <div className="mt-2">
                  <Link
                    href={governanceStatus.analysis_id ? `/analises/monitor?analysisId=${governanceStatus.analysis_id}` : `/analises/monitor?cnpj=${triageResult.customer_data.cnpj}`}
                    className="inline-flex items-center rounded-[8px] border border-[#93C5FD] bg-white px-3 py-1.5 text-[11px] font-medium text-[#1E40AF] hover:bg-[#EFF6FF]"
                  >
                    Abrir andamento da análise
                  </Link>
                </div>
              ) : null}
            </div>
          ) : null}

          <p className="text-[13px] font-medium text-[#111827]">Informe o CNPJ para identificar o cliente</p>
          <label className="block text-[12px] text-[#374151]">
            CNPJ<RequiredMark />
            <input
              value={customer.cnpj}
              onChange={(event) => {
                setExistingCustomerId(null);
                setGovernanceStatus(null);
                setDraftAnalysisId(null);
                setDraftCnpj(null);
                setCustomer((prev) => ({ ...prev, cnpj: formatCnpj(event.target.value) }));
              }}
              onBlur={handleCnpjBlur}
              className="mt-1 h-9 w-full rounded-[6px] border border-[#d1d5db] px-3 text-[12px]"
              placeholder="00.000.000/0000-00"
            />
          </label>
          <p className="text-[12px] text-[#6b7280]">
            {lookupMutation.isPending ?"Consultando dados cadastrais..." : externalLookupMessage ?? "A consulta externa é opcional. Se necessário, os dados podem ser informados manualmente."}
          </p>

          <fieldset disabled={isGovernanceBlocked} className="contents">
          <div className="rounded-[8px] border border-[#e2e5eb] bg-[#f9fafb] p-3">
            <p className="mb-2 text-[12px] font-medium text-[#111827]">Contato do Cliente</p>
            <div className="grid gap-3 md:grid-cols-3">
              <label className="text-[11px] text-[#374151] md:col-span-3">
                Razão social<RequiredMark />
                <input
                  value={customer.companyName}
                  onChange={(event) => setCustomer((prev) => ({ ...prev, companyName: event.target.value }))}
                  readOnly={Boolean(triageResult?.found_in_portfolio)}
                  className="mt-1 h-9 w-full rounded-[6px] border px-3 text-[12px] read-only:bg-[#F3F4F6] read-only:text-[#6B7280]"
                />
              </label>
              <label className="text-[11px] text-[#374151]">
                Pessoa de Contato
                <input
                  value={contactName}
                  onChange={(event) => setContactName(event.target.value)}
                  onBlur={() => saveStep1MetadataPatch({ contactName })}
                  className="mt-1 h-9 w-full rounded-[6px] border px-3 text-[12px]"
                />
              </label>
              <label className="text-[11px] text-[#374151]">
                Telefone do Contato
                <input
                  value={contactPhone}
                  onChange={(event) => setContactPhone(formatPhoneInput(event.target.value))}
                  onBlur={() => saveStep1MetadataPatch({ contactPhone })}
                  className="mt-1 h-9 w-full rounded-[6px] border px-3 text-[12px]"
                />
              </label>
              <label className="text-[11px] text-[#374151]">
                E-mail do Contato
                <input
                  value={contactEmail}
                  onChange={(event) => setContactEmail(event.target.value)}
                  onBlur={() => saveStep1MetadataPatch({ contactEmail })}
                  className="mt-1 h-9 w-full rounded-[6px] border px-3 text-[12px]"
                />
              </label>
            </div>
          </div>

          <div className="rounded-[12px] border border-[#D7E1EC] bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
            <p className="text-[13px] font-semibold text-[#102033]">Dados da Solicitação</p>
            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <label className="text-[11px] text-[#374151]">Limite solicitado / sugerido (BRL)
                <input
                  value={analysis.requestedLimit}
                  onFocus={() => {
                    isRequestedLimitFocusedRef.current = true;
                    const numericValue = toNumberInput(analysis.requestedLimit);
                    setAnalysis((prev) => ({
                      ...prev,
                      requestedLimit: numericValue > 0 ? String(numericValue).replace(".", ",") : ""
                    }));
                  }}
                  onChange={(event) => {
                    setAnalysis((prev) => ({ ...prev, requestedLimit: normalizeRequestedLimitDraft(event.target.value) }));
                  }}
                  onBlur={(event) => {
                    isRequestedLimitFocusedRef.current = false;
                    commitRequestedLimit(event.currentTarget.value);
                  }}
                  className="mt-1 h-10 w-full rounded-[8px] border border-[#D7E1EC] px-3 text-[12px]"
                />
              </label>
              <label className="text-[11px] text-[#374151]">Prazo solicitado (dias)
                <input value={requestTermDays} onChange={(event) => { setRequestTermDays(event.target.value.replace(/\D/g, "")); }} onBlur={() => saveStep1MetadataPatch({ termDays: requestTermDays })} className="mt-1 h-10 w-full rounded-[8px] border border-[#D7E1EC] px-3 text-[12px]" />
              </label>
              <label className="text-[11px] text-[#374151]">Business Unit
                <select value={requestBusinessUnit} onChange={(event) => { setRequestBusinessUnit(event.target.value); saveStep1MetadataPatch({ businessUnit: event.target.value }); }} className="mt-1 h-10 w-full rounded-[8px] border border-[#D7E1EC] px-3 text-[12px]">
                  <option value="">Selecione</option>
                  <option value="Fertilizantes">Fertilizantes</option>
                  <option value="Aditivos Nacional">Aditivos Nacional</option>
                  <option value="Aditivos Internacional">Aditivos Internacional</option>
                </select>
              </label>
              <label className="text-[11px] text-[#374151]">Tipo de Cliente
                <select value={requestCustomerType} onChange={(event) => { setRequestCustomerType(event.target.value); saveStep1MetadataPatch({ customerType: event.target.value }); }} className="mt-1 h-10 w-full rounded-[8px] border border-[#D7E1EC] px-3 text-[12px]">
                  <option value="">Selecione</option>
                  <option value="Produtor">Produtor</option>
                  <option value="Revenda">Revenda</option>
                  <option value="Indústria">Indústria</option>
                  <option value="Trading">Trading</option>
                </select>
              </label>
              <label className="text-[11px] text-[#374151] md:col-span-2 xl:col-span-2">Modalidade da Operação
                <select value={requestOperationModality} onChange={(event) => { setRequestOperationModality(event.target.value); saveStep1MetadataPatch({ operationModality: event.target.value }); }} className="mt-1 h-10 w-full rounded-[8px] border border-[#D7E1EC] px-3 text-[12px]">
                  <option value="">Selecione</option>
                  <option value="À vista">À vista</option>
                  <option value="Prazo safra">Prazo safra</option>
                  <option value="Barter">Barter</option>
                  <option value="Antecipado">Antecipado</option>
                  <option value="Prazo padrão">Prazo padrão</option>
                </select>
              </label>
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded-[12px] border border-[#D7E1EC] bg-white p-4">
              <p className="text-[13px] font-semibold text-[#102033]">Documentação Inicial</p>
              <p className="mt-1 text-[11px] text-[#4F647A]">Documentação incompleta gera alerta visual nesta etapa, sem bloqueio automático.</p>
              {documentUploadFeedback ? (
                <div className={`mt-3 rounded-[8px] border px-3 py-2 text-[11px] ${documentUploadFeedback.type === "error" ? "border-[#F5B5B5] bg-[#FEF2F2] text-[#B91C1C]" : "border-[#BBF7D0] bg-[#F0FDF4] text-[#166534]"}`}>
                  {documentUploadFeedback.message}
                </div>
              ) : null}
              <div className="mt-3 grid gap-2">
                {checklistDocumentDefinitions.map((doc) => {
                  const item = documentsByType.get(doc.key);
                  return (
                    <div key={doc.key} className="flex flex-wrap items-center gap-2 rounded-[10px] border border-[#E5EAF1] bg-[#FAFCFF] p-2.5 text-[11px]">
                      <div className="min-w-[190px] flex-1 font-medium text-[#102033]">{doc.label}</div>
                      <span className="rounded-full border border-[#D7E1EC] bg-white px-2 py-0.5 text-[10px] text-[#4F647A]">{labelDocumentStatus(item?.status ?? "pendente")}</span>
                      <span className="max-w-[190px] truncate text-[#4F647A]">{item?.original_filename ?? "Sem arquivo"}</span>
                      <span className="text-[#8FA3B4]">{item?.uploaded_at ? new Date(item.uploaded_at).toLocaleDateString("pt-BR") : "-"}</span>
                      <label className={`rounded-[8px] border border-[#D7E1EC] bg-white px-2.5 py-1 text-[10px] font-medium text-[#102033] hover:bg-[#F2F6FB] ${uploadStep1DocumentMutation.isPending ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
                        Upload
                        <input
                          type="file"
                          className="hidden"
                          disabled={uploadStep1DocumentMutation.isPending}
                          onChange={async (event) => {
                            const input = event.currentTarget;
                            const file = event.target.files?.[0];
                            await handleStep1DocumentUpload(doc.key, file);
                            input.value = "";
                          }}
                        />
                      </label>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 rounded-[12px] border border-[#D7E1EC] bg-[#FCFDFE] p-4">
                <p className="text-[13px] font-semibold text-[#102033]">Demonstrações Financeiras e Balancetes</p>
                <p className="mt-1 text-[11px] text-[#4F647A]">
                  Envie balanços, DREs, balancetes atualizados e demais documentos financeiros utilizados na análise.
                </p>

                <div className="mt-3">
                  <label className={`inline-flex items-center rounded-[8px] border border-[#D7E1EC] bg-white px-3 py-1.5 text-[11px] font-medium text-[#102033] hover:bg-[#F2F6FB] ${uploadStep1DocumentMutation.isPending ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
                    Adicionar arquivos
                    <input
                      type="file"
                      multiple
                      className="hidden"
                      disabled={uploadStep1DocumentMutation.isPending}
                      onChange={async (event) => {
                        const input = event.currentTarget;
                        const files = Array.from(event.target.files ?? []);
                        await handleFinancialDocumentsUpload(files);
                        input.value = "";
                      }}
                    />
                  </label>
                </div>

                <div className="mt-3 space-y-2">
                  {financialDocuments.length === 0 ? (
                    <div className="rounded-[10px] border border-dashed border-[#D7E1EC] bg-white px-3 py-2 text-[11px] text-[#6B7280]">
                      Nenhum documento financeiro enviado ainda.
                    </div>
                  ) : (
                    financialDocuments.map((doc) => (
                      <div key={doc.id} className="flex flex-wrap items-center gap-2 rounded-[10px] border border-[#E5EAF1] bg-white p-2.5 text-[11px]">
                        <div className="min-w-[220px] flex-1 font-medium text-[#102033]">{doc.original_filename}</div>
                        <span className="rounded-full border border-[#D7E1EC] bg-[#F7F9FC] px-2 py-0.5 text-[10px] text-[#4F647A]">
                          Demonstrações Financeiras e Balancetes
                        </span>
                        <span className="rounded-full border border-[#D7E1EC] bg-white px-2 py-0.5 text-[10px] text-[#4F647A]">
                          {labelDocumentStatus(doc.status)}
                        </span>
                        <span className="text-[#8FA3B4]">{new Date(doc.uploaded_at).toLocaleDateString("pt-BR")}</span>
                        <button
                          type="button"
                          onClick={() => deleteStep1DocumentMutation.mutate(doc.id)}
                          className="rounded-[8px] border border-[#F2D4D4] bg-white px-2.5 py-1 text-[10px] font-medium text-[#B91C1C] hover:bg-[#FEF2F2]"
                        >
                          Remover
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="mt-4 rounded-[12px] border border-[#D7E1EC] bg-[#FCFDFE] p-4">
                <p className="text-[13px] font-semibold text-[#102033]">Referências Comerciais</p>
                <p className="mt-1 text-[11px] text-[#4F647A]">
                  Informe contatos comerciais que possam contribuir para a avaliação do relacionamento e histórico do cliente.
                </p>

                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <label className="text-[11px] text-[#374151]">
                    Nome da referência
                    <input
                      value={commercialReferenceForm.name}
                      onChange={(event) =>
                        setCommercialReferenceForm((prev) => ({ ...prev, name: event.target.value, error: "" }))
                      }
                      className="mt-1 h-10 w-full rounded-[8px] border border-[#D7E1EC] px-3 text-[12px]"
                      placeholder="Ex.: Fornecedor Alfa"
                    />
                  </label>
                  <label className="text-[11px] text-[#374151]">
                    Telefone
                    <input
                      value={commercialReferenceForm.phone}
                      onChange={(event) =>
                        setCommercialReferenceForm((prev) => ({
                          ...prev,
                          phone: formatPhoneInput(event.target.value),
                          error: ""
                        }))
                      }
                      className="mt-1 h-10 w-full rounded-[8px] border border-[#D7E1EC] px-3 text-[12px]"
                      placeholder="(11) 99999-9999"
                    />
                  </label>
                  <label className="text-[11px] text-[#374151]">
                    E-mail
                    <input
                      value={commercialReferenceForm.email}
                      onChange={(event) =>
                        setCommercialReferenceForm((prev) => ({ ...prev, email: event.target.value, error: "" }))
                      }
                      className="mt-1 h-10 w-full rounded-[8px] border border-[#D7E1EC] px-3 text-[12px]"
                      placeholder="contato@empresa.com"
                    />
                  </label>
                </div>

                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleAddCommercialReference}
                    disabled={!hasStep1Workspace || createCommercialReferenceMutation.isPending}
                    className="rounded-[8px] border border-[#D7E1EC] bg-white px-3 py-1.5 text-[11px] font-medium text-[#102033] hover:bg-[#F2F6FB] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {createCommercialReferenceMutation.isPending ? "Adicionando..." : "Adicionar referência"}
                  </button>
                  {commercialReferenceForm.error ? <span className="text-[11px] text-[#B91C1C]">{commercialReferenceForm.error}</span> : null}
                </div>

                <div className="mt-3">
                  {commercialReferences.length === 0 ? (
                    <div className="rounded-[10px] border border-dashed border-[#D7E1EC] bg-white px-3 py-2 text-[11px] text-[#6B7280]">
                      Nenhuma referência comercial adicionada ainda.
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-[10px] border border-[#E5EAF1] bg-white">
                      <div className="hidden grid-cols-[1.3fr_1fr_1.3fr_0.8fr_auto] gap-3 border-b border-[#E5EAF1] bg-[#F7F9FC] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.04em] text-[#6B7280] md:grid">
                        <span>Referência</span>
                        <span>Telefone</span>
                        <span>E-mail</span>
                        <span>Inclusão</span>
                        <span className="text-right">Ação</span>
                      </div>
                      <div className="divide-y divide-[#EEF2F6]">
                        {commercialReferences.map((reference) => (
                          <div
                            key={reference.id}
                            className="grid gap-2 px-3 py-3 text-[11px] md:grid-cols-[1.3fr_1fr_1.3fr_0.8fr_auto] md:items-center md:gap-3"
                          >
                            <div>
                              <span className="block text-[10px] font-semibold uppercase tracking-[0.04em] text-[#8FA3B4] md:hidden">Referência</span>
                              <span className="font-medium text-[#102033]">{reference.name}</span>
                            </div>
                            <div className="text-[#4F647A]">
                              <span className="block text-[10px] font-semibold uppercase tracking-[0.04em] text-[#8FA3B4] md:hidden">Telefone</span>
                              {reference.phone || "-"}
                            </div>
                            <div className="break-words text-[#4F647A]">
                              <span className="block text-[10px] font-semibold uppercase tracking-[0.04em] text-[#8FA3B4] md:hidden">E-mail</span>
                              {reference.email || "-"}
                            </div>
                            <div className="text-[#8FA3B4]">
                              <span className="block text-[10px] font-semibold uppercase tracking-[0.04em] text-[#8FA3B4] md:hidden">Inclusão</span>
                              {new Date(reference.created_at).toLocaleDateString("pt-BR")}
                            </div>
                            <div className="flex justify-start md:justify-end">
                              <button
                                type="button"
                                onClick={() => deleteCommercialReferenceMutation.mutate(reference.id)}
                                className="rounded-[8px] border border-[#F2D4D4] bg-white px-2.5 py-1 text-[10px] font-medium text-[#B91C1C] hover:bg-[#FEF2F2]"
                              >
                                Remover
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <aside className="rounded-[12px] border border-[#D7E1EC] bg-white p-4">
              <p className="text-[13px] font-semibold text-[#102033]">Status Documental</p>
              <p className="mt-2 text-[22px] font-semibold text-[#1B3A6B]">{sentDocumentsCount} de {totalDocumentsCount}</p>
              <p className="text-[11px] text-[#4F647A]">documentos enviados</p>
              <span className={`mt-3 inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold ${documentalBadge === "Completo" ? "bg-[#EAF7EE] text-[#166534]" : documentalBadge === "Parcial" ? "bg-[#FFF7E8] text-[#92400E]" : "bg-[#FEF2F2] text-[#B91C1C]"}`}>
                {documentalBadge}
              </span>
            </aside>
          </div>
          </fieldset>
        </article>
      ) : null}

      {step >= 2 ?(
        <div className={`flex items-center gap-3 bg-white ${step === 4 ?"h-[44px] border-b border-[#D7E1EC] px-7" : "rounded-[10px] border border-[#D7E1EC] px-5 py-3"}`}>
          <div className="mr-1 text-[11px] text-[#8FA3B4]">Cliente da solicitação</div>
          <div className={`flex items-center justify-center rounded-[6px] text-[10px] font-bold ${step === 4 ?"h-[26px] w-[26px] bg-[#295B9A] text-white" : "h-7 w-7 bg-[#EEF3F8] text-[#295B9A]"}`}>
            {toInitials(customer.companyName || "Cliente")}
          </div>
          <div className="text-[13px] font-semibold text-[#102033]">{customer.companyName || "Cliente não informado"}</div>
          <div className="text-[11px] text-[#4F647A]">{customer.cnpj || "CNPJ não informado"}</div>
          <div className={`ml-auto rounded-full bg-[#EEF3F8] px-2.5 py-1 font-medium ${step === 4 ?"text-[11px] text-[#295B9A]" : "text-[10px] text-[#4F647A]"}`}>Etapa {step} de 4</div>
        </div>
      ) : null}

      {step === 2 ?(
        <>
          <article className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[15px] font-semibold text-[#102033]">Informações para análise</p>
                <p className="text-[12px] text-[#4F647A]">Escolha como deseja estruturar os dados da análise. Você pode combinar múltiplas fontes.</p>
              </div>
              <div className="space-y-1 text-right">
                <p className="text-[11px] font-medium text-[#4F647A]">{structuredSourcesCount} de 3 fontes estruturadas preenchidas</p>
                {isStep2Ready ?<p className="text-[11px] text-[#166534]">Dados suficientes para avançar para a próxima etapa</p> : null}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <button
                type="button"
                onClick={() => openImportModal("agrisk")}
                className={`relative flex h-full flex-col rounded-[16px] border-2 ${
                  agriskImport.status !== "empty" ? "border-[#10B981]" : "border-[#295B9A]"
                } bg-white p-6 text-left transition hover:-translate-y-0.5 ${
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
                          {agriskImport.files[0] ?`${formatFileSize(agriskImport.files[0].file_size)} · ${agriskImport.importedAt ?`Importado em ${formatImportedAt(agriskImport.importedAt)}` : "Importado"}` : agriskImport.errorMessage ?? "Falha na leitura do arquivo."}
                        </p>
                        <p className="mt-1 text-[10px] text-[#4F647A]">{importMonitorValueText("agrisk")}</p>
                        {agriskImport.status === "valid" ?(
                          <p className="mt-1 text-[10px] text-[#4F647A]">Relatório validado e pronto para análise.</p>
                        ) : null}
                        {agriskImport.status === "valid_with_warnings" ?(
                          <>
                            <p className="mt-1 text-[10px] text-[#92400E]">Relatório validado com alertas de leitura.</p>
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
                            O CNPJ do relatório não corresponde ao cliente informado.
                          </p>
                        ) : null}
                        {(agriskImport.status === "invalid" || agriskImport.status === "error") && !isDocumentDivergenceMessage(agriskImport.errorMessage) ?(
                          <p className="mt-1 text-[10px] text-[#B91C1C]">
                            Este relatório não será considerado apto para análise até ser substituído.
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
                            Substituir relatório <ChevronRight className="ml-1 h-3.5 w-3.5" />
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
                    ?"cursor-pointer border-[#10B981] hover:-translate-y-0.5 hover:shadow-[0_10px_30px_rgba(16,32,51,0.08)]"
                    : "border-[#D7E1EC]"
                }`}
              >
                {cofaceImport.status === "empty" ?(
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
                          {cofaceImport.files[0] ?`${formatFileSize(cofaceImport.files[0].file_size)} · ${cofaceImport.importedAt ?`Importado em ${formatImportedAt(cofaceImport.importedAt)}` : "Importado"}` : cofaceImport.errorMessage ?? "Falha na leitura do arquivo."}
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
                            Substituir relatório <ChevronRight className="ml-1 h-3.5 w-3.5" />
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </>
                )}
              </button>

              <article className={`flex h-full flex-col rounded-[16px] border bg-white p-6 text-left ${
                hasInternalFinancialSnapshot ? "border-[#10B981]" : "border-[#D7E1EC]"
              }`}>
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div className="flex h-11 w-11 items-center justify-center rounded-[12px] bg-[#F7F9FC]">
                    <Building2 className="h-5 w-5 text-[#4F647A]" />
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    hasInternalFinancialSnapshot ? "bg-[#EAF7EE] text-[#166534]" : "bg-[#EEF3F8] text-[#4F647A]"
                  }`}>
                    {hasInternalFinancialSnapshot ? "disponível" : "sem histórico interno"}
                  </span>
                </div>
                {hasInternalFinancialSnapshot ? (
                  <div className="rounded-[10px] border border-[#D7E1EC] bg-[#F8FBFF] p-3">
                    <p className="mb-1 text-[10px] uppercase tracking-[0.6px] text-[#8FA3B4]">Base interna</p>
                    <p className="mb-2 text-[15px] font-semibold text-[#102033]">Dados internos da carteira</p>
                    <p className="text-[10px] font-medium uppercase tracking-[0.5px] text-[#8FA3B4]">Resumo financeiro interno</p>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      <div>
                        <p className="text-[10px] text-[#8FA3B4]">Valor em Aberto</p>
                        <p className="text-[11px] font-semibold text-[#102033]">{formatCurrencyBRL(String(internalOpenAmount))}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-[#8FA3B4]">Limite Total</p>
                        <p className="text-[11px] font-semibold text-[#102033]">{formatCurrencyBRL(String(internalTotalLimit))}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-[#8FA3B4]">Limite Disponível</p>
                        <p className="text-[11px] font-semibold text-[#1A6644]">{formatCurrencyBRL(String(internalAvailableLimit))}</p>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {internalOverdue !== null ? <span className="rounded-full border border-[#D7E1EC] bg-white px-2 py-0.5 text-[10px] text-[#4F647A]">overdue: {formatCurrencyBRL(String(internalOverdue))}</span> : null}
                      {internalNotDue !== null ? <span className="rounded-full border border-[#D7E1EC] bg-white px-2 py-0.5 text-[10px] text-[#4F647A]">not due: {formatCurrencyBRL(String(internalNotDue))}</span> : null}
                      {internalOperationalStatus ? <span className="rounded-full border border-[#D7E1EC] bg-white px-2 py-0.5 text-[10px] text-[#4F647A]">status: {internalOperationalStatus}</span> : null}
                      <span className="rounded-full border border-[#D7E1EC] bg-white px-2 py-0.5 text-[10px] text-[#4F647A]">exposição: {formatCurrencyBRL(String(internalExposure))}</span>
                      <span className="rounded-full border border-[#D7E1EC] bg-white px-2 py-0.5 text-[10px] text-[#4F647A]">comportamento: {internalBehaviorLabel}</span>
                    </div>
                    <p className="mt-1 text-[10px] text-[#64748B]">Última atualização: base principal de AR.</p>
                  </div>
                ) : (
                  <div className="mt-3 rounded-[10px] border border-[#D7E1EC] bg-[#F8FBFF] p-3">
                    <p className="mb-1 text-[10px] uppercase tracking-[0.6px] text-[#8FA3B4]">Carteira corporativa</p>
                    <p className="mb-2 text-[15px] font-semibold text-[#102033]">Cliente novo</p>
                    <p className="text-[12px] leading-relaxed text-[#4F647A]">
                      Este cliente ainda não possui movimentações ou exposição registradas na carteira corporativa.
                    </p>
                  </div>
                )}
              </article>

              <button
                type="button"
                onClick={() => {
                  if (!isManualBlocked) setIsManualDrawerOpen(true);
                }}
                disabled={isManualBlocked}
                className={`flex h-full flex-col rounded-[16px] border bg-white p-6 text-left transition ${
                  isManualBlocked
                    ? "cursor-not-allowed border-[#D7E1EC] opacity-75"
                    : manualConfigured
                      ? "border-[#10B981] hover:border-[#10B981]"
                      : "hover:border-[#295B9A]"
                }`}
              >
                {!manualConfigured ?(
                  <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-[12px] bg-[#F7F9FC]">
                    <span className="text-xl text-[#4F647A]">+</span>
                  </div>
                ) : null}
                <p className="mb-1 text-[10px] uppercase tracking-[0.6px] text-[#8FA3B4]">Entrada manual</p>
                <p className="mb-2 text-[15px] font-semibold text-[#102033]">Complemento manual</p>
                {manualConfigured ? (
                  <div className="flex-1 rounded-[10px] border border-[#D7E1EC] bg-[#F8FBFF] p-3">
                    <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.5px] text-[#8FA3B4]">Resumo informado</p>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                      <div>
                        <p className="text-[10px] text-[#8FA3B4]">Fonte do score</p>
                        <p className="text-[11px] font-semibold text-[#102033]">{manualPanel.scoreSource || "Não informado"}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-[#8FA3B4]">Score</p>
                        <p className="text-[11px] font-semibold text-[#102033]">{manualPanel.scoreValue ?? "Não informado"}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-[#8FA3B4]">DRA COFACE</p>
                        <p className="text-[11px] font-semibold text-[#102033]">{manualPanel.cofaceDra ?? "Não informado"}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-[#8FA3B4]">Valor em aberto</p>
                        <p className="text-[11px] font-semibold text-[#102033]">{manualPanel.outstandingValue || "Não informado"}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-[#8FA3B4]">Faturamento 12m</p>
                        <p className="text-[11px] font-semibold text-[#102033]">{manualPanel.internalRevenue12m || "Não informado"}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-[#8FA3B4]">PMR (contratual/efetivo)</p>
                        <p className="text-[11px] font-semibold text-[#102033]">
                          {(manualPanel.pmrContractual || "-") + " / " + (manualPanel.pmrEffective || "-")}
                        </p>
                      </div>
                    </div>
                    {manualPanel.analystNotes ? (
                      <p className="mt-2 line-clamp-2 text-[10px] text-[#4F647A]">Observações: {manualPanel.analystNotes}</p>
                    ) : null}
                  </div>
                ) : (
                  <p className="flex-1 text-[12px] leading-relaxed text-[#4F647A]">
                    Informe apenas dados internos comerciais e operacionais para complementar a análise.
                  </p>
                )}
                {isManualBlocked ?(
                  <p className="mt-2 border-t border-[#EEF3F8] pt-2 text-[11px] leading-relaxed text-[#8FA3B4]">
                    Complemento manual indisponível. Agrisk, COFACE e dados internos da carteira já estão disponíveis nesta análise.
                  </p>
                ) : null}
                <span className="mt-4 inline-flex items-center justify-center rounded-[9px] border border-[#D7E1EC] bg-[#F7F9FC] px-4 py-2 text-[12px] font-medium text-[#102033]">
                  {isManualBlocked ?"Complemento manual indisponível" : manualConfigured ? "Editar informações" : "Preencher manualmente"}
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
                    <p className="text-[11px] text-[#8FA3B4]">Envio de DRE ou balanço para leitura assistida.</p>
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
                    {ocr.files[0] ?`${formatFileSize(ocr.files[0].file_size)} · ${ocr.importedAt ?`Importado em ${formatImportedAt(ocr.importedAt)}` : "Importado"}` : "Sem arquivo vinculado"}
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
                        ?"Importar relatório Agrisk"
                        : "Importar relatório COFACE"}
                    </p>
                    <p className="text-[12px] text-[#4F647A]">
                      {importModalSource === "agrisk"
                        ?"Selecione ou arraste o arquivo exportado da Agrisk para processamento automático."
                        : "Selecione ou arraste o arquivo exportado da COFACE para leitura automática do DRA e indicadores de risco."}
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
                        <p className="text-[11px] text-[#8FA3B4]">{formatFileSize(pendingImportFile.file_size)} · Arquivo selecionado</p>
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
                        ?"Pronto para importação. A validação do CNPJ será realizada após clicar em Importar."
                        : "Pronto para importação."}
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
                    <p className="text-[15px] font-semibold text-[#102033]">Dados importados do relatório AgRisk</p>
                    <p className="text-[12px] text-[#4F647A]">Somente os dados estruturados utilizados pelo motor de crédito.</p>
                  </div>
                  <button type="button" onClick={() => setIsAgriskDataDrawerOpen(false)} className="flex h-7 w-7 items-center justify-center rounded-full border border-[#D7E1EC] bg-[#F7F9FC] text-[#4F647A]">
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto px-6 py-5">
                  <div className="mb-6">
                    <p className="mb-3 border-b border-[#EEF3F8] pb-1.5 text-[10px] font-semibold uppercase tracking-[0.7px] text-[#295B9A]">Identificação</p>
                    <div className="space-y-1 text-[12px] text-[#4F647A]">
                      <p><span className="font-medium text-[#102033]">Razão social:</span> {agriskImport.agriskReadPayload?.company?.name || "Não informado"}</p>
                      <p><span className="font-medium text-[#102033]">Documento:</span> {agriskImport.agriskReadPayload?.company?.document || "Não informado"}</p>
                      <p><span className="font-medium text-[#102033]">Abertura:</span> {agriskImport.agriskReadPayload?.company?.opened_at || "Não informado"}</p>
                      <p><span className="font-medium text-[#102033]">Idade:</span> {agriskImport.agriskReadPayload?.company?.age_years ?? "Não informado"}</p>
                    </div>
                  </div>

                  <div className="mb-6">
                    <p className="mb-3 border-b border-[#EEF3F8] pb-1.5 text-[10px] font-semibold uppercase tracking-[0.7px] text-[#295B9A]">Crédito</p>
                    <div className="space-y-1 text-[12px] text-[#4F647A]">
                      <p><span className="font-medium text-[#102033]">Score principal:</span> {agriskImport.agriskReadPayload?.credit?.score ?? "Não informado"}</p>
                      <p><span className="font-medium text-[#102033]">Fonte do score principal:</span> {scoreSourceLabel(agriskImport.agriskReadPayload?.credit?.score_source)}</p>
                      <p><span className="font-medium text-[#102033]">Rating:</span> {agriskImport.agriskReadPayload?.credit?.rating || "Não informado"}</p>
                      <p><span className="font-medium text-[#102033]">Probabilidade de inadimplência:</span> {agriskImport.agriskReadPayload?.credit?.default_probability != null ?`${(agriskImport.agriskReadPayload.credit.default_probability * 100).toFixed(1).replace(".", ",")}%` : "Não informado"}</p>
                      <p><span className="font-medium text-[#102033]">Classificação:</span> {agriskImport.agriskReadPayload?.credit?.default_probability_label || "Não informado"}</p>
                    </div>
                  </div>

                  <div className="mb-6">
                    <p className="mb-3 border-b border-[#EEF3F8] pb-1.5 text-[10px] font-semibold uppercase tracking-[0.7px] text-[#295B9A]">Restritivos</p>
                    <div className="space-y-1 text-[12px] text-[#4F647A]">
                      <p><span className="font-medium text-[#102033]">Quantidade:</span> {agriskImport.agriskReadPayload?.restrictions?.negative_events_count ?? 0}</p>
                      <p><span className="font-medium text-[#102033]">Valor total:</span> {agriskImport.agriskReadPayload?.restrictions?.negative_events_total_amount != null ?`R$ ${agriskImport.agriskReadPayload.restrictions.negative_events_total_amount.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "Não informado"}</p>
                      <p><span className="font-medium text-[#102033]">Último apontamento:</span> {agriskImport.agriskReadPayload?.restrictions?.last_negative_event_at || "Não informado"}</p>
                    </div>
                  </div>

                  <div className="mb-6">
                    <p className="mb-3 border-b border-[#EEF3F8] pb-1.5 text-[10px] font-semibold uppercase tracking-[0.7px] text-[#295B9A]">Protestos / CCF</p>
                    <div className="space-y-1 text-[12px] text-[#4F647A]">
                      <p><span className="font-medium text-[#102033]">Protestos:</span> {agriskImport.agriskReadPayload?.protests?.count ?? 0}</p>
                      <p><span className="font-medium text-[#102033]">Valor total de protestos:</span> {agriskImport.agriskReadPayload?.protests?.total_amount != null ?`R$ ${agriskImport.agriskReadPayload.protests.total_amount.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "R$ 0,00"}</p>
                      <p><span className="font-medium text-[#102033]">CCF com registros:</span> {agriskImport.agriskReadPayload?.checks_without_funds?.has_records ?"Sim" : "Não"}</p>
                    </div>
                  </div>

                  <div className="mb-6">
                    <p className="mb-3 border-b border-[#EEF3F8] pb-1.5 text-[10px] font-semibold uppercase tracking-[0.7px] text-[#295B9A]">Consultas</p>
                    <p className="text-[12px] text-[#4F647A]"><span className="font-medium text-[#102033]">Total de consultas:</span> {agriskImport.agriskReadPayload?.consultations?.total ?? 0}</p>
                  </div>

                  <div className="mb-6">
                    <p className="mb-3 border-b border-[#EEF3F8] pb-1.5 text-[10px] font-semibold uppercase tracking-[0.7px] text-[#295B9A]">Societário</p>
                    <div className="space-y-1 text-[12px] text-[#4F647A]">
                      {(agriskImport.agriskReadPayload?.ownership?.shareholding ?? []).length > 0 ?(
                        (agriskImport.agriskReadPayload?.ownership?.shareholding ?? []).map((item) => <p key={item}>{item}</p>)
                      ) : (
                        <p>Sem participações societárias estruturadas.</p>
                      )}
                    </div>
                  </div>

                  <div>
                    <p className="mb-3 border-b border-[#EEF3F8] pb-1.5 text-[10px] font-semibold uppercase tracking-[0.7px] text-[#295B9A]">Qualidade da leitura</p>
                    <div className="space-y-1 text-[12px] text-[#4F647A]">
                      <p><span className="font-medium text-[#102033]">Confiança:</span> {confidenceLabel(cofaceImport.cofaceReadPayload?.read_quality?.confidence)}</p>
                      {(agriskImport.agriskWarnings ?? []).length > 0 ?(
                        <div className="mt-2 rounded-[10px] border border-[#F3D7A1] bg-[#FFF7E8] p-3">
                          <p className="text-[12px] font-semibold text-[#92400E]">Alertas de leitura</p>
                          <p className="mt-1 text-[11px] text-[#7C5A1D]">
                            Alguns blocos esperados não foram encontrados, mas a leitura principal foi concluída.
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
                    <p className="text-[15px] font-semibold text-[#102033]">Dados importados do relatório COFACE</p>
                    <p className="text-[12px] text-[#4F647A]">Somente os dados estruturados utilizados pelo motor de crédito.</p>
                  </div>
                  <button type="button" onClick={() => setIsCofaceDataDrawerOpen(false)} className="flex h-7 w-7 items-center justify-center rounded-full border border-[#D7E1EC] bg-[#F7F9FC] text-[#4F647A]">
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto px-6 py-5">
                  <div className="mb-6">
                    <p className="mb-3 border-b border-[#EEF3F8] pb-1.5 text-[10px] font-semibold uppercase tracking-[0.7px] text-[#295B9A]">Identificação</p>
                    <div className="space-y-1 text-[12px] text-[#4F647A]">
                      <p><span className="font-medium text-[#102033]">Empresa:</span> {cofaceImport.cofaceReadPayload?.company?.name || "Não informado"}</p>
                      <p><span className="font-medium text-[#102033]">CNPJ:</span> {formatCnpjForDisplay(cofaceImport.cofaceReadPayload?.company?.document)}</p>
                      <p><span className="font-medium text-[#102033]">EasyNumber:</span> {cofaceImport.cofaceReadPayload?.coface?.easy_number || "Não informado"}</p>
                      <p><span className="font-medium text-[#102033]">Endereço:</span> {cofaceImport.cofaceReadPayload?.company?.address || "Não informado"}</p>
                    </div>
                  </div>

                  <div className="mb-6">
                    <p className="mb-3 border-b border-[#EEF3F8] pb-1.5 text-[10px] font-semibold uppercase tracking-[0.7px] text-[#295B9A]">Indicadores COFACE</p>
                    <div className="space-y-1 text-[12px] text-[#4F647A]">
                      <p><span className="font-medium text-[#102033]">CRA:</span> {cofaceImport.cofaceReadPayload?.coface?.cra || "Não informado"}</p>
                      <p><span className="font-medium text-[#102033]">DRA:</span> {cofaceImport.cofaceReadPayload?.coface?.dra ?? "Não informado"}</p>
                      <p><span className="font-medium text-[#102033]">Notação:</span> {cofaceImport.cofaceReadPayload?.coface?.notation || "Não informado"}</p>
                    </div>
                  </div>

                  <div className="mb-6">
                    <p className="mb-3 border-b border-[#EEF3F8] pb-1.5 text-[10px] font-semibold uppercase tracking-[0.7px] text-[#295B9A]">Decisão de crédito</p>
                    <div className="space-y-1 text-[12px] text-[#4F647A]">
                      <p><span className="font-medium text-[#102033]">Estado:</span> {cofaceImport.cofaceReadPayload?.coface?.decision_status || "Não informado"}</p>
                      <p><span className="font-medium text-[#102033]">Valor Segurado:</span> {cofaceImport.cofaceReadPayload?.coface?.decision_amount != null ?`R$ ${cofaceImport.cofaceReadPayload.coface.decision_amount.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "Não informado"}</p>
                      <p><span className="font-medium text-[#102033]">Data efetiva:</span> {formatIsoDateToBr(cofaceImport.cofaceReadPayload?.coface?.decision_effective_date)}</p>
                    </div>
                  </div>

                  <div>
                    <p className="mb-3 border-b border-[#EEF3F8] pb-1.5 text-[10px] font-semibold uppercase tracking-[0.7px] text-[#295B9A]">Qualidade da leitura</p>
                    <div className="space-y-1 text-[12px] text-[#4F647A]">
                      <p><span className="font-medium text-[#102033]">Confiança:</span> {confidenceLabel(cofaceImport.cofaceReadPayload?.read_quality?.confidence)}</p>
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
                            {hasAgriskImported ?"Agrisk  indisponível (já importado)" : "Agrisk"}
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
                      {hasCofaceImported ?<span className="mt-1 block text-[10px] text-[#8FA3B4]">DRA COFACE já informado por relatório importado.</span> : null}
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

      
{step === 3 ?(
        <div className="space-y-3">
          <article className="space-y-3 rounded-[10px] border border-[#e2e5eb] bg-white p-4">
            <p className="text-[13px] font-medium text-[#111827]">Solicita??o atual</p>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <label className="text-[11px] text-[#374151]">Limite solicitado<RequiredMark /><input value={analysis.requestedLimit} onFocus={() => { isRequestedLimitFocusedRef.current = true; const numericValue = toNumberInput(analysis.requestedLimit); setAnalysis((prev) => ({ ...prev, requestedLimit: numericValue > 0 ? String(numericValue).replace(".", ",") : "" })); }} onChange={(event) => setAnalysis((prev) => ({ ...prev, requestedLimit: normalizeRequestedLimitDraft(event.target.value) }))} onBlur={(event) => { isRequestedLimitFocusedRef.current = false; commitRequestedLimit(event.currentTarget.value); }} className="mt-1 h-9 w-full rounded-[6px] border px-3 text-[12px]" /></label>
              <label className="text-[11px] text-[#374151]">Analista respons?vel
                <input value={analysis.assignedAnalystName} readOnly className="mt-1 h-9 w-full rounded-[6px] border bg-[#f9fafb] px-3 text-[12px] text-[#6b7280]" />
              </label>
              <label className="text-[11px] text-[#374151] md:col-span-2 xl:col-span-3">Coment?rio / justificativa
                <textarea value={analysis.comment} onChange={(event) => setAnalysis((prev) => ({ ...prev, comment: event.target.value }))} className="mt-1 min-h-16 w-full rounded-[6px] border px-3 py-2 text-[12px]" />
              </label>
            </div>
          </article>

          {hasInternalFinancialSnapshot ?(
            <article className="space-y-3 rounded-[10px] border border-[#e2e5eb] bg-white p-4">
              <p className="text-[13px] font-medium text-[#111827]">Contexto atual do cliente</p>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <label className="text-[11px] text-[#374151]">Limite atual
                  <input value={formatCurrencyBRL(String(internalTotalLimit))} readOnly className="mt-1 h-9 w-full rounded-[6px] border bg-[#f9fafb] px-3 text-[12px] text-[#6b7280]" />
                </label>
                <label className="text-[11px] text-[#374151]">Limite utilizado
                  <input value={formatCurrencyBRL(String(internalOpenAmount))} readOnly className="mt-1 h-9 w-full rounded-[6px] border bg-[#f9fafb] px-3 text-[12px] text-[#6b7280]" />
                </label>
                <label className="text-[11px] text-[#374151]">Limite dispon?vel
                  <input value={formatCurrencyBRL(String(internalAvailableLimit))} readOnly className="mt-1 h-9 w-full rounded-[6px] border bg-[#f9fafb] px-3 text-[12px] text-[#6b7280]" />
                </label>
                <label className="text-[11px] text-[#374151]">Exposi??o
                  <input value={formatCurrencyBRL(String(internalExposure))} readOnly className="mt-1 h-9 w-full rounded-[6px] border bg-[#f9fafb] px-3 text-[12px] text-[#6b7280]" />
                </label>
                {internalOverdue !== null ?(
                  <label className="text-[11px] text-[#374151]">Overdue
                    <input value={formatCurrencyBRL(String(internalOverdue))} readOnly className="mt-1 h-9 w-full rounded-[6px] border bg-[#f9fafb] px-3 text-[12px] text-[#6b7280]" />
                  </label>
                ) : null}
                {internalNotDue !== null ?(
                  <label className="text-[11px] text-[#374151]">Not due
                    <input value={formatCurrencyBRL(String(internalNotDue))} readOnly className="mt-1 h-9 w-full rounded-[6px] border bg-[#f9fafb] px-3 text-[12px] text-[#6b7280]" />
                  </label>
                ) : null}
                {internalOperationalStatus ?(
                  <label className="text-[11px] text-[#374151]">Status operacional
                    <input value={internalOperationalStatus} readOnly className="mt-1 h-9 w-full rounded-[6px] border bg-[#f9fafb] px-3 text-[12px] text-[#6b7280]" />
                  </label>
                ) : null}
                <label className="text-[11px] text-[#374151]">Comportamento interno
                  <input value={internalBehaviorLabel} readOnly className="mt-1 h-9 w-full rounded-[6px] border bg-[#f9fafb] px-3 text-[12px] text-[#6b7280]" />
                </label>
                <label className="text-[11px] text-[#374151]">Varia??o solicitada
                  <input value={formatCurrencyBRL(String(toNumberInput(analysis.requestedLimit) - internalTotalLimit))} readOnly className="mt-1 h-9 w-full rounded-[6px] border bg-[#f9fafb] px-3 text-[12px] text-[#6b7280]" />
                </label>
              </div>
            </article>
          ) : null}

          {(hasCofaceImported || hasCofaceCoverageImported) ?(
            <article className="space-y-3 rounded-[10px] border border-[#e2e5eb] bg-white p-4">
              <p className="text-[13px] font-medium text-[#111827]">Cobertura / garantia</p>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {hasCofaceCoverageImported ?(
                  <label className="text-[11px] text-[#374151]">Limite com garantia
                    <input value={guaranteeDisplayText} readOnly className="mt-1 h-9 w-full rounded-[6px] border bg-[#f9fafb] px-3 text-[12px] text-[#6b7280]" />
                  </label>
                ) : null}
                {hasCofaceCoverageImported ?(
                  <label className="text-[11px] text-[#374151]">Valor de cobertura COFACE
                    <input value={guaranteeDisplayText} readOnly className="mt-1 h-9 w-full rounded-[6px] border bg-[#f9fafb] px-3 text-[12px] text-[#6b7280]" />
                  </label>
                ) : null}
                {cofaceImport.cofaceReadPayload?.coface?.dra != null ?(
                  <label className="text-[11px] text-[#374151]">DRA COFACE
                    <input value={String(cofaceImport.cofaceReadPayload.coface.dra)} readOnly className="mt-1 h-9 w-full rounded-[6px] border bg-[#f9fafb] px-3 text-[12px] text-[#6b7280]" />
                  </label>
                ) : null}
                {cofaceImport.cofaceReadPayload?.coface?.notation ?(
                  <label className="text-[11px] text-[#374151]">Rating / decis?o
                    <input value={cofaceImport.cofaceReadPayload.coface.notation} readOnly className="mt-1 h-9 w-full rounded-[6px] border bg-[#f9fafb] px-3 text-[12px] text-[#6b7280]" />
                  </label>
                ) : null}
                {cofaceImport.cofaceReadPayload?.coface?.decision_effective_date ?(
                  <label className="text-[11px] text-[#374151]">Validade
                    <input value={formatIsoDateToBr(cofaceImport.cofaceReadPayload.coface.decision_effective_date)} readOnly className="mt-1 h-9 w-full rounded-[6px] border bg-[#f9fafb] px-3 text-[12px] text-[#6b7280]" />
                  </label>
                ) : null}
              </div>
            </article>
          ) : null}
        </div>
      ) : null}

      {step === 4 ?(
        <div className="bg-[#F7F9FC] px-7 py-6">
          <div className="mb-5">
            <p className="text-[16px] font-semibold text-[#102033]">Revisão e envio para análise</p>
            <p className="mt-1 text-[12px] leading-relaxed text-[#4F647A]">
              Confira os dados do cliente, os limites vigentes, o valor solicitado e as fontes de informação antes de acionar o motor de crédito.
            </p>
          </div>

          <div className="mb-5 flex items-center rounded-[12px] border border-[#D7E1EC] bg-white px-6 py-4">
            {["Identificação", "Informações para análise", "Dados da solicitação", "Revisão e envio"].map((label, index) => {
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
                  <p className="text-[12px] font-semibold text-[#102033]">Contato do cliente</p>
                  <span className="rounded-[5px] border border-[#B5D4F4] bg-[#EEF3F8] px-2 py-0.5 text-[10px] font-medium text-[#295B9A]">Cadastro verificado</span>
                </div>
                <div className="grid grid-cols-1 gap-3 text-[12px] sm:grid-cols-2">
                  <div className="sm:col-span-2"><p className="text-[10px] uppercase text-[#8FA3B4]">Razão social</p><p className="text-[13px] font-medium text-[#102033]">{customer.companyName || "Não informado"}</p></div>
                  <div><p className="text-[10px] uppercase text-[#8FA3B4]">CNPJ</p><p className="text-[13px] font-medium text-[#102033]">{customer.cnpj || "Não informado"}</p></div>
                  <div><p className="text-[10px] uppercase text-[#8FA3B4]">Pessoa de contato</p><p className="text-[13px] font-medium text-[#102033]">{contactName || "Não informado"}</p></div>
                  <div><p className="text-[10px] uppercase text-[#8FA3B4]">Telefone do contato</p><p className="text-[13px] text-[#4F647A]">{contactPhone || "Não informado"}</p></div>
                  <div><p className="text-[10px] uppercase text-[#8FA3B4]">E-mail do contato</p><p className="text-[13px] text-[#4F647A]">{contactEmail || "Não informado"}</p></div>
                  <div><p className="text-[10px] uppercase text-[#8FA3B4]">Analista responsável</p><p className="text-[13px] font-medium text-[#102033]">{analysis.assignedAnalystName || "Não informado"}</p></div>
                </div>
              </article>

              <article className="rounded-[14px] border border-[#D7E1EC] bg-white p-5">
                <p className="mb-4 text-[12px] font-semibold text-[#102033]">Posição de limites e solicitação</p>
                <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div className="rounded-[10px] border border-[#0D1B2A] bg-[#0D1B2A] px-4 py-3">
                    <p className="text-[10px] uppercase text-[rgba(255,255,255,0.45)]">Valor solicitado</p>
                    <p className="mt-1 text-[16px] font-semibold text-[#75D4EE]">{formatCurrencyBRL(analysis.requestedLimit)}</p>
                    <p className="mt-1 text-[10px] text-[rgba(255,255,255,0.35)]">Aguarda aprovação</p>
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
                    <div><p className="text-[10px] uppercase text-[#8FA3B4]">Exposição atual</p><p className={`mt-1 text-[14px] font-semibold ${hasPositiveExposure ?"text-[#92580A]" : "text-[#102033]"}`}>{exposureDisplay}</p></div>
                  </div>
                </div>
              </article>

              <article className="rounded-[14px] border border-[#D7E1EC] bg-white p-5">
                <div className="mb-4 flex items-center justify-between">
                  <p className="text-[12px] font-semibold text-[#102033]">Fontes de informação consolidadas</p>
                  <p className="text-[11px] text-[#8FA3B4]">{consolidatedSourcesSentCount} de {consolidatedSources.length} enviadas</p>
                </div>
                <div className="space-y-2">
                  {consolidatedSources.map((source) => (
                    <div key={source.key} className={`flex items-center gap-3 rounded-[10px] border px-3 py-2.5 ${source.isSent ?"border-[#A7DDB8] bg-[#F0FBF5]" : "border-[#D7E1EC] bg-[#F7F9FC] opacity-75"}`}>
                      <span className={`h-2 w-2 rounded-full ${source.isSent ?"bg-[#1EBD6A]" : "bg-[#C4CDD6]"}`} />
                      <div className="min-w-0 flex-1"><p className={`text-[12px] font-medium ${source.isSent ?"text-[#102033]" : "text-[#8FA3B4]"}`}>{source.name}</p><p className={`truncate text-[11px] ${source.isSent ?"text-[#4F647A]" : "text-[#C4CDD6]"}`}>{source.detail}</p></div>
                      <span className={`rounded-[5px] border px-2 py-0.5 text-[10px] font-medium ${source.isSent ?"border-[#A7DDB8] bg-[#E6F4ED] text-[#1A7A3A]" : "border-[#D7E1EC] bg-[#F7F9FC] text-[#4F647A]"}`}>{source.isSent ?"Enviado" : "Não selecionado"}</span>
                    </div>
                  ))}
                </div>
              </article>
            </div>

            <aside className="space-y-4">
              <article className="rounded-[14px] border border-[#D7E1EC] bg-white p-5">
                <p className="mb-3 text-[12px] font-semibold text-[#102033]">Analista responsável</p>
                <div className="mb-3 flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#295B9A] text-[12px] font-semibold text-white">{toInitials(analysis.assignedAnalystName || "Backoffice")}</div><div><p className="text-[13px] font-medium text-[#102033]">{analysis.assignedAnalystName || "Backoffice"}</p><p className="text-[11px] text-[#8FA3B4]">Cadastro e consolidação</p></div></div>
                <p className="mb-1 text-[10px] uppercase tracking-[0.5px] text-[#8FA3B4]">Comentário</p>
                <div className="min-h-[64px] rounded-[8px] border border-[#D7E1EC] bg-[#F7F9FC] px-3 py-2 text-[12px] italic text-[#8FA3B4]">{analysis.comment.trim() || "Sem comentário registrado para esta análise."}</div>
              </article>

              <article className="rounded-[14px] border border-[#D7E1EC] bg-white p-5">
                <p className="mb-3 text-[12px] font-semibold text-[#102033]">Pré-validação</p>
                <div className="space-y-2.5 text-[12px]">
                  <p className={customerReady ?"text-[#102033]" : "text-[#92580A]"}>{customerReady ?"✓ " : "! "}Cliente identificado e vinculado</p>
                  <p className={requestedLimitReady ?"text-[#102033]" : "text-[#92580A]"}>{requestedLimitReady ?"✓ " : "! "}Valor solicitado informado</p>
                  <p className={consolidatedSourcesSentCount > 0 ?"text-[#102033]" : "text-[#92580A]"}>{consolidatedSourcesSentCount > 0 ?"✓ " : "! "}Ao menos 1 fonte enviada</p>
                  <p className={manualStatus === "preenchido" ?"text-[#102033]" : "text-[#92580A]"}>{manualStatus === "preenchido" ?"✓ Dados manuais preenchidos" : "! Dados manuais não preenchidos"}</p>
                  <p className="text-[#4F647A]">{ocr.files.length > 0 ?"✓ OCR demonstrativos - opcional" : "- OCR demonstrativos - opcional"}</p>
                </div>
              </article>

              <article className={`rounded-[14px] border p-5 ${submitBlockingError ?"border-[#F5D06A] bg-[#FEF9EC]" : "border-[#B5D4F4] bg-[#EEF3F8]"}`}>
                <p className={`text-[12px] font-semibold ${submitBlockingError ?"text-[#92580A]" : "text-[#0C447C]"}`}>{submitBlockingError ?"Pendências para acionar o motor" : "Pronto para acionar o motor"}</p>
                <p className={`mt-1 text-[11px] leading-relaxed ${submitBlockingError ?"text-[#92580A]" : "text-[#185FA5]"}`}>
                  {submitBlockingError
                    ?`Revise este ponto antes de enviar: ${submitBlockingError}`
                    : 'As informações mínimas foram consolidadas. Clique em "Enviar para análise" para acionar o motor de crédito.'}
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
              ?"Relatório AgRisk inválido: esse insumo não será usado até o envio de um arquivo válido."
              : "Selecione ao menos uma fonte de dados para Avançar"}
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
      ) : step === 4 ?(
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-[#D7E1EC] bg-white px-7 py-4">
          <div className="flex items-center gap-2 text-[11px] text-[#8FA3B4]">
            <span className="flex h-4 w-4 items-center justify-center rounded-full border border-[#8FA3B4] text-[9px]">i</span>
            Ao enviar, o motor de crédito será acionado automaticamente com as informações consolidadas.
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
              {submitMutation.isPending ?"Enviando..." : "Enviar para análise"}
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
              Avançar
            </button>
          ) : (
            <button type="button" onClick={submit} disabled={submitMutation.isPending} className="rounded-[6px] bg-[#059669] px-3 py-2 text-[12px] font-medium text-white disabled:opacity-50">
              {submitMutation.isPending ?"Enviando..." : "Enviar para análise"}
            </button>
          )}
        </div>
      )}
      </div>
      {triageModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-md [animation:overlayFadeIn_.18s_ease-out]">
          <div className="flex max-h-[90vh] w-full max-w-[620px] flex-col overflow-hidden rounded-[20px] border border-[#D7E1EC] bg-white shadow-[0_22px_60px_rgba(2,6,23,0.28)] [animation:modalIn_.2s_ease-out]">
            <div className="flex items-start justify-between border-b border-[#D7E1EC] px-8 pb-6 pt-7">
              <div className="flex items-center gap-3.5">
                <div className="flex h-[42px] w-[42px] items-center justify-center rounded-[12px] bg-[#1B3A6B]">
                  <CreditCard className="h-5 w-5 text-white" />
                </div>
                <div>
                  <p className="mb-0.5 text-[17px] font-medium text-[#102033]">Nova solicitação de crédito</p>
                  <p className="text-[13px] text-[#4F647A]">Informe o CNPJ para localizar ou cadastrar um cliente</p>
                </div>
              </div>
              <Link href="/analises" className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-[#D7E1EC] text-[#4F647A] hover:bg-[#F7F9FC]">
                <X className="h-4 w-4" />
              </Link>
            </div>

            <div className="flex flex-col gap-5 overflow-y-auto px-8 py-6">
              {!canCreateRequest ? <div className="rounded-[8px] border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-[12px] text-[#B91C1C]">Você não possui permissão para criar solicitações de crédito.</div> : null}

              <div className="flex flex-col gap-1.5">
                <span className="text-[12px] font-medium uppercase tracking-[0.05em] text-[#4F647A]">CNPJ</span>
                <div className="flex gap-2.5">
                  <input value={customer.cnpj} onChange={(event) => {
                    setTriageState("idle");
                    setTriageMessage(null);
                    setTriageResult(null);
                    setGovernanceStatus(null);
                    setDraftAnalysisId(null);
                    setDraftCnpj(null);
                    setTriageSelectedBusinessUnit("");
                    setCustomer((prev) => ({ ...prev, cnpj: formatCnpj(event.target.value) }));
                  }} className="h-11 flex-1 rounded-[10px] border border-[#D7E1EC] px-3.5 font-mono text-[15px] tracking-[0.03em] text-[#102033] focus:border-[#1B3A6B] focus:outline-none" placeholder="00.000.000/0000-00" />
                  <button type="button" disabled={!canCreateRequest || triageLookupMutation.isPending || createDraftMutation.isPending} onClick={handleTriageLookup} className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-[#1B3A6B] px-5 text-[14px] font-medium text-white transition hover:bg-[#152E56] disabled:opacity-50">
                    <Search className="h-4 w-4" />
                    {triageLookupMutation.isPending || createDraftMutation.isPending ? "Preparando..." : "Consultar"}
                  </button>
                </div>
              </div>

              {triageMessage ? (
                <div className={`flex items-center gap-2 rounded-[10px] border px-3.5 py-2.5 text-[13px] ${triageState === "error" ? "border-[#F5B5B5] bg-[#FEF2F2] text-[#B91C1C]" : "border-[#34A873] bg-[#F0FAF5] text-[#1A6644]"}`}>
                  <span className={`h-[7px] w-[7px] rounded-full ${triageState === "error" ? "bg-[#B91C1C]" : "bg-[#34A873]"}`} />
                  <span>{triageMessage}</span>
                </div>
              ) : null}
            </div>

            <div className="flex items-center gap-1.5 border-t border-[#D7E1EC] bg-[#F7F9FC] px-8 py-2.5 text-[12px] text-[#8FA3B4]">
              <Info className="h-3.5 w-3.5" />
              Última análise: {triageResult?.last_analysis?.date ? new Date(triageResult.last_analysis.date).toLocaleDateString("pt-BR") : "sem registro"} · Status: {triageResult?.last_analysis?.status ?? "—"}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-[#D7E1EC] px-8 pb-6 pt-5">
              <span className="inline-flex items-center gap-1.5 text-[12px] text-[#8FA3B4]">
                <Lock className="h-3.5 w-3.5" />
                Dados protegidos e auditados
              </span>
              <div className="flex gap-2.5">
                <Link href="/analises" className="inline-flex h-[42px] items-center rounded-[10px] border border-[#D7E1EC] px-5 text-[14px] font-medium text-[#4F647A] hover:bg-[#F7F9FC]">Cancelar</Link>
                <button type="button" onClick={() => setTriageModalOpen(false)} className="inline-flex h-[42px] items-center gap-2 rounded-[10px] bg-[#1B3A6B] px-5 text-[14px] font-medium text-white transition hover:bg-[#152E56]">
                  Fechar
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      <style jsx>{`
        @keyframes overlayFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes modalIn {
          from {
            opacity: 0;
            transform: scale(0.985);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
      `}</style>
    </section>
  );
}






