"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Banknote, BarChart3, Building2, CalendarDays, Check, ChevronLeft, ChevronRight, CircleAlert, CreditCard, FileText, FolderOpen, Info, LineChart, Lock, ReceiptText, Search, ShieldCheck, Upload, X } from "lucide-react";

import { checkExistingCreditAnalysis, createCommercialReference, createCreditAnalysisDraft, deleteAnalysisDocument, deleteCommercialReference, discardCreditAnalysisDraft, downloadAnalysisDocument, getAgriskReportRead, getAnalysisRequestMetadata, getCofaceReportRead, listAnalysisDocuments, listAnalysisReportReads, listCommercialReferences, lookupExternalCnpj, readAgriskReport, readCofaceReport, recoverCreditAnalysisDraft, saveAnalysisRequestMetadata, submitAnalysisJourney, submitTriageCreditRequest, triageCreditRequest, uploadAnalysisDocument } from "@/features/analysis-journey/api/analysis-journey.api";
import { AgriskImportStatus, AgriskReportReadResponse, AgriskReportType, AnalysisDocumentDto, AnalysisJourneySubmitRequest, AnalysisReportReadSummaryDto, CofaceReportReadResponse, CommercialReference, CreditAnalysisDraftRecoveryResponse, CreditAnalysisExistingCheckResponse, CreditAnalysisTriageSubmitRequest, CreditAnalysisTriageResponse, UploadFileMetadataInput } from "@/features/analysis-journey/api/contracts";
import { InstitutionalScoreCard } from "@/features/analysis-journey/components/institutional-score-card";
import { RecommendationInsightsCard } from "@/features/analysis-journey/components/recommendation-insights-card";
import { ApprovalWorkflowActionBar, ApprovalWorkflowCard, useApprovalWorkflowController } from "@/features/credit-analyses/components/approval-workflow-card";
import { getCreditAnalysisWorkspaceRoute } from "@/features/credit-analyses/utils/routes";
import { calculateCreditAnalysisDecision, calculateCreditAnalysisScore, executeCreditAnalysisWorkflowAction, getCreditAnalysisDetail, resetCreditAnalysisOperationalData, startCreditAnalysis, updateCreditAnalysisJourneyProgress, updateCreditAnalysisWorkspaceState } from "@/features/credit-analyses/api/credit-analyses.api";
import type { ScorePillarItemDto, ScorePillarsDto } from "@/features/credit-analyses/api/contracts";
import { executiveScore10ToPercent, formatExecutiveScore10, resolveExecutiveScore10 } from "@/features/credit-analyses/utils/score-scale";
import { createExternalDataEntry, getExternalDataDashboard } from "@/features/external-data/api/external-data.api";
import { getPortfolioCustomers } from "@/features/portfolio/api/portfolio.api";
import {
  formatCnpj,
  formatCurrencyInputBRL,
  sanitizeDigits,
  toNullableNumberInput,
  toNumberInput
} from "@/features/analysis-journey/utils/formatters";
import { resolveExecutiveAgingComposition } from "@/features/analysis-journey/utils/internal-portfolio-aging-executive";
import { resolveInternalPortfolioSummaryFromSources } from "@/features/analysis-journey/utils/internal-portfolio-summary";
import { formatCurrencyBRL, resolveManualStatus, resolveUploadStatus } from "@/features/analysis-journey/utils/view-models";
import {
  TECHNICAL_CONTINUATION_ACTIONS,
  resolveAnalysisJourneyReadOnly,
  resolveTechnicalWorkspaceEditCapability,
} from "@/features/analysis-journey/utils/workspace-readonly";
import { ErrorState } from "@/shared/components/states/error-state";
import { getEffectivePermissions, hasPermission } from "@/shared/lib/auth/permissions";
import { getCurrentUserDisplayName } from "@/shared/lib/auth/current-user";

const steps = ["Identificação do cliente", "Coleta de informações", "Mesa de análise", "Revisão e envio"];
const AGRISK_SCORE_RISK: AgriskReportType = "AGRISK_SCORE_RISK";
const AGRISK_FINANCIAL_ANALYSIS: AgriskReportType = "AGRISK_FINANCIAL_ANALYSIS";
type ImportSource = "agrisk" | "agrisk_financial" | "coface";
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

type TechnicalInsight = {
  kind: "positivo" | "alerta" | "critico";
  text: string;
};

type PolicyPillarStatus = "Forte" | "Adequado" | "Atenção" | "Crítico" | "Informações insuficientes";

type PolicyPillar = {
  key: string;
  title: string;
  weight: number;
  score: number | null;
  status: PolicyPillarStatus;
  summary: string;
  sources: string[];
  criteria: string[];
  explanation: string;
  tooltip: {
    title: string;
    description: string;
    source: string;
    note: string;
    weightLabel?: string;
  };
};

type InstitutionalScoreBreakdownItem = {
  key: string;
  title: string;
  weight: number;
  score: number | null;
  weighted: number | null;
  tooltip: PolicyPillar["tooltip"];
};

type ScorePillarDefinition = {
  code: string;
  aliases: string[];
  key: string;
  title: string;
  weight: number;
  description: string;
};

const SCORE_PILLAR_DEFINITIONS: ScorePillarDefinition[] = [
  {
    code: "financial_stability_liquidity",
    aliases: ["financial_liquidity"],
    key: "financial_liquidity",
    title: "Estabilidade Financeira e Liquidez",
    weight: 55,
    description: "Avalia a robustez financeira por demonstracoes financeiras, liquidez, endividamento e geracao de caixa.",
  },
  {
    code: "guarantees_credit_insurance",
    aliases: ["guarantees"],
    key: "guarantees",
    title: "Garantias / Seguro de Credito",
    weight: 20,
    description: "Avalia o nivel de mitigacao do risco da operacao por cobertura COFACE, exposicao liquida nao coberta e garantias estruturadas.",
  },
  {
    code: "market_conditions",
    aliases: [],
    key: "market_conditions",
    title: "Condicoes de Mercado",
    weight: 15,
    description: "Avalia fatores externos relacionados ao ambiente de atuacao do cliente, como setor, mercado e condicoes macroeconomicas.",
  },
  {
    code: "payment_history",
    aliases: [],
    key: "payment_history",
    title: "Historico de Pagamento",
    weight: 5,
    description: "Avalia o comportamento de credito do cliente com base nos sinais de pagamento disponiveis.",
  },
  {
    code: "relationship_history",
    aliases: [],
    key: "relationship_history",
    title: "Historico de Relacionamento",
    weight: 5,
    description: "Avalia o relacionamento interno do cliente com a empresa, considerando carteira, exposicao atual e comportamento interno.",
  },
];

type InternalEconomicPosition = {
  open_amount: number | string;
  total_limit: number | string;
  available_limit: number | string;
  overdue_amount?: number | string | null;
  not_due_amount?: number | string | null;
  base_date?: string | null;
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
  if (source === "agrisk" || source === "agrisk_financial") return "Origem: Agrisk";
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

type InstitutionalScoreBand = "AA" | "A" | "B" | "C" | "D" | "Informações insuficientes";

type ScoreBandVisualTokens = {
  badgeClass: string;
  textColor: string;
  accent: string;
  ring: string;
  glow: string;
};

function getScoreBandVisualTokens(scoreBand: InstitutionalScoreBand): ScoreBandVisualTokens {
  if (scoreBand === "AA") {
    return {
      badgeClass: "bg-[#EAF7EE] text-[#166534] border-[#BBF7D0]",
      textColor: "#166534",
      accent: "#2F6B57",
      ring: "#BBF7D0",
      glow: "shadow-[0_12px_30px_rgba(34,197,94,0.22)]"
    };
  }
  if (scoreBand === "A") {
    return {
      badgeClass: "bg-[#EDF6FF] text-[#1D4ED8] border-[#BFDBFE]",
      textColor: "#1D4ED8",
      accent: "#4B8B73",
      ring: "#BFDBFE",
      glow: "shadow-[0_12px_30px_rgba(37,99,235,0.20)]"
    };
  }
  if (scoreBand === "B") {
    return {
      badgeClass: "bg-[#EEF2FF] text-[#4338CA] border-[#C7D2FE]",
      textColor: "#E0E7FF",
      accent: "#3B5F9D",
      ring: "#4338CA",
      glow: "shadow-[0_10px_28px_rgba(79,70,229,0.14)]"
    };
  }
  if (scoreBand === "C") {
    return {
      badgeClass: "bg-[#FFF7E8] text-[#92400E] border-[#FDE68A]",
      textColor: "#92400E",
      accent: "#B9812C",
      ring: "#FDE68A",
      glow: "shadow-[0_12px_30px_rgba(217,119,6,0.20)]"
    };
  }
  if (scoreBand === "D") {
    return {
      badgeClass: "bg-[#FEF2F2] text-[#B91C1C] border-[#FECACA]",
      textColor: "#B91C1C",
      accent: "#B55252",
      ring: "#FECACA",
      glow: "shadow-[0_12px_30px_rgba(220,38,38,0.20)]"
    };
  }
  return {
    badgeClass: "bg-[#EEF3F8] text-[#4F647A] border-[#D7E1EC]",
    textColor: "#4F647A",
    accent: "#64748B",
    ring: "#D7E1EC",
    glow: "shadow-[0_10px_24px_rgba(100,116,139,0.16)]"
  };
}

function formatCnpjForDisplay(value: string | null | undefined) {
  const digits = sanitizeDigits(value ?? "");
  if (digits.length !== 14) return value || "Não informado";
  return formatCnpj(digits);
}

function formatCurrencyBRLNoCents(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(Math.round(value));
}

function formatCurrencyBRLCompactExecutive(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  const safe = Math.max(0, value);
  if (safe >= 1_000_000) {
    const mmValue = safe / 1_000_000;
    const rounded = Math.round(mmValue * 10) / 10;
    const formatted = Number.isInteger(rounded) ? String(Math.trunc(rounded)) : rounded.toFixed(1).replace(".", ",");
    return `R$ ${formatted}MM`;
  }
  if (safe >= 1_000) {
    const kValue = Math.round(safe / 1_000);
    return `R$ ${kValue}K`;
  }
  return `R$ ${Math.round(safe).toLocaleString("pt-BR")}`;
}

function formatCurrencyBRLMM2(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  const safe = Math.max(0, value);
  const mmValue = safe / 1_000_000;
  return `R$ ${mmValue.toFixed(2).replace(".", ",")}MM`;
}

function formatDoaBoundary(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "R$ 0,00";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return `R$ ${(value / 1_000_000).toFixed(2).replace(".", ",")}MM`;
  }
  if (abs >= 1_000) {
    return `R$ ${(value / 1_000).toFixed(2).replace(".", ",")}K`;
  }
  return `R$ ${value.toFixed(2).replace(".", ",")}`;
}

function formatDoaRangeExecutive(range: string | null | undefined): string {
  if (!range) return "—";
  const matches = range.match(/-?\d+(?:[.,]\d+)?/g);
  if (!matches || matches.length < 2) return range;
  const parseFlexible = (raw: string): number | null => {
    const hasComma = raw.includes(",");
    const hasDot = raw.includes(".");
    if (hasComma && hasDot) return Number(raw.replace(/\./g, "").replace(",", "."));
    if (hasComma) return Number(raw.replace(",", "."));
    return Number(raw);
  };
  const min = parseFlexible(matches[0]);
  const max = parseFlexible(matches[1]);
  if (min === null || max === null || !Number.isFinite(min) || !Number.isFinite(max)) return range;
  return `${formatDoaBoundary(min)} a ${formatDoaBoundary(max)}`;
}

function toNullableNumeric(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function pickNumberFromSources(
  sources: Array<Record<string, unknown> | null | undefined>,
  keys: string[]
): number | null {
  for (const source of sources) {
    if (!source) continue;
    for (const key of keys) {
      const parsed = toNullableNumeric(source[key]);
      if (parsed !== null) return parsed;
    }
  }
  return null;
}



type ManualIndicatorRow = {
  label: string;
  value: number | null;
  suffix?: string;
  source: "Agrisk Financeiro" | "Manual" | "Não disponível";
};

function safeRatio(numerator: number | null, denominator: number | null, percent = false): number | null {
  if (numerator === null || denominator === null || denominator === 0) return null;
  const value = numerator / denominator;
  return percent ? value * 100 : value;
}

function formatManualIndicator(value: number | null, suffix = "") {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}${suffix}`;
}

function normalizePillarCode(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function findScorePillarItem(contract: ScorePillarsDto | null | undefined, definition: ScorePillarDefinition): ScorePillarItemDto | null {
  if (!contract?.available) return null;
  const codes = new Set([definition.code, ...definition.aliases].map((item) => item.toLowerCase()));
  return contract.items.find((item) => codes.has(normalizePillarCode(item.code))) ?? null;
}

function statusFromScorePillarItem(item: ScorePillarItemDto | null, score: number | null): PolicyPillarStatus {
  if (!item) return "Informações insuficientes";
  if (item.status === "not_available") return "Informações insuficientes";
  if (score === null) return "Informações insuficientes";
  if (score >= 8) return "Forte";
  if (score >= 6) return "Adequado";
  if (score >= 4) return "Atenção";
  return "Crítico";
}

function sourceLabelFromScorePillarItem(item: ScorePillarItemDto | null): string {
  if (!item?.source) return "Motor de score configurável.";
  if (item.source === "coface") return "COFACE / motor configurável.";
  if (item.source === "agrisk_financial_analysis") return "Agrisk Financeiro / motor configurável.";
  if (item.source === "not_available") return "Motor configurável.";
  return `${item.source} / motor configurável.`;
}

function reasonFromScorePillarItem(item: ScorePillarItemDto | null): string {
  if (typeof item?.reason === "string" && item.reason.trim()) return item.reason;
  if (item?.status === "not_available") return "Informação insuficiente para cálculo do pilar.";
  if (item) return "Pilar calculado pelo backend configurável.";
  return "Pilar não retornado pelo contrato oficial do backend.";
}

function toScoreBand(score: number | null): InstitutionalScoreBand {
  if (score === null || Number.isNaN(score)) return "Informações insuficientes";
  if (score >= 9) return "AA";
  if (score >= 8) return "A";
  if (score >= 6) return "B";
  if (score >= 4) return "C";
  if (score >= 1) return "D";
  return "Informações insuficientes";
}

function toScoreBandClass(scoreBand: InstitutionalScoreBand) {
  return getScoreBandVisualTokens(scoreBand).badgeClass;
}

function scoreBandSemanticLabel(scoreBand: InstitutionalScoreBand) {
  if (scoreBand === "AA" || scoreBand === "A") return "Favorável";
  if (scoreBand === "B") return "Moderado";
  if (scoreBand === "C") return "Atenção";
  if (scoreBand === "D") return "Crítico";
  return "Não classificado";
}

function policyPillarStatusClass(status: PolicyPillarStatus) {
  if (status === "Forte") return "bg-[#EAF7EE] text-[#166534] border-[#BBF7D0]";
  if (status === "Adequado") return "bg-[#EDF6FF] text-[#1D4ED8] border-[#BFDBFE]";
  if (status === "Atenção") return "bg-[#FFF7E8] text-[#92400E] border-[#FDE68A]";
  if (status === "Crítico") return "bg-[#FEF2F2] text-[#B91C1C] border-[#FECACA]";
  return "bg-[#EEF3F8] text-[#4F647A] border-[#D7E1EC]";
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
  if (source === "agrisk_financial") return "Indicadores financeiros e conclusão da IA extraídos automaticamente.";
  if (source === "coface") return "DRA e indicadores corporativos extraídos automaticamente.";
  return "Dados estruturados para análise.";
}

function removeActionLabel(_: ImportSource) {
  return "Remover relatório";
}

function isAgriskValidatedImport(state: ImportState) {
  return state.status === "valid" || state.status === "valid_with_warnings";
}

function isValidatedReportRead(read: AnalysisReportReadSummaryDto | undefined) {
  return read?.status === "valid" || read?.status === "valid_with_warnings";
}

function pickCanonicalReportRead(reads: AnalysisReportReadSummaryDto[]) {
  return reads.find(isValidatedReportRead) ?? reads[0];
}

function isAgriskFinancialSource(source: ImportSource) {
  return source === "agrisk_financial";
}

function expectedAgriskReportType(source: ImportSource): AgriskReportType {
  return isAgriskFinancialSource(source) ? AGRISK_FINANCIAL_ANALYSIS : AGRISK_SCORE_RISK;
}

function normalizeAgriskReportType(value: string | null | undefined): AgriskReportType {
  return value === AGRISK_FINANCIAL_ANALYSIS ? AGRISK_FINANCIAL_ANALYSIS : AGRISK_SCORE_RISK;
}

function isExpectedAgriskReport(response: AgriskReportReadResponse, source: ImportSource) {
  return normalizeAgriskReportType(response.report_type ?? response.read_payload?.report_type) === expectedAgriskReportType(source);
}

function agriskSubreportTitle(source: ImportSource) {
  if (source === "agrisk_financial") return "Relatório de Análise Financeira";
  return "Relatório de Score/Risco";
}

function formatNullableNumber(value: number | null | undefined, suffix = "") {
  if (value === null || value === undefined || !Number.isFinite(value)) return "Não informado";
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}${suffix}`;
}

function AgriskSubreportPanel({
  source,
  state,
  onImport,
  onRemove,
  onView
}: {
  source: ImportSource;
  state: ImportState;
  onImport: () => void;
  onRemove: () => void;
  onView: () => void;
}) {
  const isReady = isAgriskValidatedImport(state) && Boolean(state.agriskReadPayload);
  const hasFile = state.files.length > 0;
  const isInvalid = state.status === "invalid" || state.status === "error";
  const fileName = state.files[0]?.original_filename ?? "Nenhum arquivo importado";
  const metadata = hasFile
    ? `${formatFileSize(state.files[0]?.file_size ?? 0)}${state.importedAt ? ` · ${formatImportedAt(state.importedAt)}` : ""}`
    : importMonitorValueText(source);
  const shortIssue = state.status === "invalid" && isDocumentDivergenceMessage(state.errorMessage)
    ? "CNPJ divergente"
    : state.status === "error"
      ? "Falha na leitura"
      : state.errorMessage;
  const detailText = isInvalid && shortIssue ? shortIssue : metadata;

  return (
    <div className="group py-2">
      <div className="flex min-w-0 items-start gap-2.5">
        <span className={`mt-1 h-8 w-0.5 shrink-0 rounded-full ${isReady ? "bg-[#10B981]" : isInvalid ? "bg-[#EF4444]" : "bg-[#D7E1EC]"}`} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <p className="truncate text-[11px] font-semibold leading-tight text-[#102033]">{agriskSubreportTitle(source)}</p>
            <span className={`shrink-0 rounded-full px-1.5 py-[1px] text-[9px] font-medium ${importStatusBadgeClass(state.status)}`}>
              {state.status === "empty" ? "Não importado" : agriskStatusBadgeLabel(state)}
            </span>
          </div>
          <p className="mt-0.5 truncate text-[10px] leading-tight text-[#4F647A]" title={fileName}>
            {fileName}
          </p>
          <p className={`mt-0.5 truncate text-[10px] leading-tight ${isInvalid ? "text-[#B91C1C]" : "text-[#64748B]"}`} title={isInvalid ? state.errorMessage ?? undefined : metadata}>
            {detailText}
          </p>
          {state.status === "valid_with_warnings" ? (
            <p className="mt-0.5 truncate text-[10px] leading-tight text-[#92400E]" title={state.agriskWarnings.join(" | ") || "Validado com alertas de leitura."}>
              Validado com alertas de leitura.
            </p>
          ) : null}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] font-medium">
          {isReady ? (
            <button type="button" onClick={onView} className="text-[#295B9A] underline-offset-2 hover:underline">
              Ver dados
            </button>
          ) : null}
          {isReady ? <span className="text-[#C5D1DD]">|</span> : null}
          <button type="button" onClick={onImport} className="text-[#295B9A] underline-offset-2 hover:underline">
            {hasFile ? "Substituir" : "Importar"}
          </button>
          {hasFile ? (
            <>
              <span className="text-[#C5D1DD]">|</span>
              <button type="button" onClick={onRemove} className="text-[#B91C1C] underline-offset-2 hover:underline">
                Remover
              </button>
            </>
          ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function formatIsoDateCompact(value: string | null | undefined) {
  if (!value) return "Não informado";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("pt-BR");
}

function formatMoneyFromPayload(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "Não informado";
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function AgriskFinancialDrawer({
  state,
  onClose
}: {
  state: ImportState;
  onClose: () => void;
}) {
  const payload = state.agriskReadPayload;
  const indicators = payload?.financial_indicators;
  const indicatorRows = [
    ["Liquidez Geral", formatNullableNumber(indicators?.liquidity_general)],
    ["Liquidez Corrente", formatNullableNumber(indicators?.liquidity_current)],
    ["Liquidez Imediata", formatNullableNumber(indicators?.liquidity_immediate)],
    ["Liquidez Seca", formatNullableNumber(indicators?.liquidity_quick)],
    ["Endividamento", formatNullableNumber(indicators?.indebtedness)],
    ["EBITDA", formatMoneyFromPayload(indicators?.ebitda)],
    ["Fluxo de Caixa", formatMoneyFromPayload(indicators?.cash_flow)],
    ["Margem Bruta", formatNullableNumber(indicators?.gross_margin, "%")],
    ["Índice Operacional", formatNullableNumber(indicators?.operational_index, "%")],
    ["Alavancagem Financeira", formatNullableNumber(indicators?.financial_leverage)],
    ["Resultado DRE", formatMoneyFromPayload(indicators?.dre_result)]
  ];

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-[#0D1B2A]/45" onClick={onClose}>
      <div className="flex h-full w-full max-w-[620px] flex-col bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-[#EEF3F8] px-6 py-5">
          <div>
            <p className="text-[15px] font-semibold text-[#102033]">Relatório Financeiro Agrisk</p>
            <p className="text-[12px] text-[#4F647A]">Dados estruturados da análise financeira importada.</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-full border border-[#D7E1EC] bg-[#F7F9FC] text-[#4F647A]">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="mb-6">
            <p className="mb-3 border-b border-[#EEF3F8] pb-1.5 text-[10px] font-semibold uppercase tracking-[0.7px] text-[#295B9A]">Empresa</p>
            <div className="grid gap-2 text-[12px] text-[#4F647A] md:grid-cols-2">
              <p><span className="font-medium text-[#102033]">Razão social:</span> {payload?.company?.name || "Não informado"}</p>
              <p><span className="font-medium text-[#102033]">CNPJ:</span> {payload?.company?.document || "Não informado"}</p>
              <p><span className="font-medium text-[#102033]">Porte:</span> {payload?.company?.company_size || "Não informado"}</p>
              <p><span className="font-medium text-[#102033]">Abertura:</span> {formatIsoDateCompact(payload?.company?.opened_at)}</p>
            </div>
          </div>

          <div className="mb-6">
            <p className="mb-3 border-b border-[#EEF3F8] pb-1.5 text-[10px] font-semibold uppercase tracking-[0.7px] text-[#295B9A]">Período analisado</p>
            <div className="grid gap-2 text-[12px] text-[#4F647A] md:grid-cols-2">
              <p><span className="font-medium text-[#102033]">Data inicial:</span> {formatIsoDateCompact(payload?.analysis_period?.start_date)}</p>
              <p><span className="font-medium text-[#102033]">Data final:</span> {formatIsoDateCompact(payload?.analysis_period?.end_date)}</p>
            </div>
          </div>

          <div className="mb-6">
            <p className="mb-3 border-b border-[#EEF3F8] pb-1.5 text-[10px] font-semibold uppercase tracking-[0.7px] text-[#295B9A]">Indicadores financeiros</p>
            <div className="grid gap-2 md:grid-cols-2">
              {indicatorRows.map(([label, value]) => (
                <div key={label} className="rounded-[8px] border border-[#E2EAF4] bg-[#F8FBFF] px-3 py-2">
                  <p className="text-[10px] uppercase tracking-[0.5px] text-[#8FA3B4]">{label}</p>
                  <p className="mt-1 text-[13px] font-semibold text-[#102033]">{value}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="mb-6">
            <p className="mb-3 border-b border-[#EEF3F8] pb-1.5 text-[10px] font-semibold uppercase tracking-[0.7px] text-[#295B9A]">Pontos Fortes</p>
            {(payload?.strengths ?? []).length > 0 ? (
              <ul className="list-disc space-y-2 pl-4 text-[12px] leading-relaxed text-[#4F647A]">
                {(payload?.strengths ?? []).map((item) => <li key={item}>{item}</li>)}
              </ul>
            ) : (
              <p className="text-[12px] text-[#4F647A]">Nenhum ponto forte estruturado.</p>
            )}
          </div>

          <div className="mb-6">
            <p className="mb-3 border-b border-[#EEF3F8] pb-1.5 text-[10px] font-semibold uppercase tracking-[0.7px] text-[#295B9A]">Pontos de Atenção</p>
            {(payload?.attention_points ?? []).length > 0 ? (
              <ul className="list-disc space-y-2 pl-4 text-[12px] leading-relaxed text-[#4F647A]">
                {(payload?.attention_points ?? []).map((item) => <li key={item}>{item}</li>)}
              </ul>
            ) : (
              <p className="text-[12px] text-[#4F647A]">Nenhum ponto de atenção estruturado.</p>
            )}
          </div>

          <div>
            <p className="mb-3 border-b border-[#EEF3F8] pb-1.5 text-[10px] font-semibold uppercase tracking-[0.7px] text-[#295B9A]">Conclusão da IA</p>
            <p className="text-[12px] leading-relaxed text-[#4F647A]">{payload?.ai_conclusion || "Não informado"}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

const step1DocumentDefinitions: Array<{ key: Step1DocumentType; label: string }> = [
  { key: "ficha_cadastral", label: "Ficha Cadastral" },
  { key: "contrato_social", label: "Contrato Social / Última Alteração" },
  { key: "ecd_ecf", label: "ECD / ECF" },
  { key: "autorizacao_bacen", label: "Autorização consulta BACEN" },
  { key: "outros_documentos", label: "Outros documentos" },
  { key: "financial_statements_and_trial_balances", label: "Demonstrações Financeiras e Balancetes" }
];

const documentLibraryGroups: Array<{ title: string; types: Step1DocumentType[] }> = [
  {
    title: "Documentação Inicial",
    types: ["ficha_cadastral", "contrato_social", "ecd_ecf", "autorizacao_bacen"]
  },
  {
    title: "Demonstrações Financeiras e Balancetes",
    types: ["financial_statements_and_trial_balances"]
  },
  {
    title: "Outros documentos",
    types: ["outros_documentos"]
  }
];

type AnalysisJourneyStepRecord = {
  final_decision?: unknown;
  analysis_status?: string | null;
  current_journey_step?: number | null;
  last_completed_journey_step?: number | null;
};

function resolveAnalysisJourneyStep(analysisRecord: AnalysisJourneyStepRecord | null | undefined) {
  if (!analysisRecord) return 2;
  const status = analysisRecord.analysis_status ?? null;
  if (analysisRecord.final_decision || ["in_approval", "approved", "rejected", "completed", "cancelled"].includes(status ?? "")) {
    return 4;
  }
  const persistedStep = analysisRecord.current_journey_step ?? analysisRecord.last_completed_journey_step ?? null;
  if (persistedStep && persistedStep >= 2 && persistedStep <= 4) return persistedStep;
  return 2;
}

function resolveWorkspaceInitialStep(analysisRecord: AnalysisJourneyStepRecord | null | undefined) {
  return resolveAnalysisJourneyStep(analysisRecord);
}

type NewAnalysisPageViewProps = {
  mode?: "create" | "workspace";
  analysisId?: number;
};

export function NewAnalysisPageView({ mode = "create", analysisId }: NewAnalysisPageViewProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isWorkspaceMode = mode === "workspace";
  const [effectivePermissions, setEffectivePermissions] = useState<string[]>([]);
  useEffect(() => {
    setEffectivePermissions(getEffectivePermissions());
  }, []);
  const hasTechnicalContinuationCapability = hasPermission("credit.analysis.execute", effectivePermissions);
  const isOperationalSubmitOnlyFlow = !isWorkspaceMode && !hasTechnicalContinuationCapability;
  const [workingAnalysisId, setWorkingAnalysisId] = useState<number | null>(analysisId ?? null);
  const activeAnalysisId = workingAnalysisId;
  const hasValidActiveAnalysisId = Number.isFinite(activeAnalysisId) && (activeAnalysisId ?? 0) > 0;
  const hasStep1Workspace = hasValidActiveAnalysisId;
  useEffect(() => {
    setWorkingAnalysisId(analysisId ?? null);
  }, [analysisId]);
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
  const [ocr] = useState<OcrState>(buildDefaultOcrState());
  const [agriskScoreImport, setAgriskScoreImport] = useState<ImportState>(buildDefaultImportState());
  const [agriskFinancialImport, setAgriskFinancialImport] = useState<ImportState>(buildDefaultImportState());
  const [cofaceImport, setCofaceImport] = useState<ImportState>(buildDefaultImportState());
  const agriskImport = agriskScoreImport;
  const setAgriskImport = setAgriskScoreImport;

  const [importModalSource, setImportModalSource] = useState<ImportSource>("agrisk");
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [pendingImportFile, setPendingImportFile] = useState<UploadFileMetadataInput | null>(null);
  const [pendingImportRawFile, setPendingImportRawFile] = useState<File | null>(null);
  const [pendingImportError, setPendingImportError] = useState<string | null>(null);
  const [isManualDrawerOpen, setIsManualDrawerOpen] = useState(false);
  const [isAgriskDataDrawerOpen, setIsAgriskDataDrawerOpen] = useState(false);
  const [isAgriskFinancialDataDrawerOpen, setIsAgriskFinancialDataDrawerOpen] = useState(false);
  const [isCofaceDataDrawerOpen, setIsCofaceDataDrawerOpen] = useState(false);
  const [manualPanel, setManualPanel] = useState({
    scoreSource: "Serasa",
    scoreValue: 0,
    cofaceDra: 0,
    internalRevenue12m: "",
    outstandingValue: "",
    pmrContractual: "",
    pmrEffective: "",
    commercialNote: "",
    netRevenue: "",
    grossProfit: "",
    ebitda: "",
    netIncome: "",
    currentAssets: "",
    totalAssets: "",
    cashAndEquivalents: "",
    inventory: "",
    currentLiabilities: "",
    totalLiabilities: "",
    equity: "",
    operatingCashFlow: "",
    analystNotes: ""
  });

  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [triageModalOpen, setTriageModalOpen] = useState(!isWorkspaceMode);
  const [triageState, setTriageState] = useState<"idle" | "loading" | "found_existing_customer" | "new_customer_external_data" | "recent_analysis_found" | "error" | "submitting" | "submitted">("idle");
  const [triageMessage, setTriageMessage] = useState<string | null>(null);
  const [triageResult, setTriageResult] = useState<CreditAnalysisTriageResponse | null>(null);
  const [draftRecovery, setDraftRecovery] = useState<CreditAnalysisDraftRecoveryResponse | null>(null);
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
  const [documentLibraryFeedback, setDocumentLibraryFeedback] = useState<string | null>(null);
  const [expandedPolicyPillarKey, setExpandedPolicyPillarKey] = useState<string | null>(null);
  const [isInstitutionalScoreExpanded, setIsInstitutionalScoreExpanded] = useState(false);
  const [isPreliminaryRecommendationExpanded, setIsPreliminaryRecommendationExpanded] = useState(false);
  const [isTechnicalDetailsOpen, setIsTechnicalDetailsOpen] = useState(false);
  const [isDocumentLibraryOpen, setIsDocumentLibraryOpen] = useState(false);
  const [expandedImportedSummary, setExpandedImportedSummary] = useState<"coface" | "agrisk" | "internal" | "references" | null>(null);
  const [workspaceInternalPosition, setWorkspaceInternalPosition] = useState<InternalEconomicPosition | null>(null);
  const [approvalSubmissionSuccessModalOpen, setApprovalSubmissionSuccessModalOpen] = useState(false);
  const [isStep3AdvancePending, setIsStep3AdvancePending] = useState(false);
  const [step3AdvanceError, setStep3AdvanceError] = useState<string | null>(null);
  const step3CanonicalCalculationStartedRef = useRef<number | null>(null);
  const step3EnsureTechnicalDossierRef = useRef<(() => Promise<void>) | null>(null);
  const persistJourneyProgressMutation = useMutation({
    mutationFn: ({ id, currentStep, lastCompletedStep }: { id: number; currentStep: number; lastCompletedStep: number }) =>
      updateCreditAnalysisJourneyProgress(id, {
        current_journey_step: currentStep,
        last_completed_journey_step: lastCompletedStep
      }),
  });
  const persistWorkspaceStateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Record<string, unknown> }) =>
      updateCreditAnalysisWorkspaceState(id, payload),
  });

  function persistWorkspaceStatePatch(patch: Record<string, unknown>, analystNotes?: string) {
    if (!activeAnalysisId) return;
    const payload: Record<string, unknown> = {
      workspace_state: patch
    };
    if (analystNotes !== undefined) {
      payload.analyst_notes = analystNotes;
    }
    persistWorkspaceStateMutation.mutate({ id: activeAnalysisId, payload });
  }

  const workspaceDetailQuery = useQuery({
    queryKey: ["workspace-analysis-detail", activeAnalysisId],
    queryFn: () => {
      if (!hasValidActiveAnalysisId || !activeAnalysisId) {
        throw new Error("Não foi possível carregar a análise. Identificador da análise ausente.");
      }
      return getCreditAnalysisDetail(activeAnalysisId);
    },
    enabled: hasValidActiveAnalysisId && (isWorkspaceMode || (!isOperationalSubmitOnlyFlow && step >= 3))
  });
  const workspaceExternalDataQuery = useQuery({
    queryKey: ["workspace-analysis-external-data", activeAnalysisId],
    queryFn: () => {
      if (!hasValidActiveAnalysisId || !activeAnalysisId) {
        throw new Error("Não foi possível carregar a análise. Identificador da análise ausente.");
      }
      return getExternalDataDashboard(activeAnalysisId);
    },
    enabled: isWorkspaceMode && hasValidActiveAnalysisId
  });
  async function refetchWorkspaceDetailIfPossible() {
    if (!hasValidActiveAnalysisId || isOperationalSubmitOnlyFlow) return null;
    return workspaceDetailQuery.refetch();
  }

  async function refetchWorkspaceExternalDataIfPossible() {
    if (!isWorkspaceMode || !hasValidActiveAnalysisId) return null;
    return workspaceExternalDataQuery.refetch();
  }

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
  const reportReadsQuery = useQuery({
    queryKey: ["analysis-report-reads", activeAnalysisId],
    queryFn: () => listAnalysisReportReads(activeAnalysisId as number),
    enabled: isWorkspaceMode && hasStep1Workspace
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

  const hasAgriskImported = agriskImport.status === "valid" || agriskImport.status === "valid_with_warnings";
  const hasInvalidAgriskImport = agriskImport.files.length > 0 && (agriskImport.status === "invalid" || agriskImport.status === "error");
  const importedAgriskScoreValue = hasAgriskImported ? toNullableNumeric(agriskImport.agriskReadPayload?.credit?.score) : null;
  const effectiveScoreValue = hasAgriskImported ? importedAgriskScoreValue ?? 0 : Number(manualPanel.scoreValue ?? 0);
  const currentScoreSourceLabel = hasAgriskImported ? "Agrisk Score/Risco" : "Manual";
  const scoreFieldLocked = hasAgriskImported;
  const hasAgriskFinancialImported = isAgriskValidatedImport(agriskFinancialImport);
  const agriskFinancialPayload = agriskFinancialImport.agriskReadPayload as Record<string, unknown> | null | undefined;
  const agriskFinancialIndicators = agriskFinancialImport.agriskReadPayload?.financial_indicators;
  const agriskFinancialNetRevenue = toNullableNumeric(agriskFinancialPayload?.net_revenue);
  const manualNetRevenue = toNullableNumberInput(manualPanel.netRevenue);
  const manualGrossProfit = toNullableNumberInput(manualPanel.grossProfit);
  const manualEbitda = toNullableNumberInput(manualPanel.ebitda);
  const manualNetIncome = toNullableNumberInput(manualPanel.netIncome);
  const manualCurrentAssets = toNullableNumberInput(manualPanel.currentAssets);
  const manualTotalAssets = toNullableNumberInput(manualPanel.totalAssets);
  const manualCash = toNullableNumberInput(manualPanel.cashAndEquivalents);
  const manualInventory = toNullableNumberInput(manualPanel.inventory);
  const manualCurrentLiabilities = toNullableNumberInput(manualPanel.currentLiabilities);
  const manualTotalLiabilities = toNullableNumberInput(manualPanel.totalLiabilities);
  const manualEquity = toNullableNumberInput(manualPanel.equity);
  const manualOperatingCashFlow = toNullableNumberInput(manualPanel.operatingCashFlow);
  const hasManualFinancialStatementsSaved = [
    manualPanel.netRevenue,
    manualPanel.grossProfit,
    manualPanel.ebitda,
    manualPanel.netIncome,
    manualPanel.currentAssets,
    manualPanel.totalAssets,
    manualPanel.cashAndEquivalents,
    manualPanel.inventory,
    manualPanel.currentLiabilities,
    manualPanel.totalLiabilities,
    manualPanel.equity,
    manualPanel.operatingCashFlow,
  ].some((value) => String(value ?? "").trim().length > 0);
  const financialStatementsLocked = hasAgriskFinancialImported;
  const currentFinancialSourceLabel = hasAgriskFinancialImported ? "Agrisk Financeiro" : "Manual";
  const manualFinancialInputClassName = `mt-1 h-8 w-full rounded-[8px] border border-[#D7E1EC] px-2.5 text-[12px] text-[#102033] ${financialStatementsLocked ? "cursor-not-allowed bg-[#F8FAFC] text-[#64748B]" : "bg-white"}`;
  const agriskIndicatorRows: ManualIndicatorRow[] = [
    { label: "Margem Bruta", value: toNullableNumeric(agriskFinancialIndicators?.gross_margin), suffix: "%", source: "Agrisk Financeiro" },
    { label: "Margem EBITDA", value: safeRatio(toNullableNumeric(agriskFinancialIndicators?.ebitda), agriskFinancialNetRevenue, true), suffix: "%", source: "Agrisk Financeiro" },
    { label: "Resultado DRE %", value: safeRatio(toNullableNumeric(agriskFinancialIndicators?.dre_result), agriskFinancialNetRevenue, true), suffix: "%", source: "Agrisk Financeiro" },
    { label: "Fluxo de Caixa %", value: safeRatio(toNullableNumeric(agriskFinancialIndicators?.cash_flow), agriskFinancialNetRevenue, true), suffix: "%", source: "Agrisk Financeiro" },
    { label: "Liquidez Geral", value: toNullableNumeric(agriskFinancialIndicators?.liquidity_general), source: "Agrisk Financeiro" },
    { label: "Liquidez Corrente", value: toNullableNumeric(agriskFinancialIndicators?.liquidity_current), source: "Agrisk Financeiro" },
    { label: "Liquidez Seca", value: toNullableNumeric(agriskFinancialIndicators?.liquidity_quick), source: "Agrisk Financeiro" },
    { label: "Liquidez Imediata", value: toNullableNumeric(agriskFinancialIndicators?.liquidity_immediate), source: "Agrisk Financeiro" },
    { label: "Endividamento", value: toNullableNumeric(agriskFinancialIndicators?.indebtedness), source: "Agrisk Financeiro" },
    { label: "Alavancagem Financeira", value: toNullableNumeric(agriskFinancialIndicators?.financial_leverage), source: "Agrisk Financeiro" },
    { label: "Índice Operacional", value: toNullableNumeric(agriskFinancialIndicators?.operational_index), suffix: "%", source: "Agrisk Financeiro" },
  ];
  const manualIndicatorRowsRaw: ManualIndicatorRow[] = [
    { label: "Margem Bruta", value: safeRatio(manualGrossProfit, manualNetRevenue, true), suffix: "%", source: "Manual" },
    { label: "Margem EBITDA", value: safeRatio(manualEbitda, manualNetRevenue, true), suffix: "%", source: "Manual" },
    { label: "Resultado DRE %", value: safeRatio(manualNetIncome, manualNetRevenue, true), suffix: "%", source: "Manual" },
    { label: "Fluxo de Caixa %", value: safeRatio(manualOperatingCashFlow, manualNetRevenue, true), suffix: "%", source: "Manual" },
    { label: "Liquidez Geral", value: safeRatio(manualTotalAssets, manualTotalLiabilities), source: "Manual" },
    { label: "Liquidez Corrente", value: safeRatio(manualCurrentAssets, manualCurrentLiabilities), source: "Manual" },
    { label: "Liquidez Seca", value: manualCurrentAssets !== null && manualInventory !== null ? safeRatio(manualCurrentAssets - manualInventory, manualCurrentLiabilities) : null, source: "Manual" },
    { label: "Liquidez Imediata", value: safeRatio(manualCash, manualCurrentLiabilities), source: "Manual" },
    { label: "Endividamento", value: safeRatio(manualTotalLiabilities, manualTotalAssets), source: "Manual" },
    { label: "Alavancagem Financeira", value: safeRatio(manualTotalAssets, manualEquity), source: "Manual" },
    { label: "Índice Operacional", value: null, source: "Não disponível" },
  ];
  const manualIndicatorRows: ManualIndicatorRow[] = hasAgriskFinancialImported
    ? agriskIndicatorRows
    : manualIndicatorRowsRaw.map((row) => ({
        ...row,
        source: row.value !== null && Number.isFinite(row.value) ? row.source : "Não disponível",
      }));
  const currentIndicatorSourceLabel = hasAgriskFinancialImported
    ? "Agrisk"
    : manualIndicatorRows.some((row) => row.source === "Manual")
      ? "Manual"
      : "Não disponível";
  const manualIndicatorGroups = [
    { title: "Rentabilidade", labels: ["Margem Bruta", "Margem EBITDA", "Resultado DRE %", "Fluxo de Caixa %"] },
    { title: "Liquidez", labels: ["Liquidez Geral", "Liquidez Corrente", "Liquidez Seca", "Liquidez Imediata"] },
    { title: "Estrutura Financeira", labels: ["Endividamento", "Alavancagem Financeira"] },
    { title: "Operacional", labels: ["Índice Operacional"] },
  ].map((group) => ({
    ...group,
    rows: group.labels
      .map((label) => manualIndicatorRows.find((row) => row.label === label))
      .filter((row): row is ManualIndicatorRow => Boolean(row)),
  })).filter((group) => group.rows.length > 0);
  const hasInvalidAgriskFinancialImport = agriskFinancialImport.files.length > 0 && (agriskFinancialImport.status === "invalid" || agriskFinancialImport.status === "error");
  const hasCofaceImported = isCofaceValidatedStatus(cofaceImport.status);
  const importedCofaceDraValue = hasCofaceImported ? toNullableNumeric(cofaceImport.cofaceReadPayload?.coface?.dra) : null;
  const effectiveCofaceDraValue = hasCofaceImported ? importedCofaceDraValue ?? 0 : Number(manualPanel.cofaceDra ?? 0);
  const currentCofaceSourceLabel = hasCofaceImported ? "COFACE" : "Manual";
  const cofaceDraFieldLocked = hasCofaceImported;
  const hasLockedExternalReferences = scoreFieldLocked || cofaceDraFieldLocked;
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
  const workflowAvailableActions = workspaceDetailQuery.data?.analysis?.available_actions ?? [];
  const hasTechnicalWorkspaceEditCapability = resolveTechnicalWorkspaceEditCapability({
    analysisStatus: internalOperationalStatus,
    hasTechnicalContinuationCapability,
    availableActions: workflowAvailableActions,
  });
  const isJourneyReadOnly = resolveAnalysisJourneyReadOnly({
    isWorkspaceMode,
    analysisStatus: internalOperationalStatus,
    finalDecision: workspaceDetailQuery.data?.analysis?.final_decision,
    submittedForApprovalAt: workspaceDetailQuery.data?.analysis?.submitted_for_approval_at,
    hasTechnicalContinuationCapability,
    availableActions: workflowAvailableActions,
  });
  const internalBehaviorLabel = triageResult?.has_recent_analysis ? "cliente com histórico recente" : "histórico estável";
  const hasInternalFinancialSnapshot = hasInternalFinancialData;
  const analysisLifecycleStatus = workspaceDetailQuery.data?.analysis?.analysis_status ?? null;
  const analysisOwnerRole = workspaceDetailQuery.data?.analysis?.current_owner_role ?? null;
  const isStep1ReadOnly =
    isWorkspaceMode &&
    Boolean(
      analysisLifecycleStatus &&
      (analysisLifecycleStatus !== "created" || analysisOwnerRole !== "comercial_solicitante")
    );

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
    onSuccess: async (response) => {
      try {
        const detail = await getCreditAnalysisDetail(response.analysis_id);
        const availableActions = detail.analysis.available_actions ?? [];
        const canContinueInTechnicalWorkspace = availableActions.some((action) => TECHNICAL_CONTINUATION_ACTIONS.has(action));
        if (canContinueInTechnicalWorkspace) {
          router.push(getCreditAnalysisWorkspaceRoute(response.analysis_id));
          return;
        }
      } catch {
        // fallback conservador: usuário segue para monitor se não for possível validar continuidade técnica
      }
      router.push("/analises/monitor?submission=success");
    }
  });
  const submitForApprovalMutation = useMutation({
    mutationFn: (id: number) => executeCreditAnalysisWorkflowAction(id, { action: "submit_approval" }),
    onSuccess: async (_, id) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["workspace-analysis-detail", id] }),
        queryClient.invalidateQueries({ queryKey: ["credit-analysis-detail", id] }),
        queryClient.invalidateQueries({ queryKey: ["workspace-analysis-external-data", id] }),
        queryClient.invalidateQueries({ queryKey: ["credit-analyses-monitor"] }),
        queryClient.invalidateQueries({ queryKey: ["credit-analyses-approval-queue"] })
      ]);
      setApprovalSubmissionSuccessModalOpen(true);
    },
    onError: (error: Error) => {
      setStep(4);
      setApprovalSubmissionSuccessModalOpen(false);
      const message = error.message || "";
      if (message.includes("403")) {
        setStepError("Você não possui autorização para enviar esta solicitação para aprovação.");
        return;
      }
      if (message.includes("409")) {
        setStepError("A análise não está em status elegível para envio à aprovação ou ainda possui pendências técnicas.");
        return;
      }
      if (message.includes("422") || message.toLowerCase().includes("dossie tecnico concluido")) {
        setStepError("O dossiê técnico ainda não está concluído para envio à aprovação.");
        return;
      }
      setStepError("Não foi possível enviar o dossiê para aprovação. Revise os pré-requisitos e tente novamente.");
    }
  });
  const calculateTechnicalDossierMutation = useMutation({
    mutationFn: async (id: number) => {
      await calculateCreditAnalysisScore(id);
      await calculateCreditAnalysisDecision(id);
    }
  });
  const triageSubmitMutation = useMutation({
    mutationFn: (payload: CreditAnalysisTriageSubmitRequest) => submitTriageCreditRequest(payload),
    onSuccess: (response) => {
      const availableActions = response.available_actions ?? [];
      const canContinueInTechnicalWorkspace = availableActions.some((action) => TECHNICAL_CONTINUATION_ACTIONS.has(action));
      if (canContinueInTechnicalWorkspace) {
        router.push(getCreditAnalysisWorkspaceRoute(response.analysis_id));
        return;
      }
      router.push("/analises/monitor?submission=success");
    }
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
    setCanCreateRequest(hasPermission("credit.request.create", effectivePermissions));
  }, [effectivePermissions]);

  useEffect(() => {
    if (!isWorkspaceMode) return;

    if (!hasValidActiveAnalysisId) {
      setWorkspaceError("Não foi possível carregar a análise. Identificador da análise ausente.");
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
    const reportReads = reportReadsQuery.data ?? [];
    const analysisRecord = detail.analysis;
    const customerRecord = detail.customer;
    const triageSubmission =
      analysisRecord.decision_memory_json &&
      typeof analysisRecord.decision_memory_json === "object" &&
      analysisRecord.decision_memory_json.triage_submission &&
      typeof analysisRecord.decision_memory_json.triage_submission === "object"
        ? (analysisRecord.decision_memory_json.triage_submission as Record<string, unknown>)
        : null;
    const workspaceState =
      analysisRecord.decision_memory_json &&
      typeof analysisRecord.decision_memory_json === "object" &&
      analysisRecord.decision_memory_json.workspace_state &&
      typeof analysisRecord.decision_memory_json.workspace_state === "object"
        ? (analysisRecord.decision_memory_json.workspace_state as Record<string, unknown>)
        : null;
    const buName = typeof triageSubmission?.business_unit === "string" ? triageSubmission.business_unit : "";
    const fallbackCustomerName = typeof triageSubmission?.company_name === "string" ? triageSubmission.company_name.trim() : "";
    const fallbackCustomerDocument = typeof triageSubmission?.cnpj === "string" ? sanitizeDigits(triageSubmission.cnpj) : "";
    const resolvedCustomerName = (customerRecord?.company_name ?? fallbackCustomerName).trim();
    const resolvedCustomerDocument = sanitizeDigits(customerRecord?.document_number ?? fallbackCustomerDocument);
    const resolvedCustomerId = customerRecord?.id ?? analysisRecord?.customer_id ?? null;

    if (!analysisRecord?.id || !analysisRecord?.customer_id || !resolvedCustomerName || !resolvedCustomerDocument) {
      setWorkspaceError("Não foi possível abrir o workspace: dados obrigatórios da análise estão incompletos.");
      return;
    }

    const toCurrency = (value: number | string | null | undefined) => formatCurrencyBRL(String(value ?? 0));
    const entries = external.entries ?? [];
    const byNewestReads = [...reportReads].sort((a, b) => (new Date(b.created_at).getTime() || 0) - (new Date(a.created_at).getTime() || 0));
    const agriskReads = byNewestReads.filter((entry) => entry.source_type === "agrisk");
    const agriskRead = pickCanonicalReportRead(agriskReads.filter((entry) => normalizeAgriskReportType(entry.report_type) === AGRISK_SCORE_RISK));
    const agriskFinancialRead = pickCanonicalReportRead(agriskReads.filter((entry) => normalizeAgriskReportType(entry.report_type) === AGRISK_FINANCIAL_ANALYSIS));
    const cofaceRead = pickCanonicalReportRead(byNewestReads.filter((entry) => entry.source_type === "coface"));

    const analysisDocuments = step1DocumentsQuery.data ?? [];
    const findDocumentForRead = (read: AnalysisReportReadSummaryDto | undefined) =>
      read?.analysis_document_id ? analysisDocuments.find((doc) => doc.id === read.analysis_document_id) : undefined;
    const fileFromRead = (read: AnalysisReportReadSummaryDto | undefined, document: AnalysisDocumentDto | undefined): UploadFileMetadataInput[] => {
      if (document) {
        return [{
          original_filename: document.original_filename,
          mime_type: document.mime_type,
          file_size: document.file_size
        }];
      }
      if (!read) return [];
      return [{
        original_filename: read.original_filename,
        mime_type: read.mime_type,
        file_size: read.file_size
      }];
    };
    const agriskDocument = findDocumentForRead(agriskRead);
    const agriskFinancialDocument = findDocumentForRead(agriskFinancialRead);
    const cofaceDocument = findDocumentForRead(cofaceRead);
    const savedManualPanel = workspaceState?.manual_panel && typeof workspaceState.manual_panel === "object"
      ? (workspaceState.manual_panel as Record<string, unknown>)
      : null;
    const savedManual = workspaceState?.manual && typeof workspaceState.manual === "object"
      ? (workspaceState.manual as Record<string, unknown>)
      : null;
    setExistingCustomerId(resolvedCustomerId);
    setTriageSelectedBusinessUnit(buName);
    setCustomer((prev) => ({
      ...prev,
      companyName: resolvedCustomerName,
      cnpj: formatCnpj(resolvedCustomerDocument),
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
    setManualPanel((prev) => ({
      ...prev,
      analystNotes: analysisRecord.analyst_notes ?? prev.analystNotes
    }));
    if (savedManualPanel) {
      setManualPanel((prev) => ({ ...prev, ...savedManualPanel }));
    }
    const savedFinancial = workspaceState?.manual_financial_statements && typeof workspaceState.manual_financial_statements === "object"
      ? (workspaceState.manual_financial_statements as Record<string, Record<string, unknown>>)
      : null;
    if (savedFinancial) {
      setManualPanel((prev) => ({
        ...prev,
        netRevenue: String(savedFinancial.dre?.net_revenue ?? prev.netRevenue ?? ""),
        grossProfit: String(savedFinancial.dre?.gross_profit ?? prev.grossProfit ?? ""),
        ebitda: String(savedFinancial.dre?.ebitda ?? prev.ebitda ?? ""),
        netIncome: String(savedFinancial.dre?.net_income ?? prev.netIncome ?? ""),
        currentAssets: String(savedFinancial.balance_sheet?.current_assets ?? prev.currentAssets ?? ""),
        totalAssets: String(savedFinancial.balance_sheet?.total_assets ?? prev.totalAssets ?? ""),
        cashAndEquivalents: String(savedFinancial.balance_sheet?.cash_and_equivalents ?? prev.cashAndEquivalents ?? ""),
        inventory: String(savedFinancial.balance_sheet?.inventory ?? prev.inventory ?? ""),
        currentLiabilities: String(savedFinancial.balance_sheet?.current_liabilities ?? prev.currentLiabilities ?? ""),
        totalLiabilities: String(savedFinancial.balance_sheet?.total_liabilities ?? prev.totalLiabilities ?? ""),
        equity: String(savedFinancial.balance_sheet?.equity ?? prev.equity ?? ""),
        operatingCashFlow: String(savedFinancial.cash_flow?.operating_cash_flow ?? prev.operatingCashFlow ?? ""),
      }));
    }
    if (savedManual) {
      setManual((prev) => ({ ...prev, ...savedManual }));
    }
    if (typeof workspaceState?.manual_configured === "boolean") {
      setManualConfigured(workspaceState.manual_configured);
    }
    setAgriskImport((prev) => ({
      ...prev,
      files: fileFromRead(agriskRead, agriskDocument),
      status: (agriskRead?.status as ImportStatus) ?? "empty",
      importedAt: agriskRead?.created_at ?? null,
      agriskReadId: agriskRead?.id ?? null,
      agriskWarnings: agriskRead?.warnings ?? [],
      errorMessage: agriskRead?.validation_message ?? null,
      agriskReadPayload: (agriskRead?.read_payload as AgriskReportReadResponse["read_payload"] | null) ?? null,
    }));
    setAgriskFinancialImport((prev) => ({
      ...prev,
      files: fileFromRead(agriskFinancialRead, agriskFinancialDocument),
      status: (agriskFinancialRead?.status as ImportStatus) ?? "empty",
      importedAt: agriskFinancialRead?.created_at ?? null,
      agriskReadId: agriskFinancialRead?.id ?? null,
      agriskWarnings: agriskFinancialRead?.warnings ?? [],
      errorMessage: agriskFinancialRead?.validation_message ?? null,
      agriskReadPayload: (agriskFinancialRead?.read_payload as AgriskReportReadResponse["read_payload"] | null) ?? null,
    }));
    setCofaceImport((prev) => ({
      ...prev,
      files: fileFromRead(cofaceRead, cofaceDocument),
      status: (cofaceRead?.status as ImportStatus) ?? "empty",
      importedAt: cofaceRead?.created_at ?? null,
      cofaceReadId: cofaceRead?.id ?? null,
      cofaceWarnings: cofaceRead?.warnings ?? [],
      errorMessage: cofaceRead?.validation_message ?? null,
      cofaceReadPayload: (cofaceRead?.read_payload as CofaceReportReadResponse["read_payload"] | null) ?? null,
    }));
    setTriageModalOpen(false);
    setStep(resolveWorkspaceInitialStep(analysisRecord));
    setWorkspaceError(null);
    setWorkspaceHydrated(true);
    void (async () => {
      const agriskReadId = agriskRead?.id ?? null;
      const agriskFinancialReadId = agriskFinancialRead?.id ?? null;
      const cofaceReadId = cofaceRead?.id ?? null;
      if (agriskReadId) {
        try {
          const response = await getAgriskReportRead(agriskReadId);
          setAgriskImport((prev) => ({ ...prev, status: response.status, agriskReadId: response.id, agriskReadPayload: response.read_payload, agriskWarnings: response.warnings, errorMessage: response.validation_message }));
        } catch {}
      }
      if (agriskFinancialReadId) {
        try {
          const response = await getAgriskReportRead(agriskFinancialReadId);
          setAgriskFinancialImport((prev) => ({ ...prev, status: response.status, agriskReadId: response.id, agriskReadPayload: response.read_payload, agriskWarnings: response.warnings, errorMessage: response.validation_message }));
        } catch {}
      }
      if (cofaceReadId) {
        try {
          const response = await getCofaceReportRead(cofaceReadId);
          setCofaceImport((prev) => ({ ...prev, status: response.status, cofaceReadId: response.id, cofaceReadPayload: response.read_payload, cofaceWarnings: response.warnings, errorMessage: response.validation_message }));
        } catch {}
      }
      const hasMappedPortfolioData = Boolean(
        triageSubmission?.portfolio_data &&
        typeof triageSubmission.portfolio_data === "object" &&
        (
          (triageSubmission.portfolio_data as Record<string, unknown>).open_amount !== undefined ||
          (triageSubmission.portfolio_data as Record<string, unknown>).total_open_amount !== undefined
        )
      );
      if (!hasMappedPortfolioData && resolvedCustomerDocument) {
        try {
          const portfolioCustomers = await getPortfolioCustomers({
            cnpj: resolvedCustomerDocument,
            snapshot_id: "current",
          });
          const portfolioMatch = portfolioCustomers[0];
          if (portfolioMatch) {
            const openAmount = Number(portfolioMatch.total_open_amount ?? 0);
            const totalLimit = Number(portfolioMatch.approved_credit_amount ?? 0);
            const availableLimit = Math.max(0, totalLimit - openAmount);
            setWorkspaceInternalPosition({
              open_amount: openAmount,
              total_limit: totalLimit,
              available_limit: availableLimit,
              overdue_amount: null,
              not_due_amount: null,
              base_date: null
            });
          }
        } catch {}
      }
    })();
  }, [
    hasValidActiveAnalysisId,
    isWorkspaceMode,
    workspaceDetailQuery.data,
    workspaceDetailQuery.error,
    workspaceDetailQuery.isError,
    workspaceDetailQuery.isLoading,
    workspaceExternalDataQuery.data,
    workspaceExternalDataQuery.error,
    workspaceExternalDataQuery.isError,
    workspaceExternalDataQuery.isLoading,
    reportReadsQuery.data,
    setAgriskImport,
    step1DocumentsQuery.data
  ]);

  const triageLookupMutation = useMutation({
    mutationFn: (cnpj: string) => triageCreditRequest({ cnpj }),
    onMutate: () => {
      setTriageState("loading");
      setTriageMessage(null);
      setWorkingAnalysisId(null);
      setDraftRecovery(null);
    },
    onSuccess: async (response) => {
      setTriageResult(response);
      setDraftRecovery(null);
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
      const workspaceId = await createStep1WorkspaceFromTriage(response);
      if (!workspaceId) return;
      setTriageModalOpen(false);
    },
    onError: (error) => {
      setTriageState("error");
      setTriageMessage(error instanceof Error ? error.message : "Falha ao consultar CNPJ.");
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
    mutationFn: (payload: { analysisId: number; documentType: Step1DocumentType; file: File }) => uploadAnalysisDocument(payload.analysisId, payload.documentType, payload.file),
    onSuccess: async () => {
      await step1DocumentsQuery.refetch();
      setDocumentUploadFeedback({ type: "success", message: "Arquivo enviado com sucesso." });
    },
    onError: (error) => {
      setDocumentUploadFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Não foi possível enviar o arquivo. Tente novamente."
      });
    }
  });
  const deleteStep1DocumentMutation = useMutation({
    mutationFn: (documentId: number) => deleteAnalysisDocument(activeAnalysisId as number, documentId),
    onSuccess: async () => {
      await step1DocumentsQuery.refetch();
    },
    onError: (error) => {
      setDocumentUploadFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Não foi possível remover o arquivo. Tente novamente."
      });
    }
  });

  async function createStep1WorkspaceFromTriage(response: CreditAnalysisTriageResponse): Promise<number | null> {
    const digits = sanitizeDigits(response.customer_data.cnpj);
    const draftSource = response.found_in_portfolio ? "portfolio" : "external";
    const businessUnit = response.customer_data.business_unit?.trim() || null;
    try {
      const recoveredDraft = await recoverCreditAnalysisDraft(digits);
      if (recoveredDraft) {
        setWorkingAnalysisId(recoveredDraft.analysis_id);
        setDraftRecovery(null);
        setStepError(null);
        return recoveredDraft.analysis_id;
      }

      const draft = await createCreditAnalysisDraft({
        cnpj: digits,
        customer_name: response.customer_data.company_name?.trim() || null,
        economic_group: response.customer_data.economic_group ?? null,
        business_unit: businessUnit,
        source: draftSource
      });
      setWorkingAnalysisId(draft.analysis_id);
      setDraftRecovery(null);
      setStepError(null);
      return draft.analysis_id;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível preparar a solicitação após a consulta do CNPJ.";
      setTriageState("error");
      setTriageMessage(message);
      setWorkingAnalysisId(null);
      setDraftRecovery(null);
      return null;
    }
  }

  function ensureStep1Workspace(message: string): number | null {
    if (hasStep1Workspace && activeAnalysisId) return activeAnalysisId;
    setDocumentUploadFeedback({ type: "error", message });
    return null;
  }

  async function handleContinueDraft() {
    if (!draftRecovery) return;
    setWorkingAnalysisId(draftRecovery.analysis_id);
    setDocumentUploadFeedback({ type: "success", message: "Rascunho recuperado com sucesso." });
  }

  async function handleDiscardDraft() {
    if (!draftRecovery) return;
    try {
      await discardCreditAnalysisDraft(draftRecovery.analysis_id);
      setDraftRecovery(null);
      setWorkingAnalysisId(null);
      setDocumentUploadFeedback({ type: "success", message: "Rascunho descartado." });
      setGovernanceStatus(null);
      setStepError(null);
    } catch (error) {
      setDocumentUploadFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Não foi possível descartar o rascunho."
      });
    }
  }
  const createCommercialReferenceMutation = useMutation({
    mutationFn: ({ analysisId, payload }: { analysisId: number; payload: { name: string; phone: string | null; email: string | null } }) =>
      createCommercialReference(analysisId, payload),
    onSuccess: (reference) => {
      queryClient.invalidateQueries({ queryKey: ["analysis-commercial-references", reference.credit_analysis_id] });
    },
    onError: (error) => {
      setCommercialReferenceForm((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : "Falha ao adicionar referência comercial."
      }));
    }
  });
  const deleteCommercialReferenceMutation = useMutation({
    mutationFn: (referenceId: number) => deleteCommercialReference(activeAnalysisId as number, referenceId),
    onSuccess: () => {
      commercialReferencesQuery.refetch();
    },
    onError: (error) => {
      setCommercialReferenceForm((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : "Falha ao remover referência comercial."
      }));
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

  async function navigateToStep(targetStep: number): Promise<{ advanced: boolean; errorMessage?: string }> {
    try {
      console.warn("[STEP3_ADVANCE] navigateToStep called", { currentStep: step, targetStep });
      if (targetStep === step) {
        console.warn("[STEP3_ADVANCE] blocked before technical consolidation", { reason: "targetStep === step", step, targetStep });
        return { advanced: true };
      }
      console.warn("[STEP3_ADVANCE] before validations");
      if (isOperationalSubmitOnlyFlow && targetStep > 1) {
        const message = "Esta solicitação será apenas submetida para análise financeira. O avanço para a Etapa 2 não é permitido para seu acesso.";
        setStepError(message);
        console.warn("[STEP3_ADVANCE] validation result", { result: "blocked", reason: "isOperationalSubmitOnlyFlow && targetStep > 1" });
        console.warn("[STEP3_ADVANCE] blocked before technical consolidation", { reason: "isOperationalSubmitOnlyFlow && targetStep > 1", step, targetStep });
        return { advanced: false, errorMessage: message };
      }
      if (isJourneyReadOnly && targetStep < 4) {
        const message = "A análise já foi encaminhada para aprovação/conclusão e não pode voltar para edição.";
        setStepError(message);
        console.warn("[STEP3_ADVANCE] validation result", { result: "blocked", reason: "isJourneyReadOnly && targetStep < 4" });
        console.warn("[STEP3_ADVANCE] blocked before technical consolidation", { reason: "isJourneyReadOnly && targetStep < 4", step, targetStep });
        return { advanced: false, errorMessage: message };
      }
      if (isStep1GovernanceBlocked && targetStep > 1) {
        const message = "Não é possível avançar enquanto existir bloqueio de governança para este CNPJ.";
        setStepError(message);
        console.warn("[STEP3_ADVANCE] validation result", { result: "blocked", reason: "isStep1GovernanceBlocked && targetStep > 1" });
        console.warn("[STEP3_ADVANCE] blocked before technical consolidation", { reason: "isStep1GovernanceBlocked && targetStep > 1", step, targetStep });
        return { advanced: false, errorMessage: message };
      }
      if (targetStep < step) {
        console.warn("[STEP3_ADVANCE] validation result", { result: "ok", reason: "targetStep < step" });
        setStepError(null);
        setStep(targetStep);
        return { advanced: true };
      }

      for (let s = step; s < targetStep; s += 1) {
        console.warn("[STEP3_ADVANCE] loop checkpoint", { s, targetStep, stepSnapshot: step });
        const error = validateStep(s);
        if (error) {
          console.debug("[STEP3_ADVANCE] before return", { reason: `validateStep(${s}) blocked`, s, targetStep });
          console.warn("[STEP3_ADVANCE] validation result", { result: "blocked", reason: `validateStep(${s})`, error });
          const message = `Não é possível avançar para a etapa ${targetStep}. ${error}`;
          setStepError(message);
          console.warn("[STEP3_ADVANCE] blocked before technical consolidation", { reason: `validateStep(${s})`, step, targetStep });
          return { advanced: false, errorMessage: message };
        }
        console.warn("[STEP3_ADVANCE] validation result", { result: "ok", reason: `validateStep(${s})` });
        if (s === 2) {
          console.debug("[STEP3_ADVANCE] after validateStep(2)", { stepSnapshot: step, targetStep });
        }
        if (targetStep === 4 && s === 2) {
          console.warn("[STEP3_ADVANCE] before validateStep(3)");
          const step3Validation = validateStep(3);
          console.warn("[STEP3_ADVANCE] validation result", {
            result: step3Validation ? "blocked" : "ok",
            reason: "validateStep(3)",
          });
          if (step3Validation) {
            const message = `Não é possível avançar para a etapa ${targetStep}. ${step3Validation}`;
            setStepError(message);
            console.debug("[STEP3_ADVANCE] before return", { reason: "validateStep(3) blocked", stepSnapshot: step, targetStep });
            console.warn("[STEP3_ADVANCE] blocked before technical consolidation", { reason: "validateStep(3)", step, targetStep });
            return { advanced: false, errorMessage: message };
          }
        }
        console.debug("[STEP3_ADVANCE] before next iteration", { nextS: s + 1, targetStep, willContinue: s + 1 < targetStep });
      }

      const shouldRunTechnicalConsolidation =
        !isOperationalSubmitOnlyFlow &&
        hasValidActiveAnalysisId &&
        (
          (step === 2 && targetStep >= 3) ||
          targetStep === 4
        );
      if (shouldRunTechnicalConsolidation) {
        setIsStep3AdvancePending(true);
        try {
          console.warn("[STEP3_ADVANCE] starting technical dossier consolidation");
          await ensureTechnicalDossierCalculatedForStep4();
        } catch (error) {
          console.error("[STEP3_ADVANCE] failed", error);
          const message = normalizeTechnicalConsolidationErrorMessage(error);
          setStepError(message);
          return { advanced: false, errorMessage: message };
        } finally {
          setIsStep3AdvancePending(false);
        }
      }
      setStepError(null);
      console.debug("[STEP3_ADVANCE] before setStep", { fromStep: step, toStep: targetStep });
      setStep(targetStep);
      console.debug("[STEP3_ADVANCE] after setStep", { toStep: targetStep });
      if (isWorkspaceMode) {
        persistAnalystComment(analysis.comment);
      }
      if (isWorkspaceMode && activeAnalysisId) {
        const lastCompleted = Math.max(1, targetStep - 1);
        await persistJourneyProgressMutation.mutateAsync({ id: activeAnalysisId, currentStep: targetStep, lastCompletedStep: lastCompleted });
      }
      return { advanced: true };
    } catch (error) {
      console.error("[STEP3_ADVANCE] unexpected navigateToStep failure", error);
      const message = "Falha inesperada ao avançar para revisão. Tente novamente.";
      setStepError(message);
      console.debug("[STEP3_ADVANCE] before return", { reason: "unexpected exception", stepSnapshot: step, targetStep });
      console.warn("[STEP3_ADVANCE] blocked before technical consolidation", { reason: "unexpected exception", step, targetStep });
      return { advanced: false, errorMessage: message };
    }
  }

  async function handleAdvanceFromStep3ToStep4() {
    console.warn("[STEP3_ADVANCE] click captured", { step, analysisId: activeAnalysisId, workspace: isWorkspaceMode });
    setStep3AdvanceError(null);
    setStepError(null);
    setIsStep3AdvancePending(true);

    try {
      const result = await navigateToStep(4);
      if (!result.advanced) {
        const message = result.errorMessage ?? "Não foi possível avançar para revisão. Verifique os dados da Etapa 3.";
        setStep3AdvanceError(message);
        return;
      }
      await refetchWorkspaceDetailIfPossible();
    } catch (error) {
      console.error("[STEP3_ADVANCE] failed", error);
      const message = normalizeTechnicalConsolidationErrorMessage(error);
      setStep3AdvanceError(message);
      setStepError(message);
      return;
    } finally {
      setIsStep3AdvancePending(false);
    }
  }

  async function handleAdvanceFromStep2ToStep3() {
    console.warn("[STEP2_ADVANCE] click captured", { step, analysisId: activeAnalysisId, workspace: isWorkspaceMode });
    setStepError(null);
    setIsStep3AdvancePending(true);
    try {
      const result = await navigateToStep(3);
      if (!result.advanced) {
        const message = result.errorMessage ?? "Não foi possível avançar para a Mesa de Análise. Verifique os dados da etapa 2.";
        setStepError(message);
        return;
      }
      await refetchWorkspaceDetailIfPossible();
    } catch (error) {
      console.error("[STEP2_ADVANCE] failed", error);
      const message = normalizeTechnicalConsolidationErrorMessage(error);
      setStepError(message);
    } finally {
      setIsStep3AdvancePending(false);
    }
  }

  useEffect(() => {
    if (step !== 3) return;
    if (isOperationalSubmitOnlyFlow || !hasValidActiveAnalysisId || !activeAnalysisId) return;
    if (workspaceDetailQuery.data?.score?.score_pillars?.available === true) return;
    if (calculateTechnicalDossierMutation.isPending || isStep3AdvancePending) return;
    if (step3CanonicalCalculationStartedRef.current === activeAnalysisId) return;

    step3CanonicalCalculationStartedRef.current = activeAnalysisId;
    setStepError(null);
    const ensureTechnicalDossier = step3EnsureTechnicalDossierRef.current;
    if (!ensureTechnicalDossier) return;

    setIsStep3AdvancePending(true);
    void ensureTechnicalDossier()
      .catch((error) => {
        const message = normalizeTechnicalConsolidationErrorMessage(error);
        setStepError(message);
      })
      .finally(() => {
        setIsStep3AdvancePending(false);
      });
  }, [
    activeAnalysisId,
    calculateTechnicalDossierMutation.isPending,
    hasValidActiveAnalysisId,
    isOperationalSubmitOnlyFlow,
    isStep3AdvancePending,
    step,
    workspaceDetailQuery.data?.score?.score_pillars?.available
  ]);

  useEffect(() => {
    if (!isOperationalSubmitOnlyFlow) return;
    if (step > 1) {
      setStep(1);
    }
  }, [isOperationalSubmitOnlyFlow, step]);

  function openImportModal(source: ImportSource) {
    setImportModalSource(source);
    setPendingImportFile(
      source === "agrisk"
        ? agriskImport.files[0] ?? null
        : source === "agrisk_financial"
          ? agriskFinancialImport.files[0] ?? null
          : cofaceImport.files[0] ?? null
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
      } else if (importModalSource === "agrisk_financial") {
        setAgriskFinancialImport((prev) => ({ ...prev, status: "error", errorMessage: "Falha na leitura do arquivo (tamanho excedido)." }));
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

    if (importModalSource === "agrisk" || importModalSource === "agrisk_financial") {
      if (!pendingImportRawFile) {
        setPendingImportError("Não foi possível ler o arquivo selecionado.");
        return;
      }
      const targetSource = importModalSource;
      const setTargetImport = targetSource === "agrisk_financial" ? setAgriskFinancialImport : setAgriskImport;
      setTargetImport((prev) => ({
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
      if (targetSource === "agrisk_financial") {
        setIsAgriskFinancialDataDrawerOpen(false);
      } else {
        setIsAgriskDataDrawerOpen(false);
      }
      setIsImportModalOpen(false);
      try {
        const response = await readAgriskReport(pendingImportRawFile, sanitizeDigits(customer.cnpj), activeAnalysisId ?? null);
        if (!isExpectedAgriskReport(response, targetSource)) {
          const detectedLabel = normalizeAgriskReportType(response.report_type ?? response.read_payload?.report_type) === AGRISK_FINANCIAL_ANALYSIS
            ? "Relatório de Análise Financeira"
            : "Relatório de Score/Risco";
          setTargetImport((prev) => ({
            ...prev,
            files: [pendingImportFile],
            status: "invalid",
            importedAt,
            errorMessage: `O arquivo foi identificado como ${detectedLabel}. Envie-o na seção correspondente.`,
            agriskReadId: response.id,
            agriskReadPayload: response.read_payload,
            agriskWarnings: response.warnings
          }));
          if (isWorkspaceMode) {
            await Promise.all([step1DocumentsQuery.refetch(), reportReadsQuery.refetch()]);
          }
          return;
        }
        setTargetImport((prev) => ({
          ...prev,
          files: [pendingImportFile],
          status: response.status,
          importedAt,
          errorMessage: response.validation_message,
          agriskReadId: response.id,
          agriskReadPayload: response.read_payload,
          agriskWarnings: response.warnings
        }));
        if (isWorkspaceMode) {
          await Promise.all([step1DocumentsQuery.refetch(), reportReadsQuery.refetch()]);
        } else {
          await step1DocumentsQuery.refetch();
        }
        if (isAgriskValidatedStatus(response.status)) {
          persistWorkspaceStatePatch({
            imports: {
              [targetSource === "agrisk_financial" ? "agrisk_financial" : "agrisk"]: {
                read_id: response.id,
                status: response.status,
                imported_at: importedAt,
                original_filename: pendingImportFile.original_filename,
                file_size: pendingImportFile.file_size
              }
            }
          });
        }
      } catch (error) {
        const message = error instanceof Error ?error.message : "Falha ao processar o relatório AgRisk.";
        setTargetImport((prev) => ({ ...prev, status: "error", errorMessage: message }));
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
        const response = await readCofaceReport(pendingImportRawFile, sanitizeDigits(customer.cnpj), activeAnalysisId ?? null);
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
        if (isWorkspaceMode) {
          await Promise.all([step1DocumentsQuery.refetch(), reportReadsQuery.refetch()]);
        } else {
          await step1DocumentsQuery.refetch();
        }
        persistWorkspaceStatePatch({
          imports: {
            coface: {
              read_id: response.id,
              status: response.status,
              imported_at: importedAt,
              original_filename: pendingImportFile.original_filename,
              file_size: pendingImportFile.file_size
            }
          }
        });
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

  function clearImportState(source: ImportSource) {
    if (source === "agrisk") {
      setIsAgriskDataDrawerOpen(false);
      setAgriskImport(buildDefaultImportState());
      return;
    }
    if (source === "agrisk_financial") {
      setIsAgriskFinancialDataDrawerOpen(false);
      setAgriskFinancialImport(buildDefaultImportState());
      return;
    }
    setIsCofaceDataDrawerOpen(false);
    setCofaceImport(buildDefaultImportState());
  }

  async function refetchAfterOperationalReset(analysisId: number) {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["workspace-analysis-detail", analysisId] }),
      queryClient.invalidateQueries({ queryKey: ["credit-analysis-detail", analysisId] }),
      queryClient.invalidateQueries({ queryKey: ["workspace-analysis-external-data", analysisId] }),
      queryClient.invalidateQueries({ queryKey: ["analysis-documents", analysisId] }),
      queryClient.invalidateQueries({ queryKey: ["analysis-report-reads", analysisId] }),
      queryClient.invalidateQueries({ queryKey: ["credit-analyses-monitor"] })
    ]);
    await Promise.all([
      refetchWorkspaceDetailIfPossible(),
      refetchWorkspaceExternalDataIfPossible(),
      step1DocumentsQuery.refetch(),
      reportReadsQuery.refetch()
    ]);
  }

  async function removeImport(source: ImportSource) {
    const shouldRemove = window.confirm("Deseja remover o relatório importado desta fonte?");
    if (!shouldRemove) return;
    setStepError(null);
    try {
      if (isWorkspaceMode && hasValidActiveAnalysisId && activeAnalysisId) {
        await resetCreditAnalysisOperationalData(activeAnalysisId, source);
        clearImportState(source);
        setStep(2);
        await refetchAfterOperationalReset(activeAnalysisId);
        return;
      }
      clearImportState(source);
      persistWorkspaceStatePatch({ imports: { [source]: null } });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao resetar dados operacionais.";
      setStepError(message);
    }
  }

  function saveManualDrawer() {
    const scoreIsFromImportedAgrisk = hasAgriskImported;
    const manualFinancialStatements = {
      dre: {
        net_revenue: toNullableNumberInput(manualPanel.netRevenue),
        gross_profit: toNullableNumberInput(manualPanel.grossProfit),
        ebitda: toNullableNumberInput(manualPanel.ebitda),
        net_income: toNullableNumberInput(manualPanel.netIncome),
      },
      balance_sheet: {
        current_assets: toNullableNumberInput(manualPanel.currentAssets),
        total_assets: toNullableNumberInput(manualPanel.totalAssets),
        cash_and_equivalents: toNullableNumberInput(manualPanel.cashAndEquivalents),
        inventory: toNullableNumberInput(manualPanel.inventory),
        current_liabilities: toNullableNumberInput(manualPanel.currentLiabilities),
        total_liabilities: toNullableNumberInput(manualPanel.totalLiabilities),
        equity: toNullableNumberInput(manualPanel.equity),
      },
      cash_flow: {
        operating_cash_flow: toNullableNumberInput(manualPanel.operatingCashFlow),
      },
    };
    const commercialInternalData = {
      internal_revenue_last_12_months: toNullableNumberInput(manualPanel.internalRevenue12m),
      open_amount: toNullableNumberInput(manualPanel.outstandingValue),
      contracted_dso_days: toNullableNumberInput(manualPanel.pmrContractual),
      effective_dso_days: toNullableNumberInput(manualPanel.pmrEffective),
      commercial_note: manualPanel.commercialNote || null,
    };
    const externalReferences = {
      score_source: scoreIsFromImportedAgrisk ? "Agrisk Score/Risco" : manualPanel.scoreSource,
      score_value: effectiveScoreValue,
      coface_dra: effectiveCofaceDraValue,
    };
    const observations = { analyst_notes: manualPanel.analystNotes || null };

    setManualConfigured(true);
    const nextManual = {
      ...manual,
      comments: manualPanel.analystNotes,
      observations: `Fonte do score: ${externalReferences.score_source}; Score: ${effectiveScoreValue}; DRA COFACE: ${effectiveCofaceDraValue}; Faturamento interno 12 meses: ${manualPanel.internalRevenue12m || "não informado"}`
    };
    setManual(nextManual);
    persistWorkspaceStatePatch({
      manual_configured: true,
      manual_panel: manualPanel,
      external_references: externalReferences,
      commercial_internal_data: commercialInternalData,
      manual_financial_statements: manualFinancialStatements,
      observations,
      complementary_data: {
        net_revenue: toNullableNumberInput(manualPanel.netRevenue)
      },
      manual: nextManual
    }, analysis.comment);
    setIsManualDrawerOpen(false);
  }

  function persistAnalystComment(value: string) {
    persistWorkspaceStatePatch(
      {
        manual_configured: manualConfigured,
        manual_panel: manualPanel,
        manual,
      },
      value
    );
  }

  function submit() {
    if (isStep1GovernanceBlocked) {
      setStepError("A abertura de nova solicitação está bloqueada para este cliente neste momento.");
      return;
    }
    if (isOperationalSubmitOnlyFlow) {
      const triagePayload: CreditAnalysisTriageSubmitRequest = {
        cnpj: sanitizeDigits(customer.cnpj),
        suggested_limit: toNumberInput(analysis.requestedLimit),
        source: triageResult?.found_in_portfolio ? "cliente_existente_carteira" : "cliente_novo_consulta_externa",
        customer_id: existingCustomerId ?? triageResult?.customer_data.customer_id ?? null,
        company_name: customer.companyName.trim() || null,
        business_unit: triageResult?.found_in_portfolio ? null : ((triageSelectedBusinessUnit || requestBusinessUnit || "").trim() || null),
        is_early_review_request: isEarlyReviewRequest,
        early_review_justification: isEarlyReviewRequest ? (earlyReviewJustification.trim() || null) : null,
        previous_analysis_id: triageResult?.last_analysis?.analysis_id ?? null
      };
      triageSubmitMutation.mutate(triagePayload);
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
          net_revenue: toNullableNumberInput(manualPanel.netRevenue),
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
          source_score: manualConfigured || hasAgriskImported ? effectiveScoreValue : null,
          source_rating: hasAgriskImported ? "Fonte: Agrisk Score/Risco" : manualConfigured ?`Fonte manual: ${manualPanel.scoreSource}` : "",
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
            hasCofaceImported ?`DRA COFACE importado: ${effectiveCofaceDraValue}` : manualConfigured ?`DRA COFACE manual: ${manualPanel.cofaceDra || "não informado"}` : ""
          ]
            .filter(Boolean)
            .join(" · "),
          files: [...(hasAgriskImported ?agriskImport.files : []), ...cofaceImport.files]
        }
      }
    };
    submitMutation.mutate(payload);
  }

  function submitForApproval() {
    if (!isWorkspaceMode || !activeAnalysisId || activeAnalysisId <= 0) {
      setStepError("A análise ativa não está disponível para envio à aprovação.");
      return;
    }
    setStepError(null);
    submitForApprovalMutation.mutate(activeAnalysisId);
  }

  function toIsoDate(value: string | null | undefined): string | null {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString().slice(0, 10);
  }

  function normalizeTechnicalConsolidationErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error ?? "");
    const normalized = message.toLowerCase();
    if (normalized.includes("no external data found for this analysis")) {
      return "Não foi possível consolidar o dossiê técnico. Verifique se há dados importados vinculados à análise.";
    }
    if (normalized.includes("score result not found for this analysis")) {
      return "Não foi possível consolidar o dossiê técnico. O score institucional não foi gerado para esta análise.";
    }
    if (normalized.includes("no positive revenue basis available for decision calculation")) {
      return "Não foi possível consolidar o dossiê técnico. Informe base de receita válida para cálculo da decisão.";
    }
    if (normalized.includes("403")) {
      return "Você não possui autorização para consolidar tecnicamente esta análise.";
    }
    if (normalized.includes("422")) {
      return "Não foi possível consolidar o dossiê técnico. Verifique os dados importados e tente novamente.";
    }
    return message || "Não foi possível consolidar o dossiê técnico. Verifique os dados importados e tente novamente.";
  }

  async function ensureExternalDataEntryForTechnicalCalculation(analysisIdValue: number) {
    if (process.env.NODE_ENV !== "production") {
      console.debug("[dossie-step3] ensureExternalDataEntryForTechnicalCalculation:start", {
        analysisId: analysisIdValue,
        existingEntries: workspaceExternalDataQuery.data?.entries?.length ?? 0,
      });
    }
    const existingEntries = workspaceExternalDataQuery.data?.entries ?? [];
    if (existingEntries.length > 0) return;

    const agriskRestrictionsCount = Number(agriskImport.agriskReadPayload?.restrictions?.negative_events_count ?? 0);
    const agriskProtestsCount = Number(agriskImport.agriskReadPayload?.protests?.count ?? 0);
    const agriskProtestsAmount = Number(agriskImport.agriskReadPayload?.protests?.total_amount ?? 0);
    const agriskBouncedChecks = agriskImport.agriskReadPayload?.checks_without_funds?.has_records ? 1 : 0;
    const manualLawsuitsCount = manual.activeLawsuits ? 1 : 0;
    const manualLawsuitsAmount = manual.activeLawsuits ? Math.max(0, toNumberInput(manual.negativationsAmount)) : 0;
    const declaredRevenue = Math.max(0, toNumberInput(manualPanel.internalRevenue12m));
    const declaredIndebtedness = Math.max(0, mappedInternalOpenAmount ?? toNumberInput(manualPanel.outstandingValue));
    const hasRestrictions =
      agriskRestrictionsCount > 0 ||
      agriskProtestsCount > 0 ||
      agriskBouncedChecks > 0 ||
      manualLawsuitsCount > 0;

    const payload = {
      entry_method: "upload" as const,
      source_type: hasAgriskImported ? ("agrisk" as const) : ("other" as const),
      report_date: toIsoDate(agriskImport.importedAt ?? cofaceImport.importedAt ?? null),
      source_score: effectiveScoreValue,
      source_rating: hasAgriskImported
        ? (agriskImport.agriskReadPayload?.credit?.rating ?? null)
        : (manualPanel.scoreSource ? `Manual:${manualPanel.scoreSource}` : null),
      has_restrictions: hasRestrictions,
      protests_count: hasRestrictions ? agriskProtestsCount : 0,
      protests_amount: hasRestrictions ? Math.max(0, agriskProtestsAmount) : 0,
      lawsuits_count: hasRestrictions ? manualLawsuitsCount : 0,
      lawsuits_amount: hasRestrictions ? manualLawsuitsAmount : 0,
      bounced_checks_count: hasRestrictions ? agriskBouncedChecks : 0,
      declared_revenue: declaredRevenue > 0 ? declaredRevenue : null,
      declared_indebtedness: declaredIndebtedness > 0 ? declaredIndebtedness : null,
      notes: [
        hasAgriskImported ? "AgRisk importado na etapa 2." : "Sem AgRisk importado; base manual consolidada.",
        hasCofaceImported ? "COFACE importado na etapa 2." : "Sem COFACE importado.",
        "Entrada gerada automaticamente para viabilizar cálculo canônico de score e decisão."
      ].join(" ")
    };

    await createExternalDataEntry(analysisIdValue, payload);
    await refetchWorkspaceExternalDataIfPossible();
    if (process.env.NODE_ENV !== "production") {
      console.debug("[dossie-step3] ensureExternalDataEntryForTechnicalCalculation:created", {
        analysisId: analysisIdValue,
      });
    }
  }

  async function ensureTechnicalDossierCalculatedForStep4() {
    if (isOperationalSubmitOnlyFlow) return;
    if (!hasValidActiveAnalysisId || !activeAnalysisId) {
      throw new Error("Não foi possível carregar a análise. Identificador da análise ausente.");
    }
    console.warn("[STEP3_ADVANCE] ensure started");
    if (process.env.NODE_ENV !== "production") {
      console.debug("[dossie-step3] ensureTechnicalDossierCalculatedForStep4:start", {
        analysisId: activeAnalysisId,
        step,
        availableActions: workflowAvailableActions,
      });
    }
    const latestDetailResult = await refetchWorkspaceDetailIfPossible();
    const latestDetail = latestDetailResult?.data ?? workspaceDetailQuery.data ?? null;
    const status = latestDetail?.analysis?.technical_dossier_status;
    if (status?.is_completed === true && latestDetail?.score?.score_pillars?.available === true) return;
    const analysisStatus = latestDetail?.analysis?.analysis_status;
    if (analysisStatus === "created") {
      console.warn("[STEP3_ADVANCE] starting analysis before technical consolidation");
      await startCreditAnalysis(activeAnalysisId);
      await refetchWorkspaceDetailIfPossible();
    }
    console.warn("[STEP3_ADVANCE] ensuring external data");
    await ensureExternalDataEntryForTechnicalCalculation(activeAnalysisId);
    console.warn("[STEP3_ADVANCE] calculating score");
    console.warn("[STEP3_ADVANCE] calculating decision");
    let calculationError: unknown = null;
    try {
      await calculateTechnicalDossierMutation.mutateAsync(activeAnalysisId);
    } catch (error) {
      calculationError = error;
    }
    console.warn("[STEP3_ADVANCE] refetching detail");
    await refetchWorkspaceDetailIfPossible();
    if (calculationError) throw calculationError;
    console.warn("[STEP3_ADVANCE] ensure completed");
    if (process.env.NODE_ENV !== "production") {
      console.debug("[dossie-step3] ensureTechnicalDossierCalculatedForStep4:done", {
        analysisId: activeAnalysisId,
        motorResult: workspaceDetailQuery.data?.analysis?.motor_result,
        decisionCalculatedAt: workspaceDetailQuery.data?.analysis?.decision_calculated_at,
      });
    }
  }

  step3EnsureTechnicalDossierRef.current = ensureTechnicalDossierCalculatedForStep4;

  function handleApprovalSubmissionSuccessClose() {
    setApprovalSubmissionSuccessModalOpen(false);
    router.push("/analises/monitor?approvalSubmission=success");
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
  const isCurrentDraftGovernanceRecord =
    governanceStatus?.state === "in_progress" &&
    Boolean(activeAnalysisId) &&
    governanceStatus.analysis_id === activeAnalysisId;
  const isStep1GovernanceBlocked = isGovernanceBlocked && !isCurrentDraftGovernanceRecord;
  const isGovernanceInProgress = governanceStatus?.state === "in_progress";
  const isGovernanceRecentlyCompleted = governanceStatus?.state === "recently_completed";
  const governanceDecisionDateLabel = governanceStatus?.decision_date
    ? new Date(governanceStatus.decision_date).toLocaleDateString("pt-BR")
    : null;
  const governanceNextAllowedDateLabel = governanceStatus?.next_allowed_date
    ? new Date(governanceStatus.next_allowed_date).toLocaleDateString("pt-BR")
    : null;

  const canContinue = step === 1 ?normalizedCnpj.length === 14 && Boolean(customer.companyName) && !isStep1GovernanceBlocked : step === 2 ?hasStep2Source : step === 3 ?toNumberInput(analysis.requestedLimit) > 0 : true;
  const submitBlockingError = isOperationalSubmitOnlyFlow
    ? (validateStep(1) ?? (toNumberInput(analysis.requestedLimit) <= 0 ? "Preencha Limite solicitado com valor maior que zero." : null))
    : (validateStep(1) ?? validateStep(2) ?? validateStep(3));
  const backendAdvertisesSubmitApproval = workflowAvailableActions.includes("submit_approval") || workflowAvailableActions.includes("submit_for_approval");
  const technicalDossierStatus = workspaceDetailQuery.data?.analysis?.technical_dossier_status ?? null;
  const hasCanonicalTechnicalDecision =
    technicalDossierStatus?.is_completed === true &&
    workspaceDetailQuery.data?.analysis?.motor_result !== null &&
    workspaceDetailQuery.data?.analysis?.decision_calculated_at !== null;
  const shouldShowTechnicalPendingGuidance =
    isWorkspaceMode &&
    step === 4 &&
    !backendAdvertisesSubmitApproval &&
    Boolean(technicalDossierStatus) &&
    technicalDossierStatus?.is_completed === false;
  const isTechnicalDossierCalculationPending = calculateTechnicalDossierMutation.isPending || isStep3AdvancePending;
  const isSubmitPending =
    submitMutation.isPending ||
    triageSubmitMutation.isPending ||
    submitForApprovalMutation.isPending ||
    isTechnicalDossierCalculationPending;
  const canSubmitJourney = !submitBlockingError && !isSubmitPending && !isStep1GovernanceBlocked;
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
      key: "internal",
      name: "Dados internos da carteira",
      isSent: hasInternalDataAvailable,
      detail: hasInternalDataAvailable
        ? "Dados financeiros e histórico disponíveis automaticamente"
        : "Sem histórico interno disponível para o cliente"
    }
  ];
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
  const step1LibraryDocuments = uploadedStep1Documents
    .filter((item) =>
      step1DocumentDefinitions.some(
        (definition) => definition.key === (item.document_type as Step1DocumentType)
      )
    )
    .sort((a, b) => new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime());
  const hasStep1LibraryDocuments = step1LibraryDocuments.length > 0;
  const documentLibraryPreview = step1LibraryDocuments.slice(0, 5);
  const hasMoreLibraryDocuments = step1LibraryDocuments.length > documentLibraryPreview.length;
  const technicalRequestedLimit = toNumberInput(analysis.requestedLimit);
  const technicalExposureValue = internalExposure > 0 ? internalExposure : technicalRequestedLimit;
  const technicalCoverageValue = cofaceDecisionAmount;
  const technicalOverdueValue = internalOverdue;
  const technicalAgriskScoreRaw = agriskImport.agriskReadPayload?.credit?.score ?? null;
  const technicalAgriskScore = technicalAgriskScoreRaw !== null ? Number(technicalAgriskScoreRaw) : null;
  const technicalStatusLabel = !hasAgriskImported && !hasCofaceImported && !hasStep1LibraryDocuments
    ? "Aguardando documentos"
    : hasAgriskImported && hasCofaceImported && hasStep1LibraryDocuments && hasInternalFinancialSnapshot
      ? "Completa"
      : (hasAgriskImported || hasCofaceImported || hasStep1LibraryDocuments || hasInternalFinancialSnapshot)
        ? "Análise parcial"
        : "Em análise";
  const technicalStatusClass = technicalStatusLabel === "Completa"
    ? "bg-[#EAF7EE] text-[#166534]"
    : technicalStatusLabel === "Aguardando documentos"
      ? "bg-[#FFF7E8] text-[#92400E]"
      : "bg-[#EEF3F8] text-[#4F647A]";
  const workspaceTriageSubmission =
    workspaceDetailQuery.data?.analysis?.decision_memory_json &&
    typeof workspaceDetailQuery.data.analysis.decision_memory_json === "object" &&
    workspaceDetailQuery.data.analysis.decision_memory_json.triage_submission &&
    typeof workspaceDetailQuery.data.analysis.decision_memory_json.triage_submission === "object"
      ? (workspaceDetailQuery.data.analysis.decision_memory_json.triage_submission as Record<string, unknown>)
      : null;
  const workspaceRequesterFromTriageSubmission =
    (typeof workspaceTriageSubmission?.requester_name === "string" && workspaceTriageSubmission.requester_name.trim()) ||
    (typeof workspaceTriageSubmission?.created_by === "string" && workspaceTriageSubmission.created_by.trim()) ||
    (typeof workspaceTriageSubmission?.requested_by === "string" && workspaceTriageSubmission.requested_by.trim()) ||
    (typeof workspaceTriageSubmission?.solicitante === "string" && workspaceTriageSubmission.solicitante.trim()) ||
    (typeof workspaceTriageSubmission?.actor_user === "string" && workspaceTriageSubmission.actor_user.trim()) ||
    null;
  const requesterFromEvents =
    workspaceDetailQuery.data?.events?.find((event) => event.event_type === "analysis_created" && event.actor_name?.trim())?.actor_name?.trim() ??
    null;
  const currentUserName = getCurrentUserDisplayName();
  const requesterLabel =
    requesterFromEvents ??
    workspaceRequesterFromTriageSubmission ??
    (currentUserName !== "Usuário não identificado" ? currentUserName : null) ??
    "Não informado";
  const isPortfolioCustomer =
    Boolean(triageResult?.found_in_portfolio) ||
    (typeof workspaceTriageSubmission?.source === "string" && workspaceTriageSubmission.source === "portfolio") ||
    (typeof workspaceTriageSubmission?.found_in_portfolio === "boolean" && workspaceTriageSubmission.found_in_portfolio);
  const triageEconomicPositionSource =
    triageResult?.economic_position && typeof triageResult.economic_position === "object"
      ? (triageResult.economic_position as unknown as Record<string, unknown>)
      : null;
  const workspaceInternalPositionSource =
    workspaceInternalPosition && typeof workspaceInternalPosition === "object"
      ? (workspaceInternalPosition as unknown as Record<string, unknown>)
      : null;
  const workspacePortfolioDataSource =
    workspaceTriageSubmission?.portfolio_data && typeof workspaceTriageSubmission.portfolio_data === "object"
      ? (workspaceTriageSubmission.portfolio_data as Record<string, unknown>)
      : null;
  const internalValueSources: Array<Record<string, unknown> | null> = [
    triageEconomicPositionSource,
    workspaceInternalPositionSource,
    workspacePortfolioDataSource
  ];
  const canonicalInternalSummary = resolveInternalPortfolioSummaryFromSources({
    sources: internalValueSources,
  });
  const mappedInternalOpenAmount = canonicalInternalSummary.openAmount;
  const mappedInternalTotalLimit = canonicalInternalSummary.currentLimit;
  const mappedInternalAvailableLimit = canonicalInternalSummary.availableLimit;
  const mappedInternalOverdue = canonicalInternalSummary.overdueAmount;
  const mappedInternalNotDue = canonicalInternalSummary.notDueAmount;
  const hasAnyMappedFinancialValue =
    mappedInternalOpenAmount !== null || mappedInternalTotalLimit !== null || mappedInternalAvailableLimit !== null;
  const hasInternalPositionData =
    hasAnyMappedFinancialValue || mappedInternalNotDue !== null || mappedInternalOverdue !== null;
  const internalLastUpdatedLabel =
    (typeof triageEconomicPositionSource?.base_date === "string" && triageEconomicPositionSource.base_date.trim()
      ? new Date(triageEconomicPositionSource.base_date).toLocaleDateString("pt-BR")
      : null) ||
    (typeof workspaceInternalPositionSource?.base_date === "string" && workspaceInternalPositionSource.base_date.trim()
      ? new Date(workspaceInternalPositionSource.base_date).toLocaleDateString("pt-BR")
      : null);
  const executiveCoveragePercent = technicalCoverageValue !== null && technicalRequestedLimit > 0
    ? Math.max(0, Math.round((technicalCoverageValue / technicalRequestedLimit) * 100))
    : null;
  const executiveOverdueAmount = mappedInternalOverdue;
  const executiveNotDueAmount = mappedInternalNotDue;
  const executiveOverdueTotal = mappedInternalOpenAmount !== null
    ? mappedInternalOpenAmount
    : executiveOverdueAmount !== null && executiveNotDueAmount !== null
      ? executiveOverdueAmount + executiveNotDueAmount
      : null;
  const executiveOverduePercent = executiveOverdueAmount !== null && executiveOverdueTotal !== null
    ? executiveOverdueTotal > 0
      ? Math.max(0, Math.min(100, Math.round((executiveOverdueAmount / executiveOverdueTotal) * 100)))
      : 0
    : null;

  useEffect(() => {
    if (mappedInternalOpenAmount === null || mappedInternalOverdue === null || mappedInternalNotDue === null) return;
    const delta = Math.abs(mappedInternalOpenAmount - (mappedInternalOverdue + mappedInternalNotDue));
    if (delta > 1) {
      console.warn("Inconsistência na composição da carteira interna", {
        open_amount: mappedInternalOpenAmount,
        overdue_amount: mappedInternalOverdue,
        not_due_amount: mappedInternalNotDue,
        delta
      });
    }
  }, [mappedInternalNotDue, mappedInternalOpenAmount, mappedInternalOverdue]);

  const economicGroupLabel =
    triageResult?.customer_data.economic_group?.trim() ||
    (typeof workspaceTriageSubmission?.economic_group === "string" ? workspaceTriageSubmission.economic_group.trim() : "") ||
    "Não informado";
  const technicalCards = [
    {
      key: "exposure",
      label: "Exposição Atual",
      value: technicalExposureValue > 0 ? formatCurrencyBRL(String(technicalExposureValue)) : "Não disponível",
      subtitle: "Carteira interna"
    },
    {
      key: "coverage",
      label: "Cobertura Segurada",
      value: technicalCoverageValue !== null ? formatCurrencyBRL(String(technicalCoverageValue)) : "Não disponível",
      subtitle: "COFACE"
    },
    {
      key: "relationship",
      label: "Histórico de Relacionamento",
      value: hasInternalFinancialSnapshot ? "Histórico positivo" : "Informações insuficientes",
      subtitle: "Base interna"
    },
    {
      key: "agrisk",
      label: "Risco Agrisk",
      value: technicalAgriskScore !== null ? `${technicalAgriskScore.toFixed(0)}/10` : "Informações insuficientes",
      subtitle: "Agrisk"
    },
    {
      key: "docs",
      label: "Documentação",
      value: `${step1LibraryDocuments.length} anexado${step1LibraryDocuments.length === 1 ? "" : "s"}`,
      subtitle: "Etapa de identificação"
    },
    {
      key: "overdue",
      label: "Overdue Interno",
      value: technicalOverdueValue !== null ? formatCurrencyBRL(String(technicalOverdueValue)) : "Não disponível",
      subtitle: "Carteira"
    }
  ];
  const hasValidCofaceCoverage = technicalCoverageValue !== null && technicalCoverageValue > 0;
  const scorePillarsContract = workspaceDetailQuery.data?.score?.score_pillars ?? null;
  const scorePillarsUnavailableReason = !hasValidActiveAnalysisId
    ? "Não foi possível carregar a análise. Identificador da análise ausente."
    : scorePillarsContract && !scorePillarsContract.available
      ? scorePillarsContract.reason ?? "Score por pilares indisponível para esta análise."
      : null;
  const backendExecutiveScore10 = resolveExecutiveScore10(workspaceDetailQuery.data?.score);
  const institutionalScore = scorePillarsContract?.available && backendExecutiveScore10 !== null
    ? backendExecutiveScore10
    : null;
  const institutionalScoreDisplay = formatExecutiveScore10(institutionalScore);
  const policyPillars: PolicyPillar[] = scorePillarsContract?.available
    ? SCORE_PILLAR_DEFINITIONS.map((definition) => {
      const item = findScorePillarItem(scorePillarsContract, definition);
      const score = toNullableNumeric(item?.score);
      const weight = toNullableNumeric(item?.weight_percent) ?? definition.weight;
      const reason = reasonFromScorePillarItem(item);
      const warnings = (item?.warnings ?? [])
        .map((warning) => {
          if (typeof warning === "string") return warning;
          try {
            return JSON.stringify(warning) ?? String(warning);
          } catch {
            return String(warning);
          }
        })
        .filter((warning) => warning.trim().length > 0);
      return {
        key: definition.key,
        title: item?.name ?? definition.title,
        weight,
        score,
        status: statusFromScorePillarItem(item, score),
        summary: reason,
        sources: [sourceLabelFromScorePillarItem(item)],
        criteria: warnings.length > 0 ? warnings : [reason],
        explanation: reason,
        tooltip: {
          title: item?.name ?? definition.title,
          description: definition.description,
          source: sourceLabelFromScorePillarItem(item),
          note: score !== null ? `Score calculado pelo backend: ${score.toFixed(1)}/10.` : reason,
          weightLabel: `Peso do Pilar: ${weight}%`
        }
      };
    })
    : [];
  const guaranteeCoverageHelperText = policyPillars.find((pillar) => pillar.key === "guarantees")?.summary ?? "Pilar indisponível no contrato oficial do backend.";
  const paymentPillarHelperText = policyPillars.find((pillar) => pillar.key === "payment_history")?.summary ?? "Pilar indisponível no contrato oficial do backend.";
  const relationshipPillarHelperText = policyPillars.find((pillar) => pillar.key === "relationship_history")?.summary ?? "Pilar indisponível no contrato oficial do backend.";
  const institutionalScoreBreakdown: InstitutionalScoreBreakdownItem[] = policyPillars
    .map((pillar) => ({
      key: pillar.key,
      title: pillar.title,
      weight: pillar.weight,
      score: pillar.score,
      weighted: pillar.score !== null ? toNullableNumeric(findScorePillarItem(scorePillarsContract, {
        code: SCORE_PILLAR_DEFINITIONS.find((definition) => definition.key === pillar.key)?.code ?? pillar.key,
        aliases: SCORE_PILLAR_DEFINITIONS.find((definition) => definition.key === pillar.key)?.aliases ?? [],
        key: pillar.key,
        title: pillar.title,
        weight: pillar.weight,
        description: pillar.tooltip.description,
      })?.weighted_score) ?? pillar.score * pillar.weight : null,
      tooltip: pillar.tooltip
    }));
  const institutionalRiskBand = institutionalScore !== null ? toScoreBand(institutionalScore) : "Informações insuficientes";
  const executiveScoreBand = institutionalRiskBand.toUpperCase();
  const institutionalBandVisual = getScoreBandVisualTokens(institutionalRiskBand);
  const institutionalScorePercent = institutionalScore !== null ? Math.round(executiveScore10ToPercent(institutionalScore)) : 0;
  const institutionalScoreRingLength = 326.73;
  const institutionalScoreRingOffset = institutionalScore !== null
    ? institutionalScoreRingLength * (1 - (institutionalScorePercent / 100))
    : institutionalScoreRingLength;
  const institutionalSemanticLabel = scoreBandSemanticLabel(institutionalRiskBand);
  const executiveRiskProfile = (() => {
    if (executiveScoreBand === "AA") return "AA · Muito baixo";
    if (executiveScoreBand === "A") return "A · Baixo";
    if (executiveScoreBand === "B") return "B · Moderado";
    if (executiveScoreBand === "C") return "C · Atenção";
    if (executiveScoreBand === "D") return "D · Restritivo";
    return "Informações insuficientes";
  })();
  const executiveRiskAccentStyle = { borderTopColor: institutionalBandVisual.accent };
  const institutionalScoreSummary =
    institutionalScore === null
      ? "Informações insuficientes para cálculo consolidado."
      : institutionalScore >= 8
        ? "Leitura consolidada favorável, com pilares majoritariamente consistentes."
        : institutionalScore >= 6
          ? "Avaliação preliminar equilibrada, com pontos de atenção em pilares específicos."
          : institutionalScore >= 4
            ? "Leitura consolidada em atenção, com necessidade de reforço técnico."
            : "Avaliação preliminar crítica, com riscos relevantes na estrutura atual.";
  const backendRecommendationClassification = (() => {
    const decisionMemory = workspaceDetailQuery.data?.analysis?.decision_memory_json;
    if (!decisionMemory || typeof decisionMemory !== "object") return null;
    const classification = (decisionMemory as Record<string, unknown>).recommendation_classification;
    return classification && typeof classification === "object" ? (classification as Record<string, unknown>) : null;
  })();
  const backendFinalSuggestedLimit = (() => {
    const raw = backendRecommendationClassification?.final_suggested_limit;
    if (raw === undefined || raw === null) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? Math.max(parsed, 0) : null;
  })();
  const executiveCofaceCeilingApplied = false;
  const executiveDisplayedRecommendedLimit = backendFinalSuggestedLimit;
  const executiveCoverageAvailable = technicalCoverageValue !== null ? Math.max(technicalCoverageValue, 0) : 0;
  const executiveNetInternalExposure = executiveDisplayedRecommendedLimit !== null
    ? Math.max(executiveDisplayedRecommendedLimit - executiveCoverageAvailable, 0)
    : null;
  const internalPortfolioSummary = resolveInternalPortfolioSummaryFromSources({
    sources: internalValueSources,
    residualExposure: executiveNetInternalExposure,
  });
  const approvalFlowSummary = workspaceDetailQuery.data?.approval_flow_summary ?? null;
  const approvalFlowState = approvalFlowSummary?.flow_state ?? approvalFlowSummary?.approval_flow_state ?? "not_submitted";
  const dossierApprovalActions = Array.from(new Set([...(workspaceDetailQuery.data?.analysis?.available_actions ?? []), ...(approvalFlowSummary?.available_actions ?? [])]));
  const approvalWorkflowController = useApprovalWorkflowController(activeAnalysisId);
  const hasActiveApprovalStep = Boolean(
    approvalFlowSummary?.current_approval_step ||
    approvalFlowSummary?.approval_progress?.some((item) => ["active", "in_committee"].includes(item.status.toLowerCase()))
  );
  const hasSubmittedForApproval = Boolean(workspaceDetailQuery.data?.analysis?.submitted_for_approval_at || approvalFlowSummary?.submitted_for_approval_at);
  const isApprovalExperience =
    internalOperationalStatus === "in_approval" ||
    approvalFlowState === "in_approval" ||
    hasActiveApprovalStep ||
    hasSubmittedForApproval;
  const canSubmitForApproval =
    isWorkspaceMode &&
    step === 4 &&
    hasValidActiveAnalysisId &&
    backendAdvertisesSubmitApproval &&
    !isApprovalExperience;
  const showAnalystSubmissionFooter =
    step === 4 &&
    !isOperationalSubmitOnlyFlow &&
    (!isWorkspaceMode || (!isApprovalExperience && (backendAdvertisesSubmitApproval || technicalDossierStatus?.is_completed === false)));
  const executiveExposureFullyCovered = executiveNetInternalExposure !== null && executiveNetInternalExposure === 0;
  const executiveExposureHasResidual = executiveNetInternalExposure !== null && executiveNetInternalExposure > 0;
  const executiveInternalSuggestedLimit = backendFinalSuggestedLimit;
  const recommendationClassification = backendRecommendationClassification;
  const step4RecommendationClassification = hasCanonicalTechnicalDecision ? recommendationClassification : null;
  const step4DisplayedRecommendedLimit = hasCanonicalTechnicalDecision ? executiveDisplayedRecommendedLimit : null;
  const recommendationClassificationLabel = (() => {
    const label = recommendationClassification?.label;
    return typeof label === "string" && label.trim() ? label : null;
  })();
  const engineRecommendedRaw = recommendationClassification?.engine_recommended_limit;
  const engineRecommendedLimit = (() => {
    if (engineRecommendedRaw === undefined || engineRecommendedRaw === null) return null;
    const parsed = Number(engineRecommendedRaw);
    return Number.isFinite(parsed) ? parsed : null;
  })();
  const preliminaryRiskLimitValue = engineRecommendedLimit ?? null;
  const insightRiskScoreText = institutionalScore !== null ? institutionalScoreDisplay : "Não informado";
  const insightRiskProfileText = institutionalRiskBand === "Informações insuficientes" ? "Perfil não identificado" : `Perfil ${institutionalRiskBand}`;
  const insightRiskLimitText = preliminaryRiskLimitValue !== null
    ? formatCurrencyBRLMM2(preliminaryRiskLimitValue)
    : "Limite calculado não disponível";
  const insightCofaceCoverageText = technicalCoverageValue !== null ? formatCurrencyBRLCompactExecutive(technicalCoverageValue) : "Não identificado";
  const insightCofaceMessage = technicalCoverageValue === null
    ? "Sem cobertura COFACE identificada"
    : executiveCofaceCeilingApplied
      ? "Cobertura COFACE aplicada como teto da recomendação"
      : "Cobertura considerada sem necessidade de limitar a recomendação";
  const insightExposureText = executiveNetInternalExposure !== null ? formatCurrencyBRLCompactExecutive(executiveNetInternalExposure) : "Não informado";
  const insightImpactText = recommendationClassification?.financial_impact !== undefined && recommendationClassification?.financial_impact !== null
    ? formatCurrencyBRLCompactExecutive(Number(recommendationClassification.financial_impact))
    : "Não informado";
  const insightOverdueText = mappedInternalOverdue !== null ? formatCurrencyBRLCompactExecutive(mappedInternalOverdue) : "Não informado";
  const insightOverdueMessage = mappedInternalOverdue === null
    ? "Sem dado disponível"
    : mappedInternalOverdue > 0
      ? "Overdue interno identificado"
      : "Sem overdue interno relevante";
  const insightRiskPrimary = !hasCanonicalTechnicalDecision
    ? "Cálculo técnico pendente"
    : institutionalScore !== null
    ? `${insightRiskProfileText} · Score ${insightRiskScoreText}`
    : "Perfil não identificado";
  const insightRiskSecondary = !hasCanonicalTechnicalDecision
    ? "Execute score e decisão técnica para consolidar o limite."
    : `Limite Calculado: ${insightRiskLimitText}`;
  const insightCofacePrimary = !hasCanonicalTechnicalDecision
    ? "Cobertura será aplicada após cálculo técnico."
    : technicalCoverageValue !== null
    ? `Cobertura ativa: ${insightCofaceCoverageText}`
    : "Sem cobertura COFACE identificada";
  const cofaceCoverageLimitedRecommendation =
    technicalCoverageValue !== null &&
    preliminaryRiskLimitValue !== null &&
    executiveDisplayedRecommendedLimit !== null &&
    preliminaryRiskLimitValue > technicalCoverageValue &&
    Math.abs(executiveDisplayedRecommendedLimit - technicalCoverageValue) < 1;
  const insightCofaceSecondary = !hasCanonicalTechnicalDecision
    ? "A recomendação final ainda não está persistida."
    : technicalCoverageValue !== null
    ? cofaceCoverageLimitedRecommendation
      ? "Recomendação limitada à cobertura disponível"
      : "Cobertura suficiente para suportar a recomendação"
    : "Sem cobertura COFACE identificada";
  const impactRaw = recommendationClassification?.financial_impact;
  const impactValue = impactRaw !== undefined && impactRaw !== null ? Number(impactRaw) : null;
  const currentApprovedLimit = mappedInternalTotalLimit;
  const recommendedLimitValue = executiveDisplayedRecommendedLimit;
  const coverageLimitValue = technicalCoverageValue;
  const incrementVsCurrent =
    recommendedLimitValue !== null && currentApprovedLimit !== null
      ? recommendedLimitValue - currentApprovedLimit
      : null;
  const reductionVsRequested =
    recommendedLimitValue !== null && technicalRequestedLimit > 0 && recommendedLimitValue < technicalRequestedLimit
      ? technicalRequestedLimit - recommendedLimitValue
      : null;
  const isMaintenanceWithinCoverage =
    recommendedLimitValue !== null &&
    currentApprovedLimit !== null &&
    coverageLimitValue !== null &&
    Math.abs(recommendedLimitValue - currentApprovedLimit) < 1 &&
    recommendedLimitValue <= coverageLimitValue;
  const insightExposurePrimary = !hasCanonicalTechnicalDecision
    ? "Exposição pendente de cálculo"
    : executiveNetInternalExposure === null
    ? "Sem dado disponível"
    : executiveNetInternalExposure > 0
      ? "Exposição residual identificada"
      : "Sem exposição residual";
  const insightExposureSecondary =
    !hasCanonicalTechnicalDecision
      ? "Finalize o cálculo técnico para apurar impacto e exposição residual."
      : executiveNetInternalExposure !== null && executiveNetInternalExposure > 0
      ? `Exposição residual: ${insightExposureText}`
      : isMaintenanceWithinCoverage
        ? "Limite mantido dentro da cobertura disponível"
        : incrementVsCurrent !== null && incrementVsCurrent > 0
          ? `Incremento aprovado: +${formatCurrencyBRLCompactExecutive(incrementVsCurrent)}`
          : reductionVsRequested !== null && reductionVsRequested > 0
            ? `Redução vs solicitado: -${formatCurrencyBRLCompactExecutive(reductionVsRequested)}`
            : impactValue === 0
              ? "Sem impacto financeiro"
              : impactValue !== null
                ? `${impactValue > 0 ? "Incremento aprovado" : "Redução recomendada"}: ${impactValue > 0 ? "+" : ""}${insightImpactText}`
                : "Sem dado disponível";
  const insightOverduePrimary = !hasCanonicalTechnicalDecision
    ? "Overdue aguardando consolidação técnica"
    : insightOverdueMessage;
  const insightOverdueSecondary = !hasCanonicalTechnicalDecision
    ? "A leitura final será exibida após o cálculo canônico."
    : mappedInternalOverdue === null
    ? "Sem dado disponível"
    : mappedInternalOverdue > 0
      ? `Overdue atual: ${insightOverdueText}`
      : "Carteira sem sinais relevantes de deterioração";
  const preliminaryMaxTermDays = institutionalRiskBand === "AA"
    ? 360
    : institutionalRiskBand === "A"
      ? 360
      : institutionalRiskBand === "B"
        ? 180
        : institutionalRiskBand === "C"
          ? 90
          : institutionalRiskBand === "D"
            ? null
            : null;
  const preliminaryGuaranteeCondition = technicalCoverageValue === null
    ? "Sem cobertura segurada"
    : technicalRequestedLimit > 0 && technicalCoverageValue >= technicalRequestedLimit
      ? "Cobertura COFACE compatível"
      : technicalRequestedLimit > 0 && technicalCoverageValue < technicalRequestedLimit
        ? "Necessária garantia complementar"
        : "Cobertura parcial identificada";
  const preliminaryRecommendationNotes = [
    technicalCoverageValue !== null && technicalRequestedLimit > 0 && technicalCoverageValue < technicalRequestedLimit
      ? "Limite solicitado excede cobertura segurada."
      : null,
    technicalOverdueValue !== null && technicalOverdueValue > 0 ? "Overdue interno relevante." : null,
    financialDocuments.length === 0 ? "Recomendação condicionada à revisão documental." : null,
    hasInternalFinancialSnapshot && (technicalOverdueValue === null || technicalOverdueValue <= 0) ? "Cliente apresenta histórico positivo." : null,
    !hasAgriskImported ? "Ausência de Agrisk limita a leitura de mercado." : null
  ].filter((item): item is string => Boolean(item)).slice(0, 5);
  const preliminaryInsights: TechnicalInsight[] = [];
  if (technicalCoverageValue !== null && technicalRequestedLimit > 0 && technicalCoverageValue >= technicalRequestedLimit) {
    preliminaryInsights.push({ kind: "positivo", text: "Cobertura COFACE compatível com o limite solicitado." });
  }
  if (technicalCoverageValue !== null && technicalRequestedLimit > 0 && technicalCoverageValue < technicalRequestedLimit) {
    preliminaryInsights.push({ kind: "alerta", text: "Limite solicitado excede cobertura segurada." });
  }
  if (technicalOverdueValue !== null && technicalOverdueValue > 0) {
    preliminaryInsights.push({ kind: "critico", text: "Cliente possui overdue relevante na carteira." });
  }
  if (hasInternalFinancialSnapshot && (technicalOverdueValue === null || technicalOverdueValue <= 0)) {
    preliminaryInsights.push({ kind: "positivo", text: "Cliente possui histórico positivo de relacionamento." });
  }
  if (!hasAgriskImported) {
    preliminaryInsights.push({ kind: "alerta", text: "Nenhum relatório Agrisk anexado." });
  }
  if (financialDocuments.length === 0) {
    preliminaryInsights.push({ kind: "alerta", text: "Documentação financeira incompleta." });
  }
  if (institutionalScore !== null) {
    preliminaryInsights.push({ kind: "positivo", text: `Score preliminar compatível com grupo de risco ${institutionalRiskBand}.` });
  }
  const guaranteesPillar = policyPillars.find((pillar) => pillar.key === "guarantees");
  if (guaranteesPillar && (guaranteesPillar.status === "Atenção" || guaranteesPillar.status === "Crítico")) {
    preliminaryInsights.push({ kind: "alerta", text: "Garantias reduzem a nota consolidada." });
  }
  const relationshipPillar = policyPillars.find((pillar) => pillar.key === "relationship_history");
  if (relationshipPillar && (relationshipPillar.status === "Forte" || relationshipPillar.status === "Adequado")) {
    preliminaryInsights.push({ kind: "positivo", text: "Histórico de relacionamento contribuiu positivamente." });
  }
  const criticalPillars = policyPillars.filter((pillar) => pillar.status === "Crítico");
  if (criticalPillars.length > 0) {
    preliminaryInsights.push({ kind: "critico", text: `Pilares críticos identificados: ${criticalPillars.map((pillar) => pillar.title).join("; ")}.` });
  }
  const technicalInsights = preliminaryInsights.slice(0, 6);
  const criticalExecutiveInsights = technicalInsights
    .filter((insight) => insight.kind === "critico" || insight.kind === "alerta")
    .slice(0, 3);
  const executiveInsights = (criticalExecutiveInsights.length > 0 ? criticalExecutiveInsights : technicalInsights).slice(0, 3);
  const preliminaryEligibility = isGovernanceBlocked
    ? { label: "Cliente bloqueado", className: "text-[#B91C1C]", tone: "bg-[#FEF2F2] border-[#FECACA]" }
    : financialDocuments.length === 0
      ? { label: "Documentação incompleta", className: "text-[#92400E]", tone: "bg-[#FFF7E8] border-[#FDE68A]" }
      : technicalCoverageValue !== null && technicalRequestedLimit > 0 && technicalCoverageValue < technicalRequestedLimit
        ? { label: "Cobertura parcial", className: "text-[#92400E]", tone: "bg-[#FFF7E8] border-[#FDE68A]" }
        : { label: "Elegível para análise", className: "text-[#166534]", tone: "bg-[#EAF7EE] border-[#BBF7D0]" };

  function saveStep1MetadataPatch(patch: Partial<{ requestedLimit: string; termDays: string; businessUnit: string; customerType: string; operationModality: string; contactName: string; contactPhone: string; contactEmail: string }>) {
    if (!hasStep1Workspace) return;
    if (isStep1ReadOnly) return;
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

  function resolveDocumentTypeLabel(documentType: string) {
    if (documentType === "coface_report") return "Relatório COFACE";
    if (documentType === "agrisk_report") return "Relatório AgRisk";
    const match = step1DocumentDefinitions.find((definition) => definition.key === (documentType as Step1DocumentType));
    return match?.label ?? "Documento";
  }

  function shouldOpenInline(mimeType: string | null | undefined) {
    const normalized = (mimeType ?? "").toLowerCase();
    return normalized === "application/pdf" || normalized.startsWith("image/");
  }

  async function handleOpenLibraryDocument(document: AnalysisDocumentDto) {
    if (!activeAnalysisId) {
      setDocumentLibraryFeedback("Arquivo indisponível no momento.");
      return;
    }
    try {
      setDocumentLibraryFeedback(null);
      const isInline = shouldOpenInline(document.mime_type);
      const downloadUrl = `/api/credit-analyses/${activeAnalysisId}/documents/${document.id}/download`;

      if (isInline) {
        const opened = window.open(downloadUrl, "_blank", "noopener,noreferrer");
        if (!opened) {
          setDocumentLibraryFeedback("Não foi possível abrir uma nova aba. Verifique o bloqueador de pop-up.");
        }
        return;
      }

      const response = await downloadAnalysisDocument(activeAnalysisId, document.id);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = window.document.createElement("a");
      link.href = blobUrl;
      link.download = document.original_filename || "documento";
      window.document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Arquivo indisponível no momento.";
      setDocumentLibraryFeedback(message);
    }
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
    if (isStep1ReadOnly) {
      setDocumentUploadFeedback({ type: "error", message: "Esta solicitação já foi submetida para análise e não pode ser alterada nesta etapa." });
      return;
    }
    if (!file) {
      setDocumentUploadFeedback({ type: "error", message: "Arquivo inválido ou ausente." });
      return;
    }
    const resolvedAnalysisId = ensureStep1Workspace("A consulta do CNPJ ainda não preparou a solicitação para anexar documentos.");
    if (!resolvedAnalysisId) return;
    setDocumentUploadFeedback(null);
    await uploadStep1DocumentMutation.mutateAsync({ analysisId: resolvedAnalysisId, documentType, file });
  }

  async function handleFinancialDocumentsUpload(files: File[]) {
    if (isStep1ReadOnly) {
      setDocumentUploadFeedback({ type: "error", message: "Esta solicitação já foi submetida para análise e não pode ser alterada nesta etapa." });
      return;
    }
    if (files.length === 0) {
      setDocumentUploadFeedback({ type: "error", message: "Arquivo inválido ou ausente." });
      return;
    }
    const resolvedAnalysisId = ensureStep1Workspace("A consulta do CNPJ ainda não preparou a solicitação para anexar documentos.");
    if (!resolvedAnalysisId) return;
    setDocumentUploadFeedback(null);
    for (const file of files) {
      await uploadStep1DocumentMutation.mutateAsync({ analysisId: resolvedAnalysisId, documentType: financialDocumentType, file });
    }
  }

  function isBasicEmailValid(value: string) {
    const normalized = value.trim();
    if (!normalized) return true;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
  }

  function handleAddCommercialReference() {
    if (isStep1ReadOnly) {
      setCommercialReferenceForm((prev) => ({ ...prev, error: "Esta solicitação já foi submetida para análise e não pode ser alterada nesta etapa." }));
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

    if (!hasStep1Workspace || !activeAnalysisId) {
      setCommercialReferenceForm((prev) => ({ ...prev, error: "A consulta do CNPJ ainda não preparou a solicitação para incluir referências." }));
      return;
    }

    const resolvedAnalysisId = activeAnalysisId;

    createCommercialReferenceMutation.mutate(
      {
        analysisId: resolvedAnalysisId,
        payload: { name, phone: phone || null, email: email || null }
      },
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
                <button
                  type="button"
                  onClick={() => setTriageModalOpen(true)}
                  disabled={isStep1ReadOnly}
                  className="rounded-[8px] border border-[#D7E1EC] bg-white px-3 py-1.5 text-[11px] font-medium text-[#102033] hover:bg-[#F2F6FB] disabled:cursor-not-allowed disabled:opacity-60"
                >
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

          {draftRecovery ? (
            <div className="rounded-[10px] border border-[#BFDBFE] bg-[#EFF6FF] px-4 py-3 text-[12px] text-[#1E3A8A]">
              <p className="font-medium">Rascunho disponível para este CNPJ.</p>
              <p className="mt-1">
                Expira em {new Date(draftRecovery.expires_at).toLocaleString("pt-BR")}.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleContinueDraft()}
                  className="rounded-[8px] border border-[#93C5FD] bg-white px-3 py-1.5 text-[11px] font-medium text-[#1E40AF] hover:bg-[#EFF6FF]"
                >
                  Continuar rascunho
                </button>
                <button
                  type="button"
                  onClick={() => void handleDiscardDraft()}
                  className="rounded-[8px] border border-[#FECACA] bg-white px-3 py-1.5 text-[11px] font-medium text-[#B91C1C] hover:bg-[#FEF2F2]"
                >
                  Descartar rascunho
                </button>
              </div>
            </div>
          ) : null}

          <p className="text-[13px] font-medium text-[#111827]">Informe o CNPJ para identificar o cliente</p>
          {isStep1ReadOnly ? (
            <div className="rounded-[10px] border border-[#D7E1EC] bg-[#F7F9FC] px-4 py-3 text-[12px] text-[#4F647A]">
              Esta etapa está em modo consulta. A solicitação já foi submetida para análise e os dados de abertura não podem ser alterados.
            </div>
          ) : null}
          <label className="block text-[12px] text-[#374151]">
            CNPJ<RequiredMark />
            <input
              value={customer.cnpj}
              disabled={isStep1ReadOnly}
              onChange={(event) => {
                setExistingCustomerId(null);
                setGovernanceStatus(null);
                setDraftRecovery(null);
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

          <fieldset disabled={isStep1GovernanceBlocked || isStep1ReadOnly} className="contents">
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
                      <label className={`rounded-[8px] border border-[#D7E1EC] bg-white px-2.5 py-1 text-[10px] font-medium text-[#102033] ${uploadStep1DocumentMutation.isPending || isStep1ReadOnly ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-[#F2F6FB]"}`}>
                        Upload
                        <input
                          type="file"
                          className="hidden"
                          disabled={uploadStep1DocumentMutation.isPending || isStep1ReadOnly}
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
                  <label className={`inline-flex items-center rounded-[8px] border border-[#D7E1EC] bg-white px-3 py-1.5 text-[11px] font-medium text-[#102033] ${uploadStep1DocumentMutation.isPending || isStep1ReadOnly ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-[#F2F6FB]"}`}>
                    Adicionar arquivos
                    <input
                      type="file"
                      multiple
                      className="hidden"
                      disabled={uploadStep1DocumentMutation.isPending || isStep1ReadOnly}
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
                          disabled={isStep1ReadOnly}
                          onClick={() => deleteStep1DocumentMutation.mutate(doc.id)}
                          className="rounded-[8px] border border-[#F2D4D4] bg-white px-2.5 py-1 text-[10px] font-medium text-[#B91C1C] hover:bg-[#FEF2F2] disabled:cursor-not-allowed disabled:opacity-50"
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
                    disabled={!hasStep1Workspace || isStep1ReadOnly || createCommercialReferenceMutation.isPending}
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
                                disabled={isStep1ReadOnly}
                                onClick={() => deleteCommercialReferenceMutation.mutate(reference.id)}
                                className="rounded-[8px] border border-[#F2D4D4] bg-white px-2.5 py-1 text-[10px] font-medium text-[#B91C1C] hover:bg-[#FEF2F2] disabled:cursor-not-allowed disabled:opacity-50"
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

      {step === 2 && !isOperationalSubmitOnlyFlow ?(
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

      {step === 2 ?(
        <>
          <article className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[15px] font-semibold text-[#102033]">{step === 2 ? "Coleta de informações" : "Mesa de análise"}</p>
                <p className="text-[12px] text-[#4F647A]">
                  {step === 2
                    ? "Consolide as fontes operacionais que irão alimentar a mesa de análise."
                    : "Interpretação técnica consolidada das fontes coletadas para apoio da decisão."}
                </p>
              </div>
              <div className="space-y-1 text-right">
                <p className="text-[11px] font-medium text-[#4F647A]">{structuredSourcesCount} de 3 fontes estruturadas preenchidas</p>
                {isStep2Ready ?<p className="text-[11px] text-[#166534]">Dados suficientes para avançar para a próxima etapa</p> : null}
              </div>
            </div>

            {step === 2 ? (
              <section className="rounded-[14px] border border-[#D7E1EC] bg-white px-6 py-4">
                <div className="mb-1 flex items-center justify-between gap-3">
                  <p className="text-[14px] font-semibold text-[#102033]">Contexto da solicitação</p>
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${technicalStatusClass}`}>
                    {!hasStep2Source ? "Coleta não iniciada" : hasStep2Source && !isStep2Ready ? "Coleta parcial" : "Coleta completa"}
                  </span>
                </div>
                <p className="text-[11px] text-[#4F647A]">Resumo da abertura feita pelo solicitante.</p>
                <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <div><p className="text-[10px] uppercase text-[#8FA3B4]">Cliente / razão social</p><p className="text-[12px] font-medium text-[#102033]">{customer.companyName || "Não informado"}</p></div>
                  <div><p className="text-[10px] uppercase text-[#8FA3B4]">CNPJ</p><p className="text-[12px] font-medium text-[#102033]">{formatCnpjForDisplay(customer.cnpj) || "Não informado"}</p></div>
                  <div><p className="text-[10px] uppercase text-[#8FA3B4]">Grupo econômico</p><p className="text-[12px] font-medium text-[#102033]">{economicGroupLabel}</p></div>
                  <div><p className="text-[10px] uppercase text-[#8FA3B4]">Limite solicitado</p><p className="text-[12px] font-medium text-[#102033]">{toNumberInput(analysis.requestedLimit) > 0 ? formatCurrencyBRL(analysis.requestedLimit) : "Aguardando dados"}</p></div>
                  <div><p className="text-[10px] uppercase text-[#8FA3B4]">Solicitante</p><p className="text-[12px] font-medium text-[#102033]">{requesterLabel}</p></div>
                  <div><p className="text-[10px] uppercase text-[#8FA3B4]">Data da solicitação</p><p className="text-[12px] font-medium text-[#102033]">{new Date().toLocaleDateString("pt-BR")}</p></div>
                </div>
              </section>
            ) : null}

            {step === 2 ? (
            <div className="rounded-[14px] border border-[#D7E1EC] bg-white px-6 py-4">
              <p className="text-[14px] font-semibold text-[#102033]">Fontes da análise</p>
              <p className="mt-1 text-[11px] text-[#4F647A]">Importe ou confirme as fontes que irão alimentar a mesa de análise.</p>
            </div>
            ) : null}

            {step === 2 ? (
            <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div
                className={`relative flex h-full flex-col rounded-[16px] border-2 ${
                  agriskImport.status !== "empty" || agriskFinancialImport.status !== "empty" ? "border-[#10B981]" : "border-[#295B9A]"
                } bg-white px-4 pb-3 pt-4 text-left transition hover:-translate-y-0.5 hover:shadow-[0_10px_30px_rgba(16,32,51,0.08)]`}
              >
                <span className="absolute left-4 top-0 -translate-y-1/2 rounded-full bg-[#295B9A] px-3 py-1 text-[10px] font-semibold text-white">Principal</span>
                <div className="mb-1.5 flex items-start gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#EEF3F8]">
                    <Upload className="h-3.5 w-3.5 text-[#295B9A]" />
                  </div>
                  <div className="min-w-0">
                    <p className="mb-0.5 text-[10px] uppercase tracking-[0.6px] text-[#8FA3B4]">Consulta externa</p>
                    <p className="text-[15px] font-semibold text-[#102033]">Agrisk</p>
                    <p className="mt-0.5 text-[11px] leading-snug text-[#4F647A]">Score/riscos e análise financeira.</p>
                  </div>
                </div>
                <div className="divide-y divide-[#EEF3F8]">
                  <AgriskSubreportPanel
                    source="agrisk"
                    state={agriskImport}
                    onImport={() => openImportModal("agrisk")}
                    onRemove={() => removeImport("agrisk")}
                    onView={() => setIsAgriskDataDrawerOpen(true)}
                  />
                  <AgriskSubreportPanel
                    source="agrisk_financial"
                    state={agriskFinancialImport}
                    onImport={() => openImportModal("agrisk_financial")}
                    onRemove={() => removeImport("agrisk_financial")}
                    onView={() => setIsAgriskFinancialDataDrawerOpen(true)}
                  />
                </div>
              </div>

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
                isPortfolioCustomer ? "border-[#10B981]" : "border-[#D7E1EC]"
              }`}>
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div className="flex h-11 w-11 items-center justify-center rounded-[12px] bg-[#F7F9FC]">
                    <Building2 className="h-5 w-5 text-[#4F647A]" />
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    isPortfolioCustomer ? "bg-[#EAF7EE] text-[#166534]" : "bg-[#EEF3F8] text-[#4F647A]"
                  }`}>
                    {isPortfolioCustomer ? "dados internos disponíveis" : "sem histórico interno"}
                  </span>
                </div>
                {isPortfolioCustomer ? (
                  <div className="rounded-[10px] border border-[#D7E1EC] bg-[#F8FBFF] p-3">
                    <p className="mb-1 text-[10px] uppercase tracking-[0.6px] text-[#8FA3B4]">Base interna</p>
                    <p className="mb-2 text-[15px] font-semibold text-[#102033]">Carteira Corporativa</p>
                    <p className="text-[10px] font-medium uppercase tracking-[0.5px] text-[#8FA3B4]">Resumo financeiro interno</p>
                    <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div>
                        <p className="text-[10px] text-[#8FA3B4]">Valor em Aberto</p>
                        <p className="mt-0.5 text-[12px] font-semibold text-[#102033]">{mappedInternalOpenAmount !== null ? formatCurrencyBRLNoCents(mappedInternalOpenAmount) : "Sem registro"}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-[#8FA3B4]">Limite Total</p>
                        <p className="mt-0.5 text-[12px] font-semibold text-[#102033]">{mappedInternalTotalLimit !== null ? formatCurrencyBRLNoCents(mappedInternalTotalLimit) : "Sem registro"}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-[#8FA3B4]">Disponível</p>
                        <p className="mt-0.5 text-[12px] font-semibold text-[#1A6644]">{mappedInternalAvailableLimit !== null ? formatCurrencyBRLNoCents(mappedInternalAvailableLimit) : "Sem registro"}</p>
                      </div>
                    </div>
                    <p className="mt-2 text-[10px] text-[#4F647A]">
                      Overdue: {mappedInternalOverdue !== null ? formatCurrencyBRLNoCents(mappedInternalOverdue) : "Sem registro"} · Not Due: {mappedInternalNotDue !== null ? formatCurrencyBRLNoCents(mappedInternalNotDue) : "Sem registro"}
                    </p>
                    {!hasInternalPositionData ? (
                      <p className="mt-1 text-[10px] text-[#64748B]">Cliente localizado na base, sem posição financeira disponível.</p>
                    ) : null}
                    <p className="mt-1 text-[10px] text-[#64748B]">Última atualização: {internalLastUpdatedLabel ?? "Sem registro"}</p>
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
                        <p className="text-[10px] text-[#8FA3B4]">Receita Líquida do Exercício</p>
                        <p className="text-[11px] font-semibold text-[#102033]">{manualPanel.netRevenue || "Não informado"}</p>
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

            <div className="rounded-[14px] border border-[#D7E1EC] bg-white px-6 py-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-[#D7E1EC] bg-[#F7F9FC] text-[#8FA3B4]">
                    <FolderOpen className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-[13px] font-medium text-[#4F647A]">Central documental da solicitação</p>
                    <p className="text-[11px] text-[#8FA3B4]">Arquivos enviados na abertura da solicitação.</p>
                  </div>
                </div>
                <span className="rounded-full border border-[#D7E1EC] bg-[#F7F9FC] px-2 py-0.5 text-[10px] font-medium text-[#4F647A]">
                  {step1LibraryDocuments.length} {step1LibraryDocuments.length === 1 ? "documento anexado" : "documentos anexados"}
                </span>
              </div>

              <div className="mb-3">
                <button
                  type="button"
                  onClick={() => setIsDocumentLibraryOpen((prev) => !prev)}
                  className="inline-flex items-center gap-1 rounded-[8px] border border-[#D7E1EC] bg-white px-2.5 py-1 text-[10px] font-medium text-[#4F647A] hover:bg-[#F2F6FB]"
                >
                  <Info className="h-3.5 w-3.5" />
                  {isDocumentLibraryOpen ? "Recolher documentos" : "Ver documentos"}
                </button>
              </div>

              {!isDocumentLibraryOpen ? null : !hasStep1LibraryDocuments ? (
                <div className="rounded-[10px] border border-dashed border-[#D7E1EC] bg-white px-3 py-2 text-[11px] text-[#6B7280]">
                  Nenhum documento foi anexado na etapa anterior.
                </div>
              ) : (
                <>
                  {documentLibraryFeedback ? (
                    <div className="mb-3 rounded-[8px] border border-[#F5B5B5] bg-[#FEF2F2] px-3 py-2 text-[11px] text-[#B91C1C]">
                      {documentLibraryFeedback}
                    </div>
                  ) : null}
                  <div className="mb-3 flex flex-wrap gap-2">
                    {documentLibraryGroups.map((group) => {
                      const count = step1LibraryDocuments.filter((document) =>
                        group.types.includes(document.document_type as Step1DocumentType)
                      ).length;
                      if (count === 0) return null;
                      return (
                        <span key={group.title} className="rounded-full border border-[#D7E1EC] bg-white px-2 py-0.5 text-[10px] text-[#4F647A]">
                          {group.title}: {count}
                        </span>
                      );
                    })}
                  </div>
                  <div className="space-y-2">
                    {documentLibraryPreview.map((document) => (
                      <div key={document.id} className="flex flex-wrap items-center gap-2 rounded-[10px] border border-[#E5EAF1] bg-[#FAFCFF] p-2.5 text-[11px]">
                        <div className="min-w-[190px] flex-1 font-medium text-[#102033]">{document.original_filename}</div>
                        <span className="rounded-full border border-[#D7E1EC] bg-white px-2 py-0.5 text-[10px] text-[#4F647A]">
                          {resolveDocumentTypeLabel(document.document_type)}
                        </span>
                        <span className="rounded-full border border-[#D7E1EC] bg-white px-2 py-0.5 text-[10px] text-[#4F647A]">
                          {labelDocumentStatus(document.status)}
                        </span>
                        <span className="text-[#8FA3B4]">{new Date(document.uploaded_at).toLocaleDateString("pt-BR")}</span>
                        <button
                          type="button"
                          onClick={() => void handleOpenLibraryDocument(document)}
                          className="inline-flex items-center gap-1 rounded-[8px] border border-[#D7E1EC] bg-white px-2.5 py-1 text-[10px] font-medium text-[#4F647A] transition hover:bg-[#F2F6FB]"
                        >
                          <FileText className="h-3 w-3" />
                          {shouldOpenInline(document.mime_type) ? "Abrir documento" : "Baixar"}
                        </button>
                      </div>
                    ))}
                  </div>
                  {hasMoreLibraryDocuments ? (
                    <p className="mt-2 text-[11px] text-[#8FA3B4]">
                      +{step1LibraryDocuments.length - documentLibraryPreview.length} documentos disponíveis para consulta.
                    </p>
                  ) : null}
                </>
              )}
            </div>
            </>
            ) : null}
          </article>

          {isImportModalOpen ?(
            <div className="fixed inset-0 z-40 flex items-center justify-center bg-[#0D1B2A]/55 p-4" onClick={() => setIsImportModalOpen(false)}>
              <div className="w-full max-w-[480px] rounded-[18px] bg-white p-7 shadow-xl" onClick={(event) => event.stopPropagation()}>
                <button type="button" onClick={() => setIsImportModalOpen(false)} className="absolute hidden" />
                <div className="mb-5 flex items-start justify-between">
                  <div>
                    <p className="text-[16px] font-semibold text-[#102033]">
                      {importModalSource === "coface"
                        ? "Importar relatório COFACE"
                        : importModalSource === "agrisk_financial"
                          ? "Importar análise financeira Agrisk"
                          : "Importar relatório Agrisk"}
                    </p>
                    <p className="text-[12px] text-[#4F647A]">
                      {importModalSource === "coface"
                        ? "Selecione ou arraste o arquivo exportado da COFACE para leitura automática do DRA e indicadores de risco."
                        : importModalSource === "agrisk_financial"
                          ? "Selecione ou arraste o Relatório de Análise Financeira exportado da Agrisk."
                          : "Selecione ou arraste o Relatório de Score/Risco exportado da Agrisk."}
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
                      {importModalSource === "coface"
                        ? "Pronto para importação."
                        : "Pronto para importação. O tipo de relatório e o CNPJ serão validados após clicar em Importar."}
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

          {isAgriskFinancialDataDrawerOpen ?(
            <AgriskFinancialDrawer state={agriskFinancialImport} onClose={() => setIsAgriskFinancialDataDrawerOpen(false)} />
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
              <div className="flex h-full w-full max-w-[760px] flex-col bg-[#F6F8FB] shadow-2xl" onClick={(event) => event.stopPropagation()}>
                <div className="flex items-start justify-between border-b border-[#D7E1EC] bg-white px-6 py-4">
                  <div>
                    <p className="text-[18px] font-semibold leading-tight text-[#102033]">Informações complementares</p>
                    <p className="mt-1 text-[12px] text-[#4F647A]">Informe dados manuais quando não houver relatórios externos suficientes para a análise.</p>
                  </div>
                  <button type="button" onClick={() => setIsManualDrawerOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-full border border-[#D7E1EC] bg-[#F7F9FC] text-[#4F647A] hover:bg-white">
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto px-6 py-4">
                  <div className="space-y-3.5">
                    <div className={`rounded-[8px] border px-3.5 py-2.5 text-[12px] leading-relaxed shadow-[0_8px_24px_rgba(15,23,42,0.04)] ${hasAgriskFinancialImported ? "border-[#BFDBFE] bg-[#EFF6FF] text-[#1E3A8A]" : "border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]"}`}>
                      {hasAgriskFinancialImported
                        ? "Relatório Financeiro Agrisk identificado. Os indicadores financeiros serão obtidos automaticamente do relatório. Use esta seção apenas para complementar dados comerciais ou observações."
                        : "Nenhum Relatório Financeiro Agrisk foi identificado. Para melhorar a avaliação do Pilar 1, informe as demonstrações financeiras disponíveis."}
                    </div>

                    <section className="rounded-[8px] border border-[#D7E1EC] bg-white p-3.5 shadow-[0_10px_28px_rgba(15,23,42,0.05)]">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#295B9A]">Scores e refer?ncias externas</p>
                          <p className="mt-0.5 text-[11px] text-[#8FA3B4]">Prioridade: relatorio externo valido, manual, 0.</p>
                        </div>
                        {hasLockedExternalReferences ? <span className="inline-flex items-center gap-1 rounded-full border border-[#BFDBFE] bg-[#EFF6FF] px-2 py-0.5 text-[10px] font-semibold text-[#1D4ED8]"><Lock className="h-3 w-3" />Edicao bloqueada</span> : null}
                      </div>
                      <div className="mt-3 grid gap-3 sm:grid-cols-3">
                        <label className="text-[11px] font-medium text-[#4F647A]">Fonte do score
                          <select value={manualPanel.scoreSource} onChange={(event) => setManualPanel((prev) => ({ ...prev, scoreSource: event.target.value }))} disabled={scoreFieldLocked} className={`mt-1 h-8 w-full rounded-[8px] border border-[#D7E1EC] px-2.5 text-[12px] text-[#102033] ${scoreFieldLocked ? "cursor-not-allowed bg-[#F8FAFC] text-[#64748B]" : "bg-white"}`}>
                            <option value="Agrisk" disabled={hasAgriskImported}>{hasAgriskImported ? "Agrisk indisponivel" : "Agrisk"}</option>
                            <option value="Serasa">Serasa</option>
                            <option value="SCR/Bacen">SCR/Bacen</option>
                            <option value="Outro">Outro</option>
                          </select>
                          <span className="mt-1 block text-[10px] font-medium text-[#8FA3B4]">Fonte atual: {currentScoreSourceLabel}</span>
                        </label>
                        <label className="text-[11px] font-medium text-[#4F647A]">Score
                          <input type="number" min={0} max={1000} value={effectiveScoreValue} onChange={(event) => setManualPanel((prev) => ({ ...prev, scoreValue: Number(event.target.value || 0) }))} disabled={scoreFieldLocked} className={`mt-1 h-8 w-full rounded-[8px] border border-[#D7E1EC] px-2.5 text-[12px] text-[#102033] ${scoreFieldLocked ? "cursor-not-allowed bg-[#F8FAFC] text-[#64748B]" : "bg-white"}`} />
                          {scoreFieldLocked ? <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-[#EEF3F8] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.04em] text-[#64748B]">Edicao bloqueada</span> : null}
                        </label>
                        <label className="text-[11px] font-medium text-[#4F647A]">DRA COFACE
                          <input type="number" min={0} max={10} step={0.1} value={effectiveCofaceDraValue} onChange={(event) => setManualPanel((prev) => ({ ...prev, cofaceDra: Number(event.target.value || 0) }))} disabled={cofaceDraFieldLocked} className={`mt-1 h-8 w-full rounded-[8px] border border-[#D7E1EC] px-2.5 text-[12px] text-[#102033] ${cofaceDraFieldLocked ? "cursor-not-allowed bg-[#F8FAFC] text-[#64748B]" : "bg-white"}`} />
                          <span className="mt-1 block text-[10px] font-medium text-[#8FA3B4]">Fonte atual: {currentCofaceSourceLabel}</span>
                          {cofaceDraFieldLocked ? <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-[#EEF3F8] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.04em] text-[#64748B]">Edicao bloqueada</span> : null}
                        </label>
                      </div>
                      {hasLockedExternalReferences ? (
                        <div className="mt-3 rounded-[8px] border border-[#BFDBFE] bg-[#F8FBFF] px-3 py-2 text-[11px] leading-relaxed text-[#1E3A8A]">
                          Campos manuais preservados, porem ignorados enquanto houver relatorio externo valido.
                        </div>
                      ) : null}
                    </section>

                    <section className="rounded-[8px] border border-[#D7E1EC] bg-white p-3.5 shadow-[0_10px_28px_rgba(15,23,42,0.05)]">
                      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-[#EEF3F8] pb-2">
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#295B9A]">Dados comerciais internos</p>
                          <p className="mt-0.5 text-[11px] text-[#8FA3B4]">Relação comercial da empresa com o cliente.</p>
                        </div>
                      </div>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <label className="text-[11px] font-medium text-[#4F647A]"><span className="flex items-center gap-1.5"><Banknote className="h-3.5 w-3.5 text-[#295B9A]" />Receita últimos 12 meses</span>
                          <input value={manualPanel.internalRevenue12m} onChange={(event) => setManualPanel((prev) => ({ ...prev, internalRevenue12m: formatCurrencyInputBRL(event.target.value) }))} className="mt-1 h-8 w-full rounded-[8px] border border-[#D7E1EC] bg-white px-2.5 text-[12px] text-[#102033]" />
                        </label>
                        <label className="text-[11px] font-medium text-[#4F647A]"><span className="flex items-center gap-1.5"><ReceiptText className="h-3.5 w-3.5 text-[#295B9A]" />Valor em aberto</span>
                          <input value={manualPanel.outstandingValue} onChange={(event) => setManualPanel((prev) => ({ ...prev, outstandingValue: formatCurrencyInputBRL(event.target.value) }))} className="mt-1 h-8 w-full rounded-[8px] border border-[#D7E1EC] bg-white px-2.5 text-[12px] text-[#102033]" />
                        </label>
                        <label className="text-[11px] font-medium text-[#4F647A]"><span className="flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5 text-[#295B9A]" />PMR contratado</span>
                          <input value={manualPanel.pmrContractual} onChange={(event) => setManualPanel((prev) => ({ ...prev, pmrContractual: event.target.value }))} className="mt-1 h-8 w-full rounded-[8px] border border-[#D7E1EC] bg-white px-2.5 text-[12px] text-[#102033]" />
                        </label>
                        <label className="text-[11px] font-medium text-[#4F647A]"><span className="flex items-center gap-1.5"><LineChart className="h-3.5 w-3.5 text-[#295B9A]" />PMR efetivo</span>
                          <input value={manualPanel.pmrEffective} onChange={(event) => setManualPanel((prev) => ({ ...prev, pmrEffective: event.target.value }))} className="mt-1 h-8 w-full rounded-[8px] border border-[#D7E1EC] bg-white px-2.5 text-[12px] text-[#102033]" />
                        </label>
                        <label className="sm:col-span-2 text-[11px] font-medium text-[#4F647A]">Observação comercial curta
                          <input value={manualPanel.commercialNote} onChange={(event) => setManualPanel((prev) => ({ ...prev, commercialNote: event.target.value }))} className="mt-1 h-8 w-full rounded-[8px] border border-[#D7E1EC] bg-white px-2.5 text-[12px] text-[#102033]" />
                        </label>
                      </div>
                    </section>

                    <details open={!hasAgriskFinancialImported} className="rounded-[8px] border border-[#D7E1EC] bg-white shadow-[0_10px_28px_rgba(15,23,42,0.05)]">
                      <summary className="cursor-pointer px-3.5 py-3 text-[#102033]">
                        <span className="flex items-center justify-between gap-3">
                          <span className="flex items-center gap-2.5">
                            <span className="grid h-8 w-8 place-items-center rounded-[8px] bg-[#EAF1FF] text-[#295B9A]"><BarChart3 className="h-4 w-4" /></span>
                            <span>
                              <span className="block text-[13px] font-semibold">Demonstrações Financeiras</span>
                              <span className="block text-[11px] font-normal text-[#8FA3B4]">Preencha quando não houver Relatório Financeiro Agrisk.</span>
                            </span>
                          </span>
                          <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[#4F647A]">Mostrar detalhes</span>
                        </span>
                      </summary>
                      <div className="border-t border-[#EEF3F8] px-3.5 pb-3 pt-3">
                        <div className="mb-3 rounded-[8px] border border-[#E5EAF1] bg-[#F8FBFF] px-3 py-2">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.07em] text-[#64748B]">Origem dos dados financeiros</p>
                          <div className="mt-1.5 flex flex-wrap gap-3 text-[11px] font-medium text-[#4F647A]">
                            {hasAgriskFinancialImported ? <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#295B9A]" />Agrisk Financeiro</span> : null}
                            <span className="inline-flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${hasAgriskFinancialImported ? "border border-[#CBD5E1] bg-white" : "bg-[#295B9A]"}`} />Manual</span>
                          </div>
                        </div>
                        <div className="grid gap-3 lg:grid-cols-[1fr_1fr]">
                          <div>
                            <p className="mb-2 text-[11px] font-semibold text-[#295B9A]">DRE</p>
                            <div className="grid gap-2 sm:grid-cols-2">
                              <label className="text-[11px] font-medium text-[#4F647A]">Receita Líquida<input value={manualPanel.netRevenue} onChange={(event) => setManualPanel((prev) => ({ ...prev, netRevenue: formatCurrencyInputBRL(event.target.value) }))} disabled={financialStatementsLocked} className={manualFinancialInputClassName} /></label>
                              <label className="text-[11px] font-medium text-[#4F647A]">EBITDA<input value={manualPanel.ebitda} onChange={(event) => setManualPanel((prev) => ({ ...prev, ebitda: formatCurrencyInputBRL(event.target.value) }))} disabled={financialStatementsLocked} className={manualFinancialInputClassName} /></label>
                              <label className="text-[11px] font-medium text-[#4F647A]">Lucro Bruto<input value={manualPanel.grossProfit} onChange={(event) => setManualPanel((prev) => ({ ...prev, grossProfit: formatCurrencyInputBRL(event.target.value) }))} disabled={financialStatementsLocked} className={manualFinancialInputClassName} /></label>
                              <label className="text-[11px] font-medium text-[#4F647A]">Resultado Líquido<input value={manualPanel.netIncome} onChange={(event) => setManualPanel((prev) => ({ ...prev, netIncome: formatCurrencyInputBRL(event.target.value) }))} disabled={financialStatementsLocked} className={manualFinancialInputClassName} /></label>
                            </div>
                            <div className="mt-3 max-w-[180px]">
                              <p className="mb-2 text-[11px] font-semibold text-[#295B9A]">Fluxo de Caixa</p>
                              <label className="text-[11px] font-medium text-[#4F647A]">Fluxo de Caixa Operacional<input value={manualPanel.operatingCashFlow} onChange={(event) => setManualPanel((prev) => ({ ...prev, operatingCashFlow: formatCurrencyInputBRL(event.target.value) }))} disabled={financialStatementsLocked} className={manualFinancialInputClassName} /></label>
                            </div>
                          </div>
                          <div>
                            <p className="mb-2 text-[11px] font-semibold text-[#295B9A]">Balanço</p>
                            <div className="grid gap-2 sm:grid-cols-2">
                              <label className="text-[11px] font-medium text-[#4F647A]">Ativo Total<input value={manualPanel.totalAssets} onChange={(event) => setManualPanel((prev) => ({ ...prev, totalAssets: formatCurrencyInputBRL(event.target.value) }))} disabled={financialStatementsLocked} className={manualFinancialInputClassName} /></label>
                              <label className="text-[11px] font-medium text-[#4F647A]">Passivo Total<input value={manualPanel.totalLiabilities} onChange={(event) => setManualPanel((prev) => ({ ...prev, totalLiabilities: formatCurrencyInputBRL(event.target.value) }))} disabled={financialStatementsLocked} className={manualFinancialInputClassName} /></label>
                              <label className="text-[11px] font-medium text-[#4F647A]">Ativo Circulante<input value={manualPanel.currentAssets} onChange={(event) => setManualPanel((prev) => ({ ...prev, currentAssets: formatCurrencyInputBRL(event.target.value) }))} disabled={financialStatementsLocked} className={manualFinancialInputClassName} /></label>
                              <label className="text-[11px] font-medium text-[#4F647A]">Passivo Circulante<input value={manualPanel.currentLiabilities} onChange={(event) => setManualPanel((prev) => ({ ...prev, currentLiabilities: formatCurrencyInputBRL(event.target.value) }))} disabled={financialStatementsLocked} className={manualFinancialInputClassName} /></label>
                              <label className="text-[11px] font-medium text-[#4F647A]">Disponibilidades<input value={manualPanel.cashAndEquivalents} onChange={(event) => setManualPanel((prev) => ({ ...prev, cashAndEquivalents: formatCurrencyInputBRL(event.target.value) }))} disabled={financialStatementsLocked} className={manualFinancialInputClassName} /></label>
                              <label className="text-[11px] font-medium text-[#4F647A]">Estoques<input value={manualPanel.inventory} onChange={(event) => setManualPanel((prev) => ({ ...prev, inventory: formatCurrencyInputBRL(event.target.value) }))} disabled={financialStatementsLocked} className={manualFinancialInputClassName} /></label>
                              <label className="text-[11px] font-medium text-[#4F647A]">Patrimônio Líquido<input value={manualPanel.equity} onChange={(event) => setManualPanel((prev) => ({ ...prev, equity: formatCurrencyInputBRL(event.target.value) }))} disabled={financialStatementsLocked} className={manualFinancialInputClassName} /></label>
                            </div>
                          </div>
                        </div>

                      </div>
                    </details>

                    <section className="rounded-[8px] border border-[#D7E1EC] bg-white p-3.5 shadow-[0_10px_28px_rgba(15,23,42,0.05)]">
                      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-[#EEF3F8] pb-2">
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#295B9A]">Indicadores calculados pelo motor</p>
                          <p className="mt-0.5 text-[11px] text-[#8FA3B4]">Fonte atual dos indicadores: {currentIndicatorSourceLabel}</p>
                        </div>
                      </div>
                      {hasAgriskFinancialImported ? (
                        <div className="mt-3 rounded-[8px] border border-[#BFDBFE] bg-[#F8FBFF] px-3 py-2.5 text-[11px] leading-relaxed text-[#1E3A8A]">
                          Indicadores exibidos a partir do Relat?rio Financeiro Agrisk. Dados manuais salvos, se houver, est?o preservados, por?m ignorados enquanto o Agrisk estiver dispon?vel.
                        </div>
                      ) : null}
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        {manualIndicatorGroups.map((group) => (
                          <div key={group.title} className="rounded-[8px] border border-[#E5EAF1] bg-[#FBFDFF] p-2.5">
                            <p className="mb-2 text-[11px] font-semibold text-[#102033]">{group.title}</p>
                            <div className="grid gap-2">
                              {group.rows.map((row) => {
                                const available = row.value !== null && Number.isFinite(row.value);
                                const sourceLabel = row.source === "Agrisk Financeiro" ? "Agrisk" : row.source;
                                return (
                                  <div key={row.label} className="rounded-[8px] border border-[#EDF2F7] bg-white px-2.5 py-2">
                                    <div className="flex items-start justify-between gap-2">
                                      <p className="text-[11px] font-medium text-[#4F647A]">{row.label}</p>
                                      {!available ? <span className="rounded-full bg-[#F1F5F9] px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.04em] text-[#94A3B8]">Não disponível</span> : null}
                                    </div>
                                    <div className="mt-1 flex items-end justify-between gap-2">
                                      <p className={`text-[16px] font-semibold leading-none ${available ? "text-[#102033]" : "text-[#94A3B8]"}`}>{formatManualIndicator(row.value, row.suffix)}</p>
                                      <p className="text-[10px] font-medium text-[#8FA3B4]">{sourceLabel}</p>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>

                    <section className="rounded-[8px] border border-[#D7E1EC] bg-white p-3.5 shadow-[0_10px_28px_rgba(15,23,42,0.05)]">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#295B9A]">Observações</p>
                      <label className="mt-3 block text-[11px] font-medium text-[#4F647A]">Considerações do analista
                        <textarea value={manualPanel.analystNotes} onChange={(event) => setManualPanel((prev) => ({ ...prev, analystNotes: event.target.value }))} rows={4} maxLength={1200} className="mt-1 min-h-[96px] w-full rounded-[8px] border border-[#D7E1EC] px-3 py-2 text-[12px] text-[#102033]" />
                      </label>
                      <p className="mt-1 text-right text-[10px] text-[#8FA3B4]">{manualPanel.analystNotes.length}/1200</p>
                    </section>
                  </div>
                </div>

                <div className="flex justify-end gap-2 border-t border-[#D7E1EC] bg-white px-6 py-3">
                  <button type="button" onClick={() => setIsManualDrawerOpen(false)} className="rounded-[8px] border border-[#D7E1EC] bg-white px-5 py-2 text-[12px] font-medium text-[#4F647A] hover:bg-[#F7F9FC]">Cancelar</button>
                  <button type="button" onClick={saveManualDrawer} className="rounded-[8px] bg-[#0D1B2A] px-6 py-2 text-[12px] font-medium text-white hover:bg-[#13263B]">Salvar dados</button>
                </div>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      
{step === 3 ?(
        <div className="mt-3 space-y-4">
          <div className="relative overflow-hidden rounded-[30px] bg-[linear-gradient(135deg,#071426_0%,#0b1f3a_45%,#102a4c_100%)] px-5 py-[18px] text-white shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#bfdbfe]/80">Etapa 3 · Mesa de análise</p>
            <h2 className="mt-1.5 text-[30px] font-bold leading-[1.12] tracking-[-0.015em] text-white/90">Mesa corporativa de análise de crédito</h2>
            <p className="mt-2 text-[13px] leading-5 text-[#dbeafe]/85 md:whitespace-nowrap">Consolidação técnica dos dados internos, bureaus, política de crédito e julgamento do analista antes da revisão e envio para aprovação.</p>
            <div className="mt-4 grid gap-2.5 md:grid-cols-2 xl:grid-cols-[1.2fr_0.95fr_0.95fr_0.95fr_0.95fr]">
              <div className="rounded-[18px] border border-white/20 bg-white/10 p-3.5">
                <p className="text-[11px] font-medium text-[#bfdbfe]/85">Cliente</p>
                <p className="mt-1.5 overflow-hidden text-[20px] font-semibold leading-tight tracking-[-0.01em] text-white/90 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">{customer.companyName || "Não informado"}</p>
                <p className="mt-1 text-[11px] text-[#dbeafe]/85">{formatCnpjForDisplay(customer.cnpj)}</p>
              </div>
              <div className="rounded-[18px] border border-white/20 bg-white/10 p-3.5"><p className="text-[11px] font-medium text-[#bfdbfe]/85">Limite solicitado</p><p className="mt-1.5 text-[20px] font-bold text-white/95">{technicalRequestedLimit > 0 ? formatCurrencyBRLCompactExecutive(technicalRequestedLimit) : "—"}</p><p className="mt-0.5 text-[11px] text-[#dbeafe]/85">Condição comercial proposta</p></div>
              <div className="rounded-[18px] border border-white/20 bg-white/10 p-3.5">
                <p className="text-[11px] font-medium text-[#bfdbfe]/85">Limite Atual Aprovado</p>
                <p className="mt-1.5 text-[20px] font-bold text-white/95">{mappedInternalTotalLimit !== null ? formatCurrencyBRLCompactExecutive(mappedInternalTotalLimit) : "Não disponível"}</p>
                <p className="mt-0.5 text-[11px] text-[#dbeafe]/85">{mappedInternalTotalLimit !== null ? "Limite total aprovado vigente" : "Cliente sem limite vigente identificado na base importada."}</p>
              </div>
              <div className="rounded-[18px] border border-white/20 bg-white/10 p-3.5"><p className="text-[11px] font-medium text-[#bfdbfe]/85">Cobertura COFACE</p><p className="mt-1.5 text-[20px] font-bold text-white/95">{technicalCoverageValue !== null ? formatCurrencyBRLCompactExecutive(technicalCoverageValue) : "—"}</p><p className="mt-0.5 text-[11px] text-[#dbeafe]/85">{executiveCoveragePercent !== null ? `${executiveCoveragePercent}% do limite solicitado` : "Sem percentual"}</p></div>
              <div className="rounded-[18px] border border-white/20 bg-white/10 p-3.5"><p className="text-[11px] font-medium text-[#bfdbfe]/85">Valor em Aberto</p><p className="mt-1.5 text-[20px] font-bold text-white/95">{mappedInternalOpenAmount !== null ? formatCurrencyBRLCompactExecutive(mappedInternalOpenAmount) : "—"}</p><p className="mt-0.5 text-[11px] text-[#dbeafe]/85">Notdue: {mappedInternalNotDue !== null ? formatCurrencyBRLCompactExecutive(mappedInternalNotDue) : "—"} · Overdue: {mappedInternalOverdue !== null ? formatCurrencyBRLCompactExecutive(mappedInternalOverdue) : "—"}</p></div>
            </div>
          </div>
          <div className="grid gap-4 xl:grid-cols-[1.45fr_0.9fr]">
            <div className="space-y-4">
              <article className="rounded-[24px] border border-[#D7E1EC] bg-white p-5 shadow-[0_10px_32px_rgba(15,23,42,0.06)]">
                <p className="text-[18px] font-semibold text-[#0f172a]">Visão executiva da análise</p>
                <div className="mt-4 grid gap-3 xl:grid-cols-[0.95fr_1.35fr]">
                  <div className="flex min-h-[114px] flex-col justify-between rounded-[18px] border border-[#D7E1EC] bg-[linear-gradient(180deg,#0b1f3a_0%,#102a4c_100%)] px-4 py-3 text-white shadow-[0_10px_20px_rgba(15,23,42,0.18)]">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[#bfdbfe]">Limite recomendado</p>
                    <p className="text-[28px] font-extrabold leading-none text-white">{formatCurrencyBRLCompactExecutive(executiveDisplayedRecommendedLimit)}</p>
                    <p className="text-[11px] text-[#dbeafe]">{executiveCofaceCeilingApplied ? "Cobertura COFACE aplicada como teto da recomendação final." : "Recomendação preliminar da política institucional."}</p>
                  </div>
                  <div className="rounded-[18px] border border-[#E8EEF5] bg-[rgba(248,250,252,0.78)] p-2.5">
                    <div className="grid gap-2.5 sm:grid-cols-3">
                    <div className="rounded-[14px] border border-[#EDF2F7] border-t bg-[rgba(255,255,255,0.78)] px-3.5 py-2.5" style={executiveRiskAccentStyle}>
                      <div className="flex items-center">
                        <p className="text-[11px] font-semibold text-[#475569]">Perfil de risco</p>
                      </div>
                      <p className="mt-1 text-[18px] font-extrabold leading-tight text-[#0f172a]">{institutionalScore !== null ? executiveRiskProfile : "—"}</p>
                      <p className="mt-0.5 text-[11px] text-[#64748b]">{institutionalScore !== null ? institutionalScoreDisplay : "Sem score"}</p>
                    </div>
                    <div className={`rounded-[14px] border px-3.5 py-3 ${
                      executiveExposureHasResidual
                        ? "border-[#F5DEB3] bg-[rgba(255,251,235,0.78)]"
                        : "border-[#EDF2F7] bg-[rgba(255,255,255,0.78)]"
                    }`}>
                      <p className="text-[11px] font-semibold text-[#475569]">Exposição interna</p>
                      <p className="mt-1.5 text-[18px] font-extrabold text-[#0f172a]">{formatCurrencyBRLCompactExecutive(executiveNetInternalExposure)}</p>
                      <p className={`mt-1 text-[11px] ${executiveExposureHasResidual ? "font-semibold text-[#B45309]" : "text-[#64748b]"}`}>{executiveExposureFullyCovered ? "Coberto" : "Atenção"}</p>
                    </div>
                    <div className="flex min-h-[96px] flex-col justify-center rounded-[14px] border border-[#EDF2F7] bg-[rgba(255,255,255,0.78)] px-3.5 py-3">
                      <p className="text-[11px] font-semibold text-[#475569]">Overdue</p>
                      <p className="mt-1.5 text-[18px] font-extrabold text-[#0f172a]">{executiveOverduePercent !== null ? `${executiveOverduePercent}%` : "—"}</p>
                      <p className="mt-1 text-[11px] text-[#64748b]">{executiveOverduePercent === 0 ? "Sem overdue" : executiveOverduePercent !== null ? "Com overdue" : "Sem base interna"}</p>
                    </div>
                    </div>
                  </div>
                </div>
              </article>

              <InstitutionalScoreCard
                score={institutionalScore}
                breakdown={institutionalScoreBreakdown}
                scoreCalculation={workspaceDetailQuery.data?.score?.score_calculation ?? null}
                unavailableReason={scorePillarsUnavailableReason}
                hasValidCofaceCoverage={hasValidCofaceCoverage}
                guaranteeCoverageHelperText={guaranteeCoverageHelperText}
                paymentPillarHelperText={paymentPillarHelperText}
                relationshipPillarHelperText={relationshipPillarHelperText}
              />

              <article className="rounded-[24px] border border-[#D7E1EC] bg-white p-5 shadow-[0_10px_32px_rgba(15,23,42,0.06)]">
                <p className="text-[18px] font-semibold text-[#0f172a]">Parecer técnico do analista</p>
                <textarea value={analysis.comment} onChange={(event) => setAnalysis((prev) => ({ ...prev, comment: event.target.value }))} onBlur={(event) => persistAnalystComment(event.target.value)} className="mt-3 min-h-[180px] w-full rounded-[20px] border border-[#E2E8F0] px-4 py-3 text-[13px] text-[#334155]" placeholder="Registrar análise qualitativa, fundamentos da recomendação e ressalvas antes da revisão." />
                <p className="mt-2 text-[12px] text-[#64748b]">Parecer usado na geração do dossiê técnico.</p>
              </article>
            </div>
            <aside className="space-y-4">
              <RecommendationInsightsCard
                riskPrimary={insightRiskPrimary}
                riskSecondary={insightRiskSecondary}
                cofacePrimary={insightCofacePrimary}
                cofaceSecondary={insightCofaceSecondary}
                exposurePrimary={insightExposurePrimary}
                exposureSecondary={insightExposureSecondary}
                overduePrimary={insightOverduePrimary}
                overdueSecondary={insightOverdueSecondary}
              />
              <article className="rounded-[24px] border border-[#D7E1EC] bg-[linear-gradient(180deg,#FFFFFF_0%,#FAFCFF_100%)] p-5 shadow-[0_10px_24px_rgba(15,23,42,0.05)]">
                <p className="text-[18px] font-semibold text-[#0f172a]">Dossiê de Crédito</p>
                <p className="mt-1 text-[13px] text-[#64748b]">Encerramento institucional da mesa de análise com consolidação do parecer técnico do analista.</p>
                <div className="mt-4 rounded-[18px] border border-[#D7E6F6] bg-[linear-gradient(180deg,#F8FBFF_0%,#F1F6FD_100%)] p-4">
                  <p className="text-[16px] font-extrabold text-[#0b1f3a]">Dossiê técnico consolidado</p>
                  <p className="mt-2 max-w-[560px] text-[13px] leading-relaxed text-[#475569]">O dossiê consolida score institucional, parecer técnico, mitigadores, exposição, condições recomendadas e trilha decisória para submissão à aprovação.</p>
                  <button type="button" onClick={handleAdvanceFromStep3ToStep4} disabled={isTechnicalDossierCalculationPending} className="mt-4 inline-flex items-center rounded-full bg-[#0b1f3a] px-5 py-2.5 text-[13px] font-extrabold text-white disabled:cursor-not-allowed disabled:bg-[#D7E1EC] disabled:text-[#8FA3B4]">{isTechnicalDossierCalculationPending ? "Consolidando dossiê..." : "Avançar para revisão"}</button>
                  {isTechnicalDossierCalculationPending ? (
                    <p className="mt-2 text-[12px] text-[#475569]">Consolidando dossiê técnico. Aguarde...</p>
                  ) : null}
                  {step3AdvanceError ? (
                    <p className="mt-2 text-[12px] text-[#b91c1c]">{step3AdvanceError}</p>
                  ) : null}
                </div>
              </article>
            </aside>
          </div>
        </div>
      ) : null}

      {step === 4 ?(
        <div className="bg-[linear-gradient(180deg,#F5F8FC_0%,#F2F6FB_100%)] px-7 py-6">
          <section className="overflow-hidden rounded-[30px] border border-[#27466e] bg-[radial-gradient(circle_at_17%_18%,rgba(129,161,255,.20),transparent_34%),radial-gradient(circle_at_86%_34%,rgba(96,127,235,.23),transparent_38%),radial-gradient(circle_at_82%_68%,rgba(255,255,255,.08),transparent_30%),linear-gradient(142deg,#051022_0%,#0d203d_45%,#16345b_78%,#0e2747_100%)] shadow-[0_24px_52px_rgba(8,22,46,0.30)]">
            <div className="px-8 pb-8 pt-8 text-white lg:px-10 lg:pb-9 lg:pt-9">
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-center">
                <div className="max-w-[900px]">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#c0d7f6]">Etapa 4 · Perfil corporativo de crédito</p>
                    <span className="inline-flex rounded-full border border-white/14 bg-white/[0.045] px-3 py-[3px] text-[10px] font-medium tracking-[0.09em] text-[#d7e3f3]">Dossiê pronto para aprovação</span>
                  </div>
                  <h2 className="mt-3 text-[40px] font-black leading-[1.01] tracking-[-0.044em] text-white lg:text-[46px]">{customer.companyName || "Cliente não informado"}</h2>
                  <p className="mt-2.5 text-[13px] font-medium leading-[1.68] tracking-[0.013em] text-[#bfccdd]">{formatCnpjForDisplay(customer.cnpj)}  •  {economicGroupLabel || "Grupo econômico não informado"}  •  BU {requestBusinessUnit || "Não informada"}  •  Última atualização {internalLastUpdatedLabel ?? "Não disponível"}</p>
                  <p className="mt-1.5 text-[11px] leading-[1.55] text-[#bdd0eb]"><span className="font-semibold text-[#e3efff]">Solicitante:</span> {requesterLabel}</p>
                </div>
                <div className="relative mx-auto flex w-full max-w-[202px] flex-col items-center lg:mx-0 lg:items-end">
                  <div className="absolute right-[-8px] top-[62px] h-[100px] w-[200px] rounded-full opacity-16 blur-[50px]" style={{ background: "radial-gradient(ellipse at center, rgba(214,220,232,0.12) 0%, rgba(214,220,232,0.05) 44%, transparent 76%)" }} />
                  <div className="relative h-[124px] w-[124px]">
                    <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" role="img" aria-label="Score institucional">
                      <defs>
                        <linearGradient id="institutional-score-ring" x1="12" y1="12" x2="108" y2="108" gradientUnits="userSpaceOnUse">
                          <stop offset="0%" stopColor="#E7EDF7" />
                          <stop offset="100%" stopColor="#C2CFE2" />
                        </linearGradient>
                      </defs>
                      <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(201,210,227,0.34)" strokeWidth="8" />
                      <circle
                        cx="60"
                        cy="60"
                        r="52"
                        fill="none"
                        stroke="url(#institutional-score-ring)"
                        strokeWidth="8"
                        strokeLinecap="round"
                        strokeDasharray={institutionalScoreRingLength}
                        strokeDashoffset={institutionalScoreRingOffset}
                      />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                      <p className="text-[32px] font-light leading-none tracking-[-0.022em] text-[#F2F6FC]">{institutionalScore !== null ? institutionalScore.toFixed(1) : "—"}</p>
                      <p className="mt-0.5 text-[20px] font-semibold leading-none text-[#A8B4C7]">/10</p>
                    </div>
                  </div>
                  <div className="mt-2.5 flex w-[124px] flex-col items-center justify-center text-center">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#DDE8F8]">
                      RATING {institutionalRiskBand === "Informações insuficientes" ? "—" : institutionalRiskBand}
                    </p>
                    <p className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.18em] text-[#EEF4FF]">
                      {institutionalRiskBand === "Informações insuficientes" ? "Sem base" : institutionalSemanticLabel}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>
          <ApprovalWorkflowActionBar
            summary={approvalFlowSummary}
            availableActions={dossierApprovalActions}
            mode="decision"
            controller={approvalWorkflowController}
            analysisStatus={internalOperationalStatus}
          />
          <div className="mt-5 grid grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(0,1.68fr)_minmax(320px,0.78fr)]">
            <div className="self-start space-y-3">
              {(() => {
                const recommended = step4DisplayedRecommendedLimit ?? 0;
                const requested = technicalRequestedLimit;
                const exposureResidual = executiveNetInternalExposure ?? 0;
                const hasCoverage = technicalCoverageValue !== null && technicalCoverageValue > 0;
                const recommendationLabel = hasCanonicalTechnicalDecision
                  ? (
                    recommendationClassificationLabel ?? (
                      recommended <= 0
                        ? "Reprovação recomendada"
                        : requested > 0 && recommended < requested
                          ? "Aprovação parcial recomendada"
                          : "Aprovação integral recomendada"
                    )
                  )
                  : "Decisão técnica pendente de cálculo";
                const recommendationCode = typeof step4RecommendationClassification?.code === "string"
                  ? step4RecommendationClassification.code
                  : null;
                const hideRecommendedLimitInHeader = recommendationCode === "maintain_current_limit";
                const recommendationToneClass =
                  !hasCanonicalTechnicalDecision
                    ? "text-[#92400e]"
                    : recommendationLabel === "Reprovação recomendada"
                    ? "text-[#9f1239]"
                    : recommendationLabel === "Aprovação parcial recomendada" || recommendationLabel === "Manutenção do limite atual recomendada" || recommendationLabel === "Manutenção do Limite Atual"
                      ? "text-[#92400e]"
                      : "text-[#166534]";
                const classificationJustification = step4RecommendationClassification?.justification;
                const executiveRationale = !hasCanonicalTechnicalDecision
                  ? "A recomendação final será exibida após concluir o cálculo canônico de score e decisão técnica."
                  : typeof classificationJustification === "string" && classificationJustification.trim()
                  ? classificationJustification
                  : hasCoverage && exposureResidual <= 0
                  ? "Cobertura COFACE integral mitigando a exposição da operação."
                  : exposureResidual > 0
                    ? "Exposição residual identificada e destacada para decisão da alçada aprovadora."
                    : hasCoverage
                      ? "Cobertura COFACE considerada na recomendação final submetida para aprovação."
                      : "Recomendação fundamentada no limite institucional preliminar e nos insumos consolidados da análise.";
                const currentApprovedLimitFromBackend = toNullableNumeric(step4RecommendationClassification?.current_approved_limit);
                const shouldShowCurrentLimit = step4RecommendationClassification?.show_current_limit === true && currentApprovedLimitFromBackend !== null && currentApprovedLimitFromBackend > 0;

                return (
                  <article className="w-full self-start">
                    <div className="flex items-start gap-3 rounded-[20px] border border-[#d7e3f2] bg-[linear-gradient(180deg,#ffffff_0%,#f9fbff_100%)] px-5 py-4 shadow-[0_5px_12px_rgba(10,29,64,.035)]">
                      <div className="w-[2px] rounded-full bg-[linear-gradient(180deg,rgba(74,119,179,.82)_0%,rgba(133,161,198,.42)_100%)] shadow-[0_0_8px_rgba(77,122,184,.20)]" />
                      <div className="flex min-w-0 flex-1 flex-col">
                        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#5a6f89]">Decisão Executiva</p>
                        <p className={`mt-1 text-[10px] font-semibold uppercase tracking-[0.13em] ${recommendationToneClass}`}>Recomendação final</p>
                        <p className="mt-2 text-[24px] font-black leading-[1.18] tracking-[-0.014em] text-[#0f2747]">
                          {recommendationLabel}
                          {hasCanonicalTechnicalDecision && !hideRecommendedLimitInHeader ? (
                            <>
                              {" "}
                              <span className="font-semibold text-[#33506f]">·</span>{" "}
                              <span className="text-[#0b2f5c]">Limite recomendado: {formatCurrencyBRLCompactExecutive(recommended)}</span>
                            </>
                          ) : null}
                        </p>
                        <p className="mt-1.5 text-[12px] leading-[1.5] text-[#4f647a]">
                          <span className="font-semibold text-[#334155]">Solicitado:</span> <span className="font-semibold text-[#0f2747]">{requested > 0 ? formatCurrencyBRLCompactExecutive(requested) : "—"}</span>
                          {shouldShowCurrentLimit ? (
                            <>
                              {" · "}
                              <span className="font-semibold text-[#334155]">Limite atual:</span> <span className="font-semibold text-[#0f2747]">{formatCurrencyBRLCompactExecutive(currentApprovedLimitFromBackend)}</span>
                            </>
                          ) : null}
                          {" · "}
                          <span className="font-semibold text-[#334155]">COFACE:</span> <span className="font-semibold text-[#0f2747]">{technicalCoverageValue !== null ? formatCurrencyBRLCompactExecutive(technicalCoverageValue) : "—"}</span>
                          {" · "}
                          <span className="font-semibold text-[#334155]">Exposição residual:</span> <span className="font-semibold text-[#0f2747]">{hasCanonicalTechnicalDecision ? formatCurrencyBRLCompactExecutive(exposureResidual) : "—"}</span>
                        </p>
                        <p className="mt-1.5 text-[12px] leading-[1.55] text-[#2f4157]">
                          <span className="font-semibold text-[#334155]">Justificativa:</span> {executiveRationale}
                        </p>
                      </div>
                    </div>
                  </article>
                );
              })()}
              <InstitutionalScoreCard
                score={institutionalScore}
                breakdown={institutionalScoreBreakdown}
                scoreCalculation={workspaceDetailQuery.data?.score?.score_calculation ?? null}
                unavailableReason={scorePillarsUnavailableReason}
                hasValidCofaceCoverage={hasValidCofaceCoverage}
                guaranteeCoverageHelperText={guaranteeCoverageHelperText}
                paymentPillarHelperText={paymentPillarHelperText}
                relationshipPillarHelperText={relationshipPillarHelperText}
              />
              <RecommendationInsightsCard
                riskPrimary={insightRiskPrimary}
                riskSecondary={insightRiskSecondary}
                cofacePrimary={insightCofacePrimary}
                cofaceSecondary={insightCofaceSecondary}
                exposurePrimary={insightExposurePrimary}
                exposureSecondary={insightExposureSecondary}
                overduePrimary={insightOverduePrimary}
                overdueSecondary={insightOverdueSecondary}
              />
              <article className="rounded-[22px] border border-[#e1e9f3] bg-white p-5 shadow-[0_10px_22px_rgba(10,29,64,.052)]">
                <p className="text-[18px] font-semibold tracking-[-0.01em] text-[#0f172a]">Relatórios importados e informações da Etapa 2</p>
                <div className="mt-3 divide-y divide-[#ecf1f7] rounded-[16px] bg-[#fbfdff]">
                  {([
                    {
                      key: "coface" as const,
                      initials: "CO",
                      title: "COFACE",
                      subtitle: consolidatedSources.find((s) => s.key === "coface")?.detail || "Sem importação",
                      status: hasCofaceImported ? "Importado" : "Pendente",
                      statusClass: hasCofaceImported ? "border-[#cfe2d8] bg-[#eefaf4] text-[#23714d]" : "border-[#e2e8f0] bg-[#f8fafc] text-[#64748b]"
                    },
                    {
                      key: "agrisk" as const,
                      initials: "AG",
                      title: "AGRISK",
                      subtitle: consolidatedSources.find((s) => s.key === "agrisk")?.detail || "Sem importação",
                      status: hasAgriskImported ? "Importado" : "Pendente",
                      statusClass: hasAgriskImported ? "border-[#cfe2d8] bg-[#eefaf4] text-[#23714d]" : "border-[#e2e8f0] bg-[#f8fafc] text-[#64748b]"
                    },
                    {
                      key: "internal" as const,
                      initials: "AR",
                      title: "Dados internos da carteira",
                      subtitle: `Valor em aberto ${mappedInternalOpenAmount !== null ? formatCurrencyBRLCompactExecutive(mappedInternalOpenAmount) : "—"} · Not due ${mappedInternalNotDue !== null ? formatCurrencyBRLCompactExecutive(mappedInternalNotDue) : "—"} · Overdue ${mappedInternalOverdue !== null ? formatCurrencyBRLCompactExecutive(mappedInternalOverdue) : "—"}.`,
                      status: "Consolidado",
                      statusClass: "border-[#cfe2d8] bg-[#eefaf4] text-[#23714d]"
                    },
                    {
                      key: "references" as const,
                      initials: "RF",
                      title: "Referências comerciais",
                      subtitle: commercialReferences.length > 0 ? `${commercialReferences.length} referência(s) registrada(s) na solicitação.` : "Sem referências comerciais registradas.",
                      status: "Informado",
                      statusClass: "border-[#f0deb5] bg-[#fff8e8] text-[#8a5a13]"
                    }
                  ]).map((item) => {
                    const isExpanded = expandedImportedSummary === item.key;
                    const cofaceFileName = cofaceImport.files[0]?.original_filename ?? null;
                    const cofaceDocument = cofaceFileName ? step1LibraryDocuments.find((doc) => doc.original_filename === cofaceFileName) : null;
                    const internalHasData = mappedInternalOpenAmount !== null || mappedInternalNotDue !== null || mappedInternalOverdue !== null || mappedInternalAvailableLimit !== null;
                    const internalNotDuePct = mappedInternalOpenAmount && mappedInternalNotDue !== null && mappedInternalOpenAmount > 0
                      ? Math.round((mappedInternalNotDue / mappedInternalOpenAmount) * 100)
                      : null;
                    const internalOverduePct = mappedInternalOpenAmount && mappedInternalOverdue !== null && mappedInternalOpenAmount > 0
                      ? Math.round((mappedInternalOverdue / mappedInternalOpenAmount) * 100)
                      : null;

                    return (
                      <div key={item.key}>
                        <div className="grid grid-cols-[38px_1fr_auto_auto] items-center gap-3 px-3 py-2.5">
                          <div className="grid h-8 w-8 place-items-center rounded-[10px] bg-[#eaf1ff] text-[11px] font-black text-[#1f4c90]">{item.initials}</div>
                          <div>
                            <p className="text-[13px] font-semibold text-[#0f172a]">{item.title}</p>
                            <p className="text-[12px] text-[#64748b]">{item.subtitle}</p>
                          </div>
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${item.statusClass}`}>{item.status}</span>
                          <button
                            type="button"
                            onClick={() => setExpandedImportedSummary((prev) => (prev === item.key ? null : item.key))}
                            className="rounded-full border border-[#d7e1ef] bg-white px-2.5 py-0.5 text-[10px] font-semibold text-[#4f647a] hover:bg-[#f8fafc]"
                          >
                            {isExpanded ? "Ocultar" : "Ver resumo"}
                          </button>
                        </div>
                        {isExpanded ? (
                          <div className="mx-3 mb-2.5 rounded-[12px] border border-[#e2eaf4] bg-[#f7fbff] px-3 py-2.5">
                            {item.key === "coface" ? (
                              cofaceImport.cofaceReadPayload ? (
                                <div className="grid gap-2 text-[11px] text-[#4f647a] md:grid-cols-2">
                                  <p><span className="font-semibold text-[#334155]">Valor Segurado:</span> {cofaceImport.cofaceReadPayload.coface?.decision_amount != null ? `R$ ${cofaceImport.cofaceReadPayload.coface.decision_amount.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "Não informado"}</p>
                                  <p><span className="font-semibold text-[#334155]">Estado da decisão:</span> {cofaceImport.cofaceReadPayload.coface?.decision_status || "Não informado"}</p>
                                  <p><span className="font-semibold text-[#334155]">Data efetiva:</span> {formatIsoDateToBr(cofaceImport.cofaceReadPayload.coface?.decision_effective_date)}</p>
                                  <p><span className="font-semibold text-[#334155]">DRA:</span> {cofaceImport.cofaceReadPayload.coface?.dra ?? "Não informado"}</p>
                                  <p className="md:col-span-2"><span className="font-semibold text-[#334155]">CRA:</span> {cofaceImport.cofaceReadPayload.coface?.cra || "Não informado"}</p>
                                  {(cofaceImport.cofaceWarnings ?? []).length > 0 ? <p className="md:col-span-2"><span className="font-semibold text-[#334155]">Alertas:</span> {(cofaceImport.cofaceWarnings ?? []).join(" · ")}</p> : null}
                                  {cofaceDocument ? <button type="button" onClick={() => void handleOpenLibraryDocument(cofaceDocument)} className="md:col-span-2 justify-self-start rounded-full border border-[#d7e1ef] bg-white px-3 py-1 text-[10px] font-semibold text-[#334155] hover:bg-[#f8fafc]">Download do arquivo</button> : null}
                                </div>
                              ) : <p className="text-[11px] text-[#6a7d93]">Resumo ainda não disponível para este relatório.</p>
                            ) : null}

                            {item.key === "agrisk" ? (
                              agriskImport.agriskReadPayload ? (
                                <div className="grid gap-2 text-[11px] text-[#4f647a] md:grid-cols-2">
                                  <p><span className="font-semibold text-[#334155]">Score:</span> {agriskImport.agriskReadPayload.credit?.score ?? "Não informado"}</p>
                                  <p><span className="font-semibold text-[#334155]">Rating:</span> {agriskImport.agriskReadPayload.credit?.rating || "Não informado"}</p>
                                  <p><span className="font-semibold text-[#334155]">Classificação:</span> {agriskImport.agriskReadPayload.credit?.default_probability_label || "Não informado"}</p>
                                  <p><span className="font-semibold text-[#334155]">Restrições:</span> {agriskImport.agriskReadPayload.restrictions?.negative_events_count ?? "Não informado"}</p>
                                  <p><span className="font-semibold text-[#334155]">Restritivos:</span> {(agriskImport.agriskReadPayload.credit?.secondary_scores ?? []).length > 0 ? (agriskImport.agriskReadPayload.credit?.secondary_scores ?? []).map((item) => item.label || item.source || "Restritivo").join(" · ") : "Não informado"}</p>
                                  <p><span className="font-semibold text-[#334155]">Protestos:</span> {agriskImport.agriskReadPayload.protests?.count ?? 0}{agriskImport.agriskReadPayload.protests?.total_amount != null ? ` · R$ ${agriskImport.agriskReadPayload.protests.total_amount.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ""}</p>
                                </div>
                              ) : <p className="text-[11px] text-[#6a7d93]">Resumo ainda não disponível para este relatório.</p>
                            ) : null}

                            {item.key === "internal" ? (
                              internalHasData ? (
                                <div className="grid gap-2 text-[11px] text-[#4f647a] md:grid-cols-2">
                                  <p><span className="font-semibold text-[#334155]">Valor em aberto:</span> {mappedInternalOpenAmount !== null ? formatCurrencyBRLCompactExecutive(mappedInternalOpenAmount) : "Não informado"}</p>
                                  <p><span className="font-semibold text-[#334155]">Not due:</span> {mappedInternalNotDue !== null ? formatCurrencyBRLCompactExecutive(mappedInternalNotDue) : "Não informado"}{internalNotDuePct !== null ? ` · ${internalNotDuePct}%` : ""}</p>
                                  <p><span className="font-semibold text-[#334155]">Overdue:</span> {mappedInternalOverdue !== null ? formatCurrencyBRLCompactExecutive(mappedInternalOverdue) : "Não informado"}{internalOverduePct !== null ? ` · ${internalOverduePct}%` : ""}</p>
                                  <p><span className="font-semibold text-[#334155]">Limite disponível:</span> {mappedInternalAvailableLimit !== null ? formatCurrencyBRLCompactExecutive(mappedInternalAvailableLimit) : "Não informado"}</p>
                                </div>
                              ) : <p className="text-[11px] text-[#6a7d93]">Resumo ainda não disponível para este relatório.</p>
                            ) : null}

                            {item.key === "references" ? (
                              commercialReferences.length > 0 ? (
                                <div className="space-y-1.5 text-[11px] text-[#4f647a]">
                                  <p><span className="font-semibold text-[#334155]">Quantidade de referências:</span> {commercialReferences.length}</p>
                                  {commercialReferences.slice(0, 4).map((reference, index) => (
                                    <p key={`ref-${index}`}><span className="font-semibold text-[#334155]">{reference.name || "Referência"}:</span> {reference.phone ? ` ${reference.phone}` : " contato não informado"}{reference.email ? ` · ${reference.email}` : ""}</p>
                                  ))}
                                </div>
                              ) : <p className="text-[11px] text-[#6a7d93]">Resumo ainda não disponível para este relatório.</p>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </article>
              <article className="rounded-[22px] border border-[#e1e9f3] bg-white p-5 shadow-[0_10px_22px_rgba(10,29,64,.052)]">
                <p className="text-[18px] font-semibold tracking-[-0.01em] text-[#0f172a]">Biblioteca de documentos</p>
                <p className="mt-1 text-[12px] text-[#64748b]">Documentos enviados pelo usuário e consolidados para aprovação.</p>
                <div className="mt-3 divide-y divide-[#ecf1f7] rounded-[16px] bg-[#fbfdff]">
                  {step1LibraryDocuments.length === 0 ? <p className="text-[12px] text-[#64748b]">Nenhum documento disponível.</p> : step1LibraryDocuments.map((document) => (
                    <div key={document.id} className="grid grid-cols-[38px_1fr_auto] items-center gap-3 px-3 py-2.5">
                      <div className="grid h-8 w-8 place-items-center rounded-[10px] bg-[#eaf1ff] text-[10px] font-black text-[#1f4c90]">{document.mime_type?.includes("pdf") ? "PDF" : document.mime_type?.includes("sheet") || document.mime_type?.includes("excel") ? "XLS" : "DOC"}</div>
                      <div>
                        <p className="text-[12px] font-semibold text-[#0f172a]">{resolveDocumentTypeLabel(document.document_type)} · {document.original_filename}</p>
                        <p className="text-[11px] text-[#64748b]">{labelDocumentStatus(document.status)} · {formatImportedAt(document.uploaded_at) || "Data não informada"}</p>
                      </div>
                      <button type="button" onClick={() => void handleOpenLibraryDocument(document)} className="rounded-full border border-[#d7e1ef] bg-white px-3 py-1 text-[10px] font-semibold text-[#334155] hover:bg-[#f8fafc]">Download</button>
                    </div>
                  ))}
                </div>
              </article>
            </div>
            <div className="space-y-3">
              <article className="rounded-[22px] border border-[#dfe8f2] bg-[linear-gradient(180deg,#ffffff_0%,#f9fbff_100%)] p-5 shadow-[0_8px_20px_rgba(10,29,64,.045)]">
                <p className="text-[18px] font-semibold tracking-[-0.01em] text-[#0f172a]">Parecer técnico do analista</p>
                {analysis.comment.trim() ? (
                  <div className="mt-3 min-h-[120px] max-h-[260px] overflow-y-auto overflow-x-hidden rounded-[14px] border border-[#e3ebf5] bg-[linear-gradient(180deg,#fcfdff_0%,#f6faff_100%)] px-4 py-3.5 text-[13px] leading-[1.82] tracking-[0.002em] text-[#22384f] whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{analysis.comment.trim()}</div>
                ) : (
                  <div className="mt-3 min-h-[120px] rounded-[14px] border border-[#e3ebf5] bg-[linear-gradient(180deg,#fbfdff_0%,#f7faff_100%)] px-4 py-3.5 text-[#41556f]">
                    <div>
                      <p className="text-[13px] font-semibold tracking-[0.002em] text-[#1f344d]">Parecer técnico ainda não registrado.</p>
                      <p className="mt-1 text-[12px] leading-[1.7] text-[#5b7089]">O analista poderá consolidar observações adicionais antes do envio para aprovação.</p>
                    </div>
                  </div>
                )}
              </article>
              <article className="rounded-[22px] border border-[#dfe8f2] bg-[linear-gradient(180deg,#ffffff_0%,#f9fbff_100%)] p-5 shadow-[0_9px_20px_rgba(10,29,64,.045)]">
                <p className="text-[18px] font-semibold tracking-[-0.01em] text-[#0f172a]">Trilha da solicitação</p>
                <p className="mt-1 text-[12px] leading-[1.55] text-[#6a7d93]">Fluxo consolidado para aprovação institucional.</p>
                <div className="relative mt-4">
                  <div className="pointer-events-none absolute bottom-2 top-2 left-[18px] w-[1.5px] rounded-full bg-[linear-gradient(180deg,rgba(143,164,189,0.14)_0%,rgba(118,143,174,0.45)_48%,rgba(143,164,189,0.14)_100%)]" />
                  {(() => {
                    const step5Completed = approvalFlowState === "approved" || approvalFlowState === "rejected";
                    const step5Active = approvalFlowState === "in_approval" || step5Completed;
                    const step4Completed = step5Active;
                    const trailItems = [
                      { key: "1", mark: "?", title: "Solicitação criada", description: "Cliente identificado e limite comercial informado.", tone: "done" as const },
                      { key: "2", mark: "?", title: "Coleta de informações", description: "Dados internos, documentos e bureaus consolidados.", tone: "done" as const },
                      { key: "3", mark: "?", title: "Mesa de análise", description: "Score, explicabilidade e parecer técnico consolidados.", tone: "done" as const },
                      {
                        key: "4",
                        mark: step4Completed ? "?" : "›",
                        title: "Revisão e envio",
                        description: "Perfil corporativo revisado e encaminhado para aprovação.",
                        tone: step4Completed ? ("done" as const) : ("active" as const),
                      },
                      {
                        key: "5",
                        mark: step5Completed ? "?" : "5",
                        title: "Aprovação",
                        description: "Decisão da alçada aprovadora e conclusão institucional.",
                        tone: step5Completed ? ("done" as const) : step5Active ? ("active" as const) : ("pending" as const),
                      },
                    ];
                    return trailItems.map(({ mark, title, description, tone }) => (
                    <div key={title} className="relative mb-5 grid grid-cols-[36px_minmax(0,1fr)] items-start gap-3 last:mb-0">
                      <div className="relative z-10 flex w-9 shrink-0 justify-center">
                        <div className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-semibold ${
                        tone === "done"
                          ? "border border-[#9cc8b0] bg-[linear-gradient(180deg,#5a9b78_0%,#4a8868_100%)] text-white shadow-[0_2px_8px_rgba(74,136,104,0.20)]"
                          : tone === "active"
                            ? "border border-[#7ea6d8] bg-[linear-gradient(180deg,#3f6fa7_0%,#335f91_100%)] text-white shadow-[0_2px_8px_rgba(51,95,145,0.20)]"
                            : "border border-[#c7d4e3] bg-[#edf3f9] text-[#7f95ac]"
                        }`}>{mark}</div>
                      </div>
                      <div className="min-w-0 pt-[1px]">
                        <p className={`text-[12.5px] font-semibold leading-[1.35] tracking-[0.006em] ${
                          tone === "active" ? "text-[#0f2747]" : tone === "done" ? "text-[#13243a]" : "text-[#445a73]"
                        }`}>{title}</p>
                        <p className={`mt-1 text-[11px] leading-[1.65] ${
                          tone === "active" ? "text-[#607a97]" : tone === "done" ? "text-[#6f8398]" : "text-[#90a2b5]"
                        }`}>{description}</p>
                      </div>
                    </div>
                  ));
                  })()}
                </div>
              </article>
              {approvalFlowSummary && activeAnalysisId ? (
                <ApprovalWorkflowCard analysisId={activeAnalysisId} summary={approvalFlowSummary} availableActions={dossierApprovalActions} controller={approvalWorkflowController} />
              ) : null}
              <article className="flex min-h-[214px] self-start flex-col rounded-[22px] border border-[#e5edf6] bg-[linear-gradient(180deg,#ffffff_0%,#f9fbff_100%)] px-5 py-5 shadow-[0_6px_14px_rgba(10,29,64,.04)]">
                <div>
                  <p className="text-[17px] font-semibold tracking-[-0.01em] text-[#0f172a]">Resumo financeiro da carteira</p>
                  <p className="mt-1 text-[12px] leading-[1.55] text-[#70859b]">Composição da posição interna atual.</p>
                </div>
                {internalPortfolioSummary.hasAnyPositionData ? (
                  (() => {
                    const openAmount = internalPortfolioSummary.openAmount;
                    const overdueAmount = internalPortfolioSummary.overdueAmount;
                    const currentLimit = internalPortfolioSummary.currentLimit;
                    const availableLimit = internalPortfolioSummary.availableLimit;
                    const overdueHasValue = overdueAmount !== null && overdueAmount > 0;
                    const agingExecutive = resolveExecutiveAgingComposition({
                      sources: internalValueSources,
                      openAmount,
                      notDueAmount: internalPortfolioSummary.notDueAmount,
                      overdueAmount: internalPortfolioSummary.overdueAmount,
                      hasOpenBase: internalPortfolioSummary.hasOpenBase,
                      hasConsistentComposition: internalPortfolioSummary.hasConsistentComposition,
                    });
                    const segmentPalette: Record<string, string> = {
                      not_due_0_30: "bg-[linear-gradient(180deg,#7f95ae_0%,#7087a2_100%)]",
                      "31_60": "bg-[linear-gradient(180deg,#d6b28f_0%,#c99b72_100%)]",
                      "61_90": "bg-[linear-gradient(180deg,#d6a07e_0%,#c98663_100%)]",
                      "91_180": "bg-[linear-gradient(180deg,#cb8668_0%,#b86a4a_100%)]",
                      "180_plus": "bg-[linear-gradient(180deg,#c56f6f_0%,#a84f4f_100%)]",
                    };

                    return (
                      <div className="mt-4 flex w-full flex-1 flex-col">
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6a7d93]">Valor em aberto</p>
                          <p className="mt-1.5 text-[28px] font-black leading-[1.02] tracking-[-0.02em] text-[#0f2747]">
                            {openAmount !== null ? formatCurrencyBRLCompactExecutive(openAmount) : "—"}
                          </p>
                        </div>
                        <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2.5 text-[11px]">
                          <div className="rounded-[10px] border border-[#e2eaf4] bg-[#f7fbff] px-2.5 py-2">
                            <p className="text-[#7a8ea4]">Limite atual</p>
                            <p className="mt-1 font-semibold text-[#1f344d]">{currentLimit !== null ? formatCurrencyBRLCompactExecutive(currentLimit) : "—"}</p>
                          </div>
                          <div className="rounded-[10px] border border-[#e2eaf4] bg-[#f7fbff] px-2.5 py-2">
                            <p className="text-[#7a8ea4]">Limite disponível</p>
                            <p className="mt-1 font-semibold text-[#1f344d]">{availableLimit !== null ? formatCurrencyBRLCompactExecutive(availableLimit) : "—"}</p>
                          </div>
                        </div>
                        {internalPortfolioSummary.hasOpenBase && internalPortfolioSummary.hasConsistentComposition ? (
                          <div className="mt-4 rounded-[10px] border border-[#e2eaf4] bg-[#f8fbff] px-2.5 py-2">
                            <p className={`text-[11px] font-medium ${overdueHasValue ? "text-[#9a3412]" : "text-[#1a6644]"}`}>{agingExecutive.message}</p>
                            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full border border-[#e2eaf4] bg-[#eff4fa]">
                              <div className="flex h-full w-full">
                                {agingExecutive.segments.map((segment) => (
                                  <div key={segment.key} className={`h-full ${segmentPalette[segment.key] ?? "bg-[#94a3b8]"}`} style={{ width: `${segment.percent}%` }} />
                                ))}
                              </div>
                            </div>
                            <p className="mt-1.5 text-[10px] text-[#73879d]">{agingExecutive.summary}</p>
                          </div>
                        ) : null}
                      </div>
                    );
                  })()
                ) : (
                  <p className="mt-4 text-[12px] leading-[1.6] text-[#6a7d93]">Cliente sem posição interna identificada na carteira atual.</p>
                )}
              </article>
            </div>
          </div>

          {submitMutation.isError ? <p className="mt-3 text-[12px] text-[#b91c1c]">{submitMutation.error.message}</p> : null}
          {submitForApprovalMutation.isError && stepError ? <p className="mt-3 text-[12px] text-[#b91c1c]">{stepError}</p> : null}
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
              onClick={handleAdvanceFromStep2ToStep3}
              disabled={!hasStep2Source || isTechnicalDossierCalculationPending}
              className="inline-flex items-center rounded-[8px] bg-[#0D1B2A] px-5 py-2 text-[12px] font-medium text-white disabled:cursor-not-allowed disabled:bg-[#D7E1EC] disabled:text-[#8FA3B4]"
            >
              {isTechnicalDossierCalculationPending ? "Consolidando dados técnicos..." : <>Avançar · Mesa de análise <ChevronRight className="ml-1 h-3.5 w-3.5" /></>}
            </button>
          </div>
          {stepError ? (
            <div className="w-full rounded-[8px] border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[12px] text-[#b91c1c]">
              {stepError}
            </div>
          ) : null}
        </div>
      ) : step === 3 && !isOperationalSubmitOnlyFlow ?(
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-[#D7E1EC] bg-white px-7 py-4">
          <div className="flex items-center gap-2 text-[11px] text-[#8FA3B4]">
            <span className="flex h-4 w-4 items-center justify-center rounded-full border border-[#8FA3B4] text-[9px]">i</span>
            O parecer técnico desta etapa compõe o dossiê consolidado para submissão à aprovação.
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setStep(2)} className="rounded-[8px] border border-[#D7E1EC] bg-white px-5 py-2 text-[12px] font-medium text-[#4F647A]">
              <ChevronLeft className="mr-1 inline h-3.5 w-3.5" />
              Voltar
            </button>
            <button
              type="button"
              onClick={handleAdvanceFromStep3ToStep4}
              disabled={!canContinue || isTechnicalDossierCalculationPending}
              className="rounded-[8px] bg-[#0b1f3a] px-6 py-2 text-[12px] font-medium text-white disabled:cursor-not-allowed disabled:bg-[#D7E1EC] disabled:text-[#8FA3B4]"
            >
              {isTechnicalDossierCalculationPending ? "Consolidando dossiê..." : "Avançar para revisão"}
            </button>
          </div>
          {stepError ? (
            <div className="w-full rounded-[8px] border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[12px] text-[#b91c1c]">
              {stepError}
            </div>
          ) : null}
        </div>
      ) : showAnalystSubmissionFooter ?(
        <div className="mt-2 border-t border-[#D7E1EC] bg-white px-7 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[11px] text-[#8FA3B4]">
              <span className="flex h-4 w-4 items-center justify-center rounded-full border border-[#8FA3B4] text-[9px]">i</span>
              {isWorkspaceMode
                ? "Ao enviar, o dossiê técnico será encaminhado para a alçada de aprovação."
                : "Ao enviar, o motor de crédito será acionado automaticamente com as informações consolidadas."}
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setStep(3)} className="rounded-[8px] border border-[#D7E1EC] bg-white px-5 py-2 text-[12px] font-medium text-[#4F647A]">
                <ChevronLeft className="mr-1 inline h-3.5 w-3.5" />
                Voltar
              </button>
              {isWorkspaceMode ? (
                <button
                  type="button"
                  onClick={submitForApproval}
                  disabled={!canSubmitForApproval || isSubmitPending}
                  className="rounded-[8px] bg-[#1EBD6A] px-6 py-2 text-[12px] font-medium text-white disabled:cursor-not-allowed disabled:bg-[#D7E1EC] disabled:text-[#8FA3B4]"
                >
                  {isSubmitPending ? "Enviando..." : "Submeter para aprovação"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={submit}
                  disabled={!canSubmitJourney}
                  className="rounded-[8px] bg-[#1EBD6A] px-6 py-2 text-[12px] font-medium text-white disabled:cursor-not-allowed disabled:bg-[#D7E1EC] disabled:text-[#8FA3B4]"
                >
                  {isSubmitPending ?"Enviando..." : "Submeter solicitação"}
                </button>
              )}
            </div>
          </div>
          {shouldShowTechnicalPendingGuidance ? (
            <div className="mt-3 rounded-[10px] border border-[#FDE68A] bg-[#FFFBEB] p-3">
              <p className="text-[12px] font-semibold text-[#92400E]">Envio para aprovação indisponível no momento</p>
              <p className="mt-1 text-[12px] text-[#92400E]">{technicalDossierStatus?.display_message}</p>
              <ul className="mt-2 space-y-1.5">
                {(technicalDossierStatus?.missing_requirements ?? []).map((item) => (
                  <li key={item.code} className="text-[12px] text-[#78350F]">
                    <span className="font-medium">{item.label}:</span> {item.description}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : step !== 4 ? (
        <div className="flex items-center justify-between rounded-[10px] border border-[#e2e5eb] bg-white p-3">
          <button type="button" onClick={() => setStep((prev) => Math.max(1, prev - 1))} disabled={step === 1} className="rounded-[6px] border border-[#d1d5db] px-3 py-2 text-[12px] text-[#374151] disabled:opacity-50">
            Voltar
          </button>
          {step < 4 ?(
            isOperationalSubmitOnlyFlow && step === 1 ? (
              <button type="button" onClick={submit} disabled={!canSubmitJourney} className="rounded-[6px] bg-[#059669] px-3 py-2 text-[12px] font-medium text-white disabled:opacity-50">
                {isSubmitPending ?"Enviando..." : "Submeter solicitação"}
              </button>
            ) : (
              <button
                type="button"
                onClick={step === 2 ? handleAdvanceFromStep2ToStep3 : step === 3 ? handleAdvanceFromStep3ToStep4 : () => navigateToStep(Math.min(4, step + 1))}
                disabled={!canContinue || ((step === 2 || step === 3) && isTechnicalDossierCalculationPending)}
                className="rounded-[6px] bg-[#1a2b5e] px-3 py-2 text-[12px] font-medium text-white disabled:opacity-50"
              >
                Avançar
              </button>
            )
          ) : isWorkspaceMode ? (
            <button type="button" onClick={submitForApproval} disabled={!canSubmitForApproval || isSubmitPending} className="rounded-[6px] bg-[#059669] px-3 py-2 text-[12px] font-medium text-white disabled:opacity-50">
              {isSubmitPending ? "Enviando..." : "Submeter para aprovação"}
            </button>
          ) : (
            <button type="button" onClick={submit} disabled={isSubmitPending} className="rounded-[6px] bg-[#059669] px-3 py-2 text-[12px] font-medium text-white disabled:opacity-50">
              {isSubmitPending ?"Enviando..." : "Submeter solicitação"}
            </button>
          )}
        </div>
      ) : null}
      </div>
      {approvalSubmissionSuccessModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-md [animation:overlayFadeIn_.18s_ease-out]">
          <div className="w-full max-w-[560px] rounded-[20px] border border-[#D7E1EC] bg-white p-7 shadow-[0_22px_60px_rgba(2,6,23,0.28)] [animation:modalIn_.2s_ease-out]">
            <h3 className="text-[20px] font-semibold text-[#102033]">Solicitação enviada para aprovação</h3>
            <p className="mt-3 text-[14px] leading-[1.6] text-[#4F647A]">
              O dossiê foi encaminhado para a alçada aprovadora. Você pode acompanhar o andamento pelo Monitor de Solicitações.
            </p>
            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleApprovalSubmissionSuccessClose}
                className="rounded-[10px] bg-[#1EBD6A] px-5 py-2 text-[13px] font-medium text-white"
              >
                Ir para o Monitor
              </button>
            </div>
          </div>
        </div>
      ) : null}
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
                    setDraftRecovery(null);
                    setGovernanceStatus(null);
                    setTriageSelectedBusinessUnit("");
                    setCustomer((prev) => ({ ...prev, cnpj: formatCnpj(event.target.value) }));
                  }} className="h-11 flex-1 rounded-[10px] border border-[#D7E1EC] px-3.5 font-mono text-[15px] tracking-[0.03em] text-[#102033] focus:border-[#1B3A6B] focus:outline-none" placeholder="00.000.000/0000-00" />
                  <button type="button" disabled={!canCreateRequest || triageLookupMutation.isPending} onClick={handleTriageLookup} className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-[#1B3A6B] px-5 text-[14px] font-medium text-white transition hover:bg-[#152E56] disabled:opacity-50">
                    <Search className="h-4 w-4" />
                    {triageLookupMutation.isPending ? "Consultando..." : "Consultar"}
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

