"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Building2, Check, ChevronLeft, ChevronRight, CircleAlert, CreditCard, FileText, FolderOpen, Info, Lock, Search, ShieldCheck, Upload, X } from "lucide-react";

import { checkExistingCreditAnalysis, createCommercialReference, createCreditAnalysisDraft, deleteAnalysisDocument, deleteCommercialReference, downloadAnalysisDocument, getAgriskReportRead, getAnalysisRequestMetadata, getCofaceReportRead, listAnalysisDocuments, listAnalysisReportReads, listCommercialReferences, lookupExternalCnpj, readAgriskReport, readCofaceReport, saveAnalysisRequestMetadata, submitAnalysisJourney, triageCreditRequest, uploadAnalysisDocument } from "@/features/analysis-journey/api/analysis-journey.api";
import { AgriskImportStatus, AgriskReportReadResponse, AnalysisDocumentDto, AnalysisJourneySubmitRequest, AnalysisReportReadSummaryDto, CofaceReportReadResponse, CommercialReference, CreditAnalysisExistingCheckResponse, CreditAnalysisTriageResponse, UploadFileMetadataInput } from "@/features/analysis-journey/api/contracts";
import { getCreditAnalysisDetail, updateCreditAnalysisJourneyProgress, updateCreditAnalysisWorkspaceState } from "@/features/credit-analyses/api/credit-analyses.api";
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
import { getCurrentUserDisplayName } from "@/shared/lib/auth/current-user";

const steps = ["Identificação do cliente", "Coleta de informações", "Mesa de análise", "Revisão e envio"];
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
  score: number;
  weighted: number;
  tooltip: PolicyPillar["tooltip"];
};

type InternalEconomicPosition = {
  open_amount: number | string;
  total_limit: number | string;
  available_limit: number | string;
  overdue_amount?: number | string | null;
  not_due_amount?: number | string | null;
  base_date?: string | null;
};

type ExecutiveNarrativeSeverity = "neutral" | "positive" | "attention";

type ExecutiveNarrativeInput = {
  score: number | null;
  scoreBand: string;
  internalSuggestedLimit: number | null;
  cofaceCoverage: number | null;
  recommendedLimit: number | null;
  exposure: number | null;
  overduePercentage: number | null;
};

type ExecutiveNarrativeResult = {
  summary: string;
  highlights: Array<{ label: string; text: string }>;
  severity: ExecutiveNarrativeSeverity;
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

function normalizeAgriskScoreToTenScale(rawScore: number) {
  if (!Number.isFinite(rawScore) || rawScore <= 0) return 0;
  if (rawScore <= 10) return Math.max(0, Math.min(10, rawScore));
  if (rawScore <= 1000) return Math.max(0, Math.min(10, rawScore / 100));
  return Math.max(0, Math.min(10, rawScore / 100));
}

type ScoreGaugeBand = "Crítico" | "Atenção" | "Moderado" | "Favorável";
type InstitutionalScoreBand = "AA" | "A" | "B" | "C" | "D" | "Informações insuficientes";

type ScoreBandVisualTokens = {
  badgeClass: string;
  textColor: string;
  accent: string;
  ring: string;
  glow: string;
};

function scoreGaugeBandFrom100(score: number) {
  if (score < 40) return "Crítico";
  if (score < 60) return "Atenção";
  if (score < 80) return "Moderado";
  return "Favorável";
}

function scoreGaugeBandToInstitutionalBand(band: ScoreGaugeBand): InstitutionalScoreBand {
  if (band === "Crítico") return "D";
  if (band === "Atenção") return "C";
  if (band === "Moderado") return "B";
  return "A";
}

function getScoreBandVisualTokens(scoreBand: InstitutionalScoreBand): ScoreBandVisualTokens {
  if (scoreBand === "AA") {
    return {
      badgeClass: "bg-[#EAF7EE] text-[#166534] border-[#BBF7D0]",
      textColor: "#166534",
      accent: "#22C55E",
      ring: "#BBF7D0",
      glow: "shadow-[0_12px_30px_rgba(34,197,94,0.22)]"
    };
  }
  if (scoreBand === "A") {
    return {
      badgeClass: "bg-[#EDF6FF] text-[#1D4ED8] border-[#BFDBFE]",
      textColor: "#1D4ED8",
      accent: "#2563EB",
      ring: "#BFDBFE",
      glow: "shadow-[0_12px_30px_rgba(37,99,235,0.20)]"
    };
  }
  if (scoreBand === "B") {
    return {
      badgeClass: "bg-[#EEF2FF] text-[#4338CA] border-[#C7D2FE]",
      textColor: "#E0E7FF",
      accent: "#4F46E5",
      ring: "#4338CA",
      glow: "shadow-[0_10px_28px_rgba(79,70,229,0.14)]"
    };
  }
  if (scoreBand === "C") {
    return {
      badgeClass: "bg-[#FFF7E8] text-[#92400E] border-[#FDE68A]",
      textColor: "#92400E",
      accent: "#D97706",
      ring: "#FDE68A",
      glow: "shadow-[0_12px_30px_rgba(217,119,6,0.20)]"
    };
  }
  if (scoreBand === "D") {
    return {
      badgeClass: "bg-[#FEF2F2] text-[#B91C1C] border-[#FECACA]",
      textColor: "#B91C1C",
      accent: "#DC2626",
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

function scoreGaugeBandClass(band: ScoreGaugeBand) {
  return getScoreBandVisualTokens(scoreGaugeBandToInstitutionalBand(band)).badgeClass;
}

function InstitutionalScoreGauge({ score }: { score: number | null }) {
  const safeScore100 = score === null ? 0 : Math.max(0, Math.min(100, score * 10));
  const displayScore = score === null ? "—" : `${Math.round(safeScore100)}`;
  const band = scoreGaugeBandFrom100(safeScore100);
  const bandToken = getScoreBandVisualTokens(scoreGaugeBandToInstitutionalBand(band));
  const cx = 100;
  const cy = 100;
  const radius = 76;
  const arcLength = Math.PI * radius;
  const pointerRadius = 52;
  const pointerAngle = Math.PI - (safeScore100 / 100) * Math.PI;
  const pointerX = cx + pointerRadius * Math.cos(pointerAngle);
  const pointerY = cy - pointerRadius * Math.sin(pointerAngle);
  const bands = [
    { min: 0, max: 39, color: getScoreBandVisualTokens("D").accent },
    { min: 40, max: 59, color: getScoreBandVisualTokens("C").accent },
    { min: 60, max: 79, color: getScoreBandVisualTokens("B").accent },
    { min: 80, max: 100, color: getScoreBandVisualTokens("A").accent }
  ];

  return (
    <div className="mx-auto w-full max-w-[220px]">
      <svg viewBox="0 0 200 138" className="h-[138px] w-full" role="img" aria-label="Velocímetro do score institucional preliminar">
        <path d="M 24 100 A 76 76 0 0 1 176 100" fill="none" stroke="#E2E8F0" strokeWidth="11" strokeLinecap="round" />
        {bands.map((item) => {
          const startFraction = item.min / 100;
          const endFraction = item.max / 100;
          const segmentLength = (endFraction - startFraction) * arcLength;
          return (
            <path
              key={`${item.min}-${item.max}`}
              d="M 24 100 A 76 76 0 0 1 176 100"
              fill="none"
              stroke={item.color}
              strokeWidth="9"
              strokeLinecap="round"
              strokeDasharray={`${segmentLength} ${arcLength}`}
              strokeDashoffset={`${-startFraction * arcLength}`}
            />
          );
        })}
        <line x1={cx} y1={cy} x2={pointerX} y2={pointerY} stroke={bandToken.accent} strokeWidth="2" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r="4" fill={bandToken.accent} />
        <circle cx={cx} cy={cy} r="6.5" fill="none" stroke="#dbeafe" strokeWidth="1" />
        <text x="24" y="120" textAnchor="start" className="fill-[#94a3b8] text-[10px] font-semibold">0</text>
        <text x="176" y="120" textAnchor="end" className="fill-[#94a3b8] text-[10px] font-semibold">100</text>
      </svg>
      <div className="mt-[-8px] text-center">
        <p className="text-[34px] font-black leading-none text-[#102a4c]">{displayScore}</p>
        <p className="mt-1 text-[11px] font-semibold text-[#64748b]">/100</p>
      </div>
      <div className="mt-1 flex items-center justify-center gap-2">
        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${scoreGaugeBandClass(band)}`}>{band}</span>
      </div>
      <p className="mt-1 text-center text-[11px] font-semibold text-[#64748b]">Score preliminar</p>
      <p className="mt-0.5 text-center text-[10px] text-[#94a3b8]">Score absoluto ponderado pelos pilares da política.</p>
    </div>
  );
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

function buildExecutiveNarrative({
  score,
  scoreBand,
  internalSuggestedLimit,
  cofaceCoverage,
  recommendedLimit,
  exposure,
  overduePercentage
}: ExecutiveNarrativeInput): ExecutiveNarrativeResult {
  const scoreText = score !== null ? `${Math.round(score * 10)}/100` : "informação não disponível";
  const scoreBandText = score !== null ? scoreBand.toUpperCase() : "informação não disponível";
  const internalLimitText = internalSuggestedLimit !== null ? formatCurrencyBRLCompactExecutive(internalSuggestedLimit) : "informação não disponível";
  const coverageText = cofaceCoverage !== null ? formatCurrencyBRLCompactExecutive(cofaceCoverage) : "informação não disponível";
  const recommendedText = recommendedLimit !== null ? formatCurrencyBRLCompactExecutive(recommendedLimit) : "informação não disponível";

  const isRestrictiveScore = score !== null && score < 4;
  const hasCoface = cofaceCoverage !== null && cofaceCoverage > 0;
  const cofaceAsFloor = hasCoface && internalSuggestedLimit !== null && cofaceCoverage > internalSuggestedLimit;
  const hasResidualExposure = exposure !== null && exposure > 0;
  const hasOverdue = overduePercentage !== null && overduePercentage > 0;
  const fullyCovered = exposure !== null && exposure === 0;

  const opening = isRestrictiveScore
    ? `Apesar do perfil de risco ${scoreBandText} (${scoreText}),`
    : `Considerando o perfil de risco ${scoreBandText} (${scoreText}),`;
  const base = ` a política institucional definiu limite interno preliminar de ${internalLimitText}.`;
  const coverageSentence = hasCoface
    ? ` Há cobertura COFACE disponível de ${coverageText}.`
    : " Sem cobertura COFACE disponível, a recomendação permanece limitada ao cálculo interno da política institucional e aos fatores técnicos avaliados na mesa.";
  const floorSentence = hasCoface
    ? cofaceAsFloor
      ? " A cobertura COFACE disponível suporta integralmente a recomendação final e foi adotada como piso decisório, ampliando a mitigação do risco além do limite preliminar."
      : " A cobertura COFACE foi considerada na recomendação, porém sem necessidade de ajuste do piso em relação ao limite preliminar."
    : "";
  const decisionSentence = ` O limite recomendado final é ${recommendedText}.`;
  const exposureSentence = exposure === null
    ? " A exposição residual está com informação não disponível."
    : hasResidualExposure
      ? ` A recomendação final excede a cobertura disponível, gerando exposição residual de ${formatCurrencyBRLCompactExecutive(exposure)} que deve ser considerada na decisão.`
      : " Não há exposição residual identificada na recomendação final.";
  const overdueSentence = overduePercentage === null
    ? " Overdue interno: informação não disponível."
    : hasOverdue
      ? ` Há overdue interno identificado de ${overduePercentage}%, que deve ser considerado como fator de restrição na análise.`
      : " Não há overdue interno identificado.";

  const summary = `${opening}${base}${coverageSentence}${floorSentence}${decisionSentence}${exposureSentence}${overdueSentence}`;

  const highlights: Array<{ label: string; text: string }> = [
    {
      label: "Mitigação",
      text: hasCoface
        ? cofaceAsFloor
          ? "Cobertura COFACE utilizada como piso decisório da recomendação."
          : "Cobertura COFACE disponível, sem efeito de piso sobre o limite interno."
        : "Sem cobertura COFACE; recomendação baseada na política interna."
    },
    {
      label: "Exposição",
      text: exposure === null
        ? "Informação não disponível."
        : hasResidualExposure
          ? `Exposição residual de ${formatCurrencyBRLCompactExecutive(exposure)}.`
          : "Sem exposição residual identificada."
    },
    {
      label: "Carteira",
      text: overduePercentage === null
        ? "Overdue interno com informação não disponível."
        : hasOverdue
          ? `Overdue interno de ${overduePercentage}%.`
          : "Cliente sem overdue interno relevante."
    }
  ];

  const severity: ExecutiveNarrativeSeverity = hasResidualExposure || hasOverdue
    ? "attention"
    : fullyCovered && hasCoface
      ? "positive"
      : "neutral";

  return { summary, highlights, severity };
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
  const [ocr] = useState<OcrState>(buildDefaultOcrState());
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
  const [documentLibraryFeedback, setDocumentLibraryFeedback] = useState<string | null>(null);
  const [expandedPolicyPillarKey, setExpandedPolicyPillarKey] = useState<string | null>(null);
  const [isInstitutionalScoreExpanded, setIsInstitutionalScoreExpanded] = useState(false);
  const [isPreliminaryRecommendationExpanded, setIsPreliminaryRecommendationExpanded] = useState(false);
  const [isTechnicalDetailsOpen, setIsTechnicalDetailsOpen] = useState(false);
  const [isDocumentLibraryOpen, setIsDocumentLibraryOpen] = useState(false);
  const [expandedImportedSummary, setExpandedImportedSummary] = useState<"coface" | "agrisk" | "internal" | "references" | null>(null);
  const [workspaceInternalPosition, setWorkspaceInternalPosition] = useState<InternalEconomicPosition | null>(null);
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

  function resolveWorkspaceInitialStep(analysisRecord: { final_decision?: unknown; analysis_status?: string | null; motor_result?: unknown; current_journey_step?: number | null; last_completed_journey_step?: number | null; analysis_started_at?: string | null } | null | undefined) {
    if (!analysisRecord) return 2;
    if (analysisRecord.final_decision || analysisRecord.analysis_status === "completed" || analysisRecord.motor_result) return 4;
    const persistedStep = analysisRecord.current_journey_step ?? analysisRecord.last_completed_journey_step ?? null;
    if (persistedStep && persistedStep >= 2 && persistedStep <= 4) return persistedStep;
    return analysisRecord.analysis_started_at ? 3 : 2;
  }

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
  const reportReadsQuery = useQuery({
    queryKey: ["analysis-report-reads", activeAnalysisId],
    queryFn: () => listAnalysisReportReads(activeAnalysisId as number),
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

  const hasAgriskImported = agriskImport.status === "valid" || agriskImport.status === "valid_with_warnings";
  const hasInvalidAgriskImport = agriskImport.files.length > 0 && (agriskImport.status === "invalid" || agriskImport.status === "error");
  const hasCofaceImported = isCofaceValidatedStatus(cofaceImport.status);
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
  const isJourneyReadOnly =
    isWorkspaceMode &&
    Boolean(
      workspaceDetailQuery.data?.analysis?.motor_result ||
      workspaceDetailQuery.data?.analysis?.final_decision ||
      workspaceDetailQuery.data?.analysis?.submitted_for_approval_at ||
      workspaceDetailQuery.data?.analysis?.analysis_status === "completed"
    );
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

    if (!analysisRecord?.id || !analysisRecord?.customer_id || !customerRecord?.id || !customerRecord?.document_number || !customerRecord?.company_name || !buName) {
      setWorkspaceError("Não foi possível abrir o workspace: dados obrigatórios da análise estão incompletos.");
      return;
    }

    const toCurrency = (value: number | string | null | undefined) => formatCurrencyBRL(String(value ?? 0));
    const entries = external.entries ?? [];
    const byNewestReads = [...reportReads].sort((a, b) => (new Date(b.created_at).getTime() || 0) - (new Date(a.created_at).getTime() || 0));
    const agriskRead = byNewestReads.find((entry) => entry.source_type === "agrisk");
    const cofaceRead = byNewestReads.find((entry) => entry.source_type === "coface");

    const analysisDocuments = step1DocumentsQuery.data ?? [];
    const findDocumentForRead = (read: AnalysisReportReadSummaryDto | undefined) =>
      read?.analysis_document_id ? analysisDocuments.find((doc) => doc.id === read.analysis_document_id) : undefined;
    const agriskDocument = findDocumentForRead(agriskRead);
    const cofaceDocument = findDocumentForRead(cofaceRead);
    const savedManualPanel = workspaceState?.manual_panel && typeof workspaceState.manual_panel === "object"
      ? (workspaceState.manual_panel as Record<string, unknown>)
      : null;
    const savedManual = workspaceState?.manual && typeof workspaceState.manual === "object"
      ? (workspaceState.manual as Record<string, unknown>)
      : null;
    const savedImports = workspaceState?.imports && typeof workspaceState.imports === "object"
      ? (workspaceState.imports as Record<string, unknown>)
      : null;
    const savedAgriskImport = savedImports?.agrisk && typeof savedImports.agrisk === "object"
      ? (savedImports.agrisk as Record<string, unknown>)
      : null;
    const savedCofaceImport = savedImports?.coface && typeof savedImports.coface === "object"
      ? (savedImports.coface as Record<string, unknown>)
      : null;

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
    setManualPanel((prev) => ({
      ...prev,
      scoreValue: detail.score?.final_score ?? prev.scoreValue,
      analystNotes: analysisRecord.analyst_notes ?? prev.analystNotes
    }));
    if (savedManualPanel) {
      setManualPanel((prev) => ({ ...prev, ...savedManualPanel }));
    }
    if (savedManual) {
      setManual((prev) => ({ ...prev, ...savedManual }));
    }
    if (typeof workspaceState?.manual_configured === "boolean") {
      setManualConfigured(workspaceState.manual_configured);
    }
    setAgriskImport((prev) => ({
      ...prev,
      files: agriskDocument ? [{
        original_filename: agriskDocument.original_filename,
        mime_type: agriskDocument.mime_type,
        file_size: agriskDocument.file_size
      }] : [],
      status: (agriskRead?.status as ImportStatus) ?? "empty",
      importedAt: agriskRead?.created_at ?? null,
      agriskReadId: agriskRead?.id ?? null,
      agriskWarnings: agriskRead?.warnings ?? [],
      errorMessage: agriskRead?.validation_message ?? null,
      agriskReadPayload: (agriskRead?.read_payload as AgriskReportReadResponse["read_payload"] | null) ?? null,
    }));
    if (savedAgriskImport) {
      setAgriskImport((prev) => ({
        ...prev,
        status: (savedAgriskImport.status as ImportStatus) ?? prev.status,
        importedAt: (savedAgriskImport.imported_at as string | null) ?? prev.importedAt,
        agriskReadId: (savedAgriskImport.read_id as number | null) ?? prev.agriskReadId,
        files: savedAgriskImport.original_filename
          ? [{ original_filename: String(savedAgriskImport.original_filename), mime_type: "application/pdf", file_size: Number(savedAgriskImport.file_size ?? 0) }]
          : prev.files
      }));
    }
    setCofaceImport((prev) => ({
      ...prev,
      files: cofaceDocument ? [{
        original_filename: cofaceDocument.original_filename,
        mime_type: cofaceDocument.mime_type,
        file_size: cofaceDocument.file_size
      }] : [],
      status: (cofaceRead?.status as ImportStatus) ?? "empty",
      importedAt: cofaceRead?.created_at ?? null,
      cofaceReadId: cofaceRead?.id ?? null,
      cofaceWarnings: cofaceRead?.warnings ?? [],
      errorMessage: cofaceRead?.validation_message ?? null,
      cofaceReadPayload: (cofaceRead?.read_payload as CofaceReportReadResponse["read_payload"] | null) ?? null,
    }));
    if (savedCofaceImport) {
      setCofaceImport((prev) => ({
        ...prev,
        status: (savedCofaceImport.status as ImportStatus) ?? prev.status,
        importedAt: (savedCofaceImport.imported_at as string | null) ?? prev.importedAt,
        cofaceReadId: (savedCofaceImport.read_id as number | null) ?? prev.cofaceReadId,
        files: savedCofaceImport.original_filename
          ? [{ original_filename: String(savedCofaceImport.original_filename), mime_type: "application/pdf", file_size: Number(savedCofaceImport.file_size ?? 0) }]
          : prev.files
      }));
    }
    setTriageModalOpen(false);
    setStep(resolveWorkspaceInitialStep(analysisRecord));
    setWorkspaceError(null);
    setWorkspaceHydrated(true);
    void (async () => {
      const agriskReadId = (savedAgriskImport?.read_id as number | null) ?? agriskRead?.id ?? null;
      const cofaceReadId = (savedCofaceImport?.read_id as number | null) ?? cofaceRead?.id ?? null;
      if (agriskReadId) {
        try {
          const response = await getAgriskReportRead(agriskReadId);
          setAgriskImport((prev) => ({ ...prev, status: response.status, agriskReadId: response.id, agriskReadPayload: response.read_payload, agriskWarnings: response.warnings, errorMessage: response.validation_message }));
        } catch {}
      }
      if (cofaceReadId) {
        try {
          const response = await getCofaceReportRead(cofaceReadId);
          setCofaceImport((prev) => ({ ...prev, status: response.status, cofaceReadId: response.id, cofaceReadPayload: response.read_payload, cofaceWarnings: response.warnings, errorMessage: response.validation_message }));
        } catch {}
      }
    })();
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
    workspaceExternalDataQuery.isLoading,
    reportReadsQuery.data
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
  const createCommercialReferenceMutation = useMutation({
    mutationFn: (payload: { name: string; phone: string | null; email: string | null }) =>
      createCommercialReference(activeAnalysisId as number, payload),
    onSuccess: () => {
      commercialReferencesQuery.refetch();
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

  function navigateToStep(targetStep: number) {
    if (targetStep === step) return;
    if (isJourneyReadOnly && targetStep < 4) {
      setStepError("A análise já foi encaminhada para aprovação/conclusão e não pode voltar para edição.");
      return;
    }
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
    if (isWorkspaceMode) {
      persistAnalystComment(analysis.comment);
    }
    if (isWorkspaceMode && activeAnalysisId) {
      const lastCompleted = Math.max(1, targetStep - 1);
      persistJourneyProgressMutation.mutate({ id: activeAnalysisId, currentStep: targetStep, lastCompletedStep: lastCompleted });
    }
  }

  useEffect(() => {
    if (!isJourneyReadOnly) return;
    if (step < 4) {
      setStep(4);
    }
  }, [isJourneyReadOnly, step]);

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
        const response = await readAgriskReport(pendingImportRawFile, sanitizeDigits(customer.cnpj), activeAnalysisId ?? null);
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
        await Promise.all([step1DocumentsQuery.refetch(), reportReadsQuery.refetch()]);
        persistWorkspaceStatePatch({
          imports: {
            agrisk: {
              read_id: response.id,
              status: response.status,
              imported_at: importedAt,
              original_filename: pendingImportFile.original_filename,
              file_size: pendingImportFile.file_size
            }
          }
        });
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
        await Promise.all([step1DocumentsQuery.refetch(), reportReadsQuery.refetch()]);
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

  function removeImport(source: ImportSource) {
    if (isWorkspaceMode) {
      const persistedReadId = source === "agrisk" ? agriskImport.agriskReadId : cofaceImport.cofaceReadId;
      if (persistedReadId) {
        setStepError("Este relatório já está vinculado ao dossiê. Envie um novo arquivo para substituir.");
        return;
      }
    }
    const shouldRemove = window.confirm("Deseja remover o relatório importado desta fonte?");
    if (!shouldRemove) return;
    if (source === "agrisk") {
      setIsAgriskDataDrawerOpen(false);
      setAgriskImport(buildDefaultImportState());
      persistWorkspaceStatePatch({ imports: { agrisk: null } });
      return;
    }
    if (source === "coface") {
      setIsCofaceDataDrawerOpen(false);
      setCofaceImport(buildDefaultImportState());
      persistWorkspaceStatePatch({ imports: { coface: null } });
      return;
    }
  }

  function saveManualDrawer() {
    const scoreIsFromImportedAgrisk = hasAgriskImported && manualPanel.scoreSource === "Agrisk";
    const cofaceIsFromImportedReport = hasCofaceImported;

    setManualConfigured(true);
    const nextManual = {
      ...manual,
      comments: manualPanel.analystNotes,
      observations: `Fonte do score: ${scoreIsFromImportedAgrisk ?"Agrisk (importado)" : manualPanel.scoreSource}; Score: ${scoreIsFromImportedAgrisk ?"informado por relatório importado" : manualPanel.scoreValue}; DRA COFACE: ${cofaceIsFromImportedReport ?"informado por relatório importado" : manualPanel.cofaceDra}; Faturamento interno 12 meses: ${manualPanel.internalRevenue12m || "não informado"}`
    };
    setManual(nextManual);
    persistWorkspaceStatePatch({
      manual_configured: true,
      manual_panel: manualPanel,
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
  const mappedInternalOpenAmount = pickNumberFromSources(internalValueSources, [
    "open_amount",
    "total_open_amount"
  ]);
  const mappedInternalTotalLimit = pickNumberFromSources(internalValueSources, [
    "total_limit",
    "credit_limit"
  ]);
  const mappedInternalAvailableLimit = pickNumberFromSources(internalValueSources, [
    "available_limit",
    "limit_available"
  ]);
  const strongCompositionSources: Array<Record<string, unknown> | null> = [
    triageEconomicPositionSource,
    workspaceInternalPositionSource,
    workspacePortfolioDataSource
  ];
  const mappedInternalOverdue = pickNumberFromSources(strongCompositionSources, ["overdue_amount"]);
  const mappedInternalNotDue = pickNumberFromSources(strongCompositionSources, ["not_due_amount"]);
  const hasAnyMappedFinancialValue =
    mappedInternalOpenAmount !== null || mappedInternalTotalLimit !== null || mappedInternalAvailableLimit !== null;
  const hasInternalPositionData = hasAnyMappedFinancialValue;
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

  useEffect(() => {
    const isWorkspaceEligible = isWorkspaceMode && workspaceHydrated;
    const digits = sanitizeDigits(customer.cnpj);
    const hasValidCnpj = digits.length === 14;
    const portfolioByWorkspace =
      (typeof workspaceTriageSubmission?.source === "string" && workspaceTriageSubmission.source === "portfolio") ||
      (typeof workspaceTriageSubmission?.found_in_portfolio === "boolean" && workspaceTriageSubmission.found_in_portfolio);
    const hasPortfolioFlag = Boolean(triageResult?.found_in_portfolio) || portfolioByWorkspace;
    const hasEconomicPosition = Boolean(triageResult?.economic_position || workspaceInternalPosition);

    if (!isWorkspaceEligible || !hasValidCnpj || !hasPortfolioFlag || hasEconomicPosition) return;

    let cancelled = false;
    void (async () => {
      try {
        const response = await triageCreditRequest({ cnpj: digits });
        if (cancelled || !response.found_in_portfolio || !response.economic_position) return;

        setWorkspaceInternalPosition({
          open_amount: response.economic_position.open_amount,
          total_limit: response.economic_position.total_limit,
          available_limit: response.economic_position.available_limit,
          overdue_amount: response.economic_position.overdue_amount ?? null,
          not_due_amount: response.economic_position.not_due_amount ?? null,
          base_date: response.economic_position.base_date ?? null
        });
        setTriageResult((prev) =>
          prev
            ? { ...prev, found_in_portfolio: response.found_in_portfolio, customer_data: response.customer_data, economic_position: response.economic_position }
            : response
        );
      } catch {
        // Keep silent: card will continue using available fallbacks.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [customer.cnpj, isWorkspaceMode, triageResult, workspaceHydrated, workspaceInternalPosition, workspaceTriageSubmission]);

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
  const hasFinancialDocuments = financialDocuments.length > 0;
  const hasValidCofaceCoverage = technicalCoverageValue !== null && technicalCoverageValue > 0;
  const financialPillarScore = hasValidCofaceCoverage ? 10 : 0;
  const financialPillarStatus: PolicyPillarStatus = hasValidCofaceCoverage ? "Forte" : "Informações insuficientes";
  const financialPillarSummary = hasValidCofaceCoverage
    ? "Cobertura COFACE válida considerada como mitigador da estabilidade financeira."
    : "Pilar não avaliado por ausência de DFs/relatório financeiro estruturado.";
  const financialPillarCriteria = hasValidCofaceCoverage
    ? [
      `Cobertura COFACE válida: ${formatCurrencyBRL(String(technicalCoverageValue))}`,
      "Mitigação financeira aplicada conforme política institucional",
      "Pilar avaliado com score máximo pela garantia externa"
    ]
    : [
      "Ausência de documentação financeira estruturada para motor institucional",
      "Score financeiro estruturado indisponível"
    ];
  const financialPillarExplanation = hasValidCofaceCoverage
    ? "A cobertura COFACE válida e positiva é tratada como mitigador da instabilidade financeira nesta etapa preliminar, atribuindo nota máxima ao pilar de Estabilidade Financeira e Liquidez."
    : "A ausência de documentação financeira estruturada não é tratada como dado neutro. Enquanto não houver DFs ou relatório financeiro AGRISK disponível, o pilar permanece com nota zero e impacta o score institucional.";
  const financialPillarSource = hasValidCofaceCoverage
    ? "COFACE, DFs e relatório financeiro AGRISK."
    : "DFs e relatório financeiro AGRISK.";
  const financialPillarNote = hasValidCofaceCoverage
    ? "Cobertura COFACE válida aplicada como mitigador, com nota 10.0/10."
    : "Enquanto a fonte estruturada não estiver ativa, o pilar permanece com nota 0.0/10.";
  const guaranteeRequestedLimit = technicalRequestedLimit > 0 ? technicalRequestedLimit : 0;
  const guaranteeCoverageRatio = technicalCoverageValue !== null && guaranteeRequestedLimit > 0
    ? technicalCoverageValue / guaranteeRequestedLimit
    : 0;
  const guaranteePillarScore = !hasCofaceImported || technicalCoverageValue === null || technicalCoverageValue <= 0 || guaranteeRequestedLimit <= 0
    ? 0
    : Math.max(0, Math.min(10, guaranteeCoverageRatio * 10));
  const guaranteePillarStatus: PolicyPillarStatus = guaranteePillarScore >= 8
    ? "Forte"
    : guaranteePillarScore >= 6
      ? "Adequado"
      : guaranteePillarScore >= 4
        ? "Atenção"
        : guaranteePillarScore >= 1
          ? "Crítico"
          : "Informações insuficientes";
  const guaranteeCoveragePercent = Math.max(0, Math.round(guaranteeCoverageRatio * 100));
  const guaranteeCoverageHelperText = !hasCofaceImported || technicalCoverageValue === null || technicalCoverageValue <= 0 || guaranteeRequestedLimit <= 0
    ? "Sem cobertura estruturada disponível."
    : `Cobertura COFACE equivalente a ${guaranteeCoveragePercent}% do limite solicitado.`;
  const marketPillarScore = 0;
  const marketPillarStatus: PolicyPillarStatus = "Informações insuficientes";
  const agriskRestrictiveScoresRaw = [
    agriskImport.agriskReadPayload?.credit?.score ?? null,
    ...(agriskImport.agriskReadPayload?.credit?.secondary_scores ?? []).map((item) => item.score ?? null)
  ]
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
  const agriskRestrictiveScoresNormalized = agriskRestrictiveScoresRaw.map((score) => normalizeAgriskScoreToTenScale(score));
  const paymentPillarScore = agriskRestrictiveScoresNormalized.length === 0
    ? 0
    : agriskRestrictiveScoresNormalized.reduce((acc, score) => acc + score, 0) / agriskRestrictiveScoresNormalized.length;
  const paymentPillarStatus: PolicyPillarStatus = paymentPillarScore >= 8
    ? "Forte"
    : paymentPillarScore >= 6
      ? "Adequado"
      : paymentPillarScore >= 4
        ? "Atenção"
        : paymentPillarScore >= 1
          ? "Crítico"
          : "Informações insuficientes";
  const paymentPillarHelperText = agriskRestrictiveScoresNormalized.length === 0
    ? "Sem scores restritivos AGRISK disponíveis."
    : `Média dos scores restritivos AGRISK disponíveis: ${paymentPillarScore.toFixed(1)}/10.`;
  const relationshipHasInternalBase = hasInternalDataAvailable;
  const relationshipExposure = technicalExposureValue > 0 ? technicalExposureValue : 0;
  const relationshipOverdue = technicalOverdueValue !== null && technicalOverdueValue > 0 ? technicalOverdueValue : 0;
  const relationshipHasActiveExposure = relationshipExposure > 0;
  const relationshipOverdueRatio = relationshipHasActiveExposure ? relationshipOverdue / relationshipExposure : 0;
  const relationshipPillarScore = !relationshipHasInternalBase
    ? 0
    : !relationshipHasActiveExposure
      ? 6
      : relationshipOverdue <= 0
        ? 10
        : relationshipOverdueRatio <= 0.05
          ? 7.5
          : 5;
  const relationshipPillarStatus: PolicyPillarStatus = relationshipPillarScore >= 8
    ? "Forte"
    : relationshipPillarScore >= 6
      ? "Adequado"
      : relationshipPillarScore >= 4
        ? "Atenção"
        : relationshipPillarScore >= 1
          ? "Crítico"
          : "Informações insuficientes";
  const relationshipPillarHelperText = !relationshipHasInternalBase
    ? "Cliente novo, sem histórico interno de relacionamento."
    : !relationshipHasActiveExposure
      ? "Cliente na base interna, sem exposição atual."
      : relationshipOverdue <= 0
        ? "Cliente com relacionamento ativo na carteira e sem overdue relevante."
        : relationshipOverdueRatio <= 0.05
          ? "Cliente com overdue interno moderado."
          : "Cliente com overdue interno relevante.";
  const policyPillars: PolicyPillar[] = [
    {
      key: "financial_liquidity",
      title: "Estabilidade Financeira e Liquidez",
      weight: 55,
      score: financialPillarScore,
      status: financialPillarStatus,
      summary: financialPillarSummary,
      sources: ["Documentação financeira", "Agrisk"],
      criteria: financialPillarCriteria,
      explanation: financialPillarExplanation,
      tooltip: {
        title: "Estabilidade Financeira e Liquidez",
        description: "Avalia a robustez financeira por demonstrações financeiras, liquidez, endividamento e geração de caixa.",
        source: financialPillarSource,
        note: financialPillarNote,
        weightLabel: "Peso do Pilar: 55%"
      }
    },
    {
      key: "guarantees",
      title: "Garantias / Seguro de Crédito",
      weight: 20,
      score: guaranteePillarScore,
      status: guaranteePillarStatus,
      summary: guaranteeCoverageHelperText,
      sources: ["COFACE", "Mesa de análise"],
      criteria: [
        guaranteeRequestedLimit > 0 ? `Limite solicitado: ${formatCurrencyBRL(String(guaranteeRequestedLimit))}` : "Limite solicitado indisponível",
        technicalCoverageValue !== null ? `Cobertura segurada: ${formatCurrencyBRL(String(technicalCoverageValue))}` : "Cobertura segurada não disponível",
        `Índice de cobertura: ${guaranteeCoveragePercent}%`
      ],
      explanation: "A nota é calculada por (Cobertura COFACE / Limite Solicitado) × 10, com limite máximo de 10.0.",
      tooltip: {
        title: "Garantias / Seguro de Crédito",
        description: "Avalia o nível de mitigação do risco da operação por cobertura COFACE, exposição líquida não coberta e garantias estruturadas.",
        source: "COFACE, Carteira Corporativa e Complemento Manual.",
        note: "A nota atual reflete diretamente o percentual coberto da solicitação comercial original.",
        weightLabel: "Peso do Pilar: 20%"
      }
    },
    {
      key: "market_conditions",
      title: "Condições de Mercado",
      weight: 15,
      score: marketPillarScore,
      status: marketPillarStatus,
      summary: "Metodologia de condições de mercado em evolução no modelo atual.",
      sources: ["Agrisk", "Dados externos existentes"],
      criteria: [
        "Pilar preservado institucionalmente no motor de score",
        "Metodologia ativa ainda em evolução"
      ],
      explanation: "O pilar permanece visível conforme política oficial, porém sem metodologia robusta ativa nesta fase.",
      tooltip: {
        title: "Condições de Mercado",
        description: "Avalia fatores externos relacionados ao ambiente de atuação do cliente, como setor, mercado e condições macroeconômicas.",
        source: "Dados externos e sinais de mercado disponíveis.",
        note: "Metodologia em evolução no modelo atual.",
        weightLabel: "Peso do Pilar: 15%"
      }
    },
    {
      key: "payment_history",
      title: "Histórico de Pagamento",
      weight: 5,
      score: paymentPillarScore,
      status: paymentPillarStatus,
      summary: paymentPillarHelperText,
      sources: ["AGRISK"],
      criteria: [
        `Scores restritivos considerados: ${agriskRestrictiveScoresNormalized.length}`,
        agriskRestrictiveScoresNormalized.length > 0
          ? `Média em escala 0-10: ${paymentPillarScore.toFixed(1)}`
          : "Sem scores restritivos disponíveis no relatório"
      ],
      explanation: "A nota considera média simples dos scores restritivos AGRISK disponíveis, convertidos para escala 0-10.",
      tooltip: {
        title: "Histórico de Pagamento",
        description: "Avalia o comportamento de crédito do cliente com base nos scores restritivos disponíveis no relatório AGRISK.",
        source: "AGRISK — QUOD, Boa Vista e scores restritivos disponíveis.",
        note: "Sem scores disponíveis, a nota do pilar permanece 0.0/10.",
        weightLabel: "Peso do Pilar: 5%"
      }
    },
    {
      key: "relationship_history",
      title: "Histórico de Relacionamento",
      weight: 5,
      score: relationshipPillarScore,
      status: relationshipPillarStatus,
      summary: relationshipPillarHelperText,
      sources: ["Histórico interno", "Carteira interna"],
      criteria: [
        relationshipHasInternalBase ? "Cliente localizado na base interna" : "Cliente sem histórico interno consolidado",
        relationshipHasActiveExposure ? `Exposição interna ativa: ${formatCurrencyBRL(String(relationshipExposure))}` : "Sem exposição interna ativa",
        relationshipHasActiveExposure ? `Overdue interno: ${formatCurrencyBRL(String(relationshipOverdue))}` : "Overdue não aplicável sem exposição ativa"
      ],
      explanation: "A nota segue regra objetiva por presença em base interna, exposição ativa e proporção de overdue interno sobre a exposição.",
      tooltip: {
        title: "Histórico de Relacionamento",
        description: "Avalia o relacionamento interno do cliente com a empresa, considerando presença na carteira corporativa, exposição atual e comportamento de pagamento interno.",
        source: "Carteira Corporativa / AR Aging.",
        note: "Regra objetiva aplicada com base em presença na carteira, exposição e overdue interno.",
        weightLabel: "Peso do Pilar: 5%"
      }
    }
  ];
  const institutionalScoreBreakdown: InstitutionalScoreBreakdownItem[] = policyPillars
    .filter((pillar): pillar is PolicyPillar & { score: number } => pillar.score !== null)
    .map((pillar) => ({
      key: pillar.key,
      title: pillar.title,
      weight: pillar.weight,
      score: pillar.score,
      weighted: pillar.score * pillar.weight,
      tooltip: pillar.tooltip
    }));
  const institutionalTotalWeight = policyPillars.reduce((acc, pillar) => acc + pillar.weight, 0);
  const hasInstitutionalScoreData = institutionalScoreBreakdown.length === policyPillars.length;
  const institutionalScore = hasInstitutionalScoreData
    ? institutionalTotalWeight > 0
      ? institutionalScoreBreakdown.reduce((acc, item) => acc + item.weighted, 0) / institutionalTotalWeight
      : null
    : null;
  const institutionalRiskBand = institutionalScore !== null ? toScoreBand(institutionalScore) : "Informações insuficientes";
  const executiveScoreBand = institutionalRiskBand.toUpperCase();
  const institutionalBandVisual = getScoreBandVisualTokens(institutionalRiskBand);
  const institutionalScorePercent = institutionalScore !== null ? Math.max(0, Math.min(100, Math.round(institutionalScore * 10))) : 0;
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
    return "Perfil não consolidado";
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
  const preliminaryRecommendedLimit = (() => {
    if (institutionalScore === null || technicalRequestedLimit <= 0) return null;
    const scoreFactor = institutionalScore >= 9 ? 1 : institutionalScore >= 8 ? 0.95 : institutionalScore >= 6 ? 0.8 : institutionalScore >= 4 ? 0.6 : 0.4;
    const baseByScore = technicalRequestedLimit * scoreFactor;
    const baseByCoverage = technicalCoverageValue !== null ? Math.min(baseByScore, technicalCoverageValue) : baseByScore * 0.7;
    return Math.max(0, baseByCoverage);
  })();
  const executiveCofaceFloorApplied =
    preliminaryRecommendedLimit !== null &&
    technicalCoverageValue !== null &&
    technicalCoverageValue > preliminaryRecommendedLimit;
  const executiveDisplayedRecommendedLimit =
    preliminaryRecommendedLimit === null
      ? (technicalCoverageValue !== null ? Math.max(technicalCoverageValue, 0) : null)
      : (technicalCoverageValue !== null ? Math.max(preliminaryRecommendedLimit, technicalCoverageValue) : preliminaryRecommendedLimit);
  const executiveCoverageAvailable = technicalCoverageValue !== null ? Math.max(technicalCoverageValue, 0) : 0;
  const executiveNetInternalExposure = executiveDisplayedRecommendedLimit !== null
    ? Math.max(executiveDisplayedRecommendedLimit - executiveCoverageAvailable, 0)
    : null;
  const executiveExposureFullyCovered = executiveNetInternalExposure !== null && executiveNetInternalExposure === 0;
  const executiveExposureHasResidual = executiveNetInternalExposure !== null && executiveNetInternalExposure > 0;
  const executiveInternalSuggestedLimit = (() => {
    if (institutionalScore === null || technicalRequestedLimit <= 0) return null;
    const scoreFactor = institutionalScore >= 9 ? 1 : institutionalScore >= 8 ? 0.95 : institutionalScore >= 6 ? 0.8 : institutionalScore >= 4 ? 0.6 : 0.4;
    return Math.max(0, technicalRequestedLimit * scoreFactor);
  })();
  const executiveNarrative = buildExecutiveNarrative({
    score: institutionalScore,
    scoreBand: institutionalRiskBand,
    internalSuggestedLimit: executiveInternalSuggestedLimit,
    cofaceCoverage: technicalCoverageValue,
    recommendedLimit: executiveDisplayedRecommendedLimit,
    exposure: executiveNetInternalExposure,
    overduePercentage: executiveOverduePercent
  });
  const executiveNarrativeCardClass = executiveNarrative.severity === "attention"
    ? "border border-[#E5EAF1] bg-[linear-gradient(180deg,#FFFFFF_0%,#FAFCFF_100%)]"
    : executiveNarrative.severity === "positive"
      ? "border border-[#E5EAF1] bg-[linear-gradient(180deg,#FFFFFF_0%,#FAFCFF_100%)]"
      : "border border-[#E5EAF1] bg-[linear-gradient(180deg,#FFFFFF_0%,#FAFCFF_100%)]";
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
    if (!hasStep1Workspace) {
      setDocumentUploadFeedback({ type: "error", message: "Não foi possível preparar a solicitação para upload. Consulte o CNPJ novamente." });
      return;
    }
    setDocumentUploadFeedback(null);
    await uploadStep1DocumentMutation.mutateAsync({ documentType, file });
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
    if (isStep1ReadOnly) {
      setCommercialReferenceForm((prev) => ({ ...prev, error: "Esta solicitação já foi submetida para análise e não pode ser alterada nesta etapa." }));
      return;
    }
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

          <fieldset disabled={isGovernanceBlocked || isStep1ReadOnly} className="contents">
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

      {step === 2 ?(
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
        <div className="mt-3 space-y-4">
          <div className="relative overflow-hidden rounded-[30px] bg-[linear-gradient(135deg,#071426_0%,#0b1f3a_45%,#102a4c_100%)] px-5 py-[18px] text-white shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#bfdbfe]">Etapa 3 · Mesa de análise</p>
            <h2 className="mt-1.5 text-[30px] font-extrabold leading-[1.05] tracking-[-0.04em] text-white">Mesa corporativa de análise de crédito</h2>
            <p className="mt-2 text-[13px] leading-5 text-[#dbeafe] md:whitespace-nowrap">Consolidação técnica dos dados internos, bureaus, política de crédito e julgamento do analista antes da revisão e envio para aprovação.</p>
            <div className="mt-4 grid gap-2.5 md:grid-cols-2 xl:grid-cols-[1.2fr_0.95fr_0.95fr_0.95fr_0.95fr]">
              <div className="rounded-[18px] border border-white/20 bg-white/10 p-3.5">
                <p className="text-[11px] font-semibold text-[#bfdbfe]">Cliente</p>
                <p className="mt-1.5 overflow-hidden text-[20px] font-extrabold leading-tight text-white [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">{customer.companyName || "Não informado"}</p>
                <p className="mt-1 text-[11px] text-[#dbeafe]">{formatCnpjForDisplay(customer.cnpj)}</p>
              </div>
              <div className="rounded-[18px] border border-white/20 bg-white/10 p-3.5"><p className="text-[11px] font-semibold text-[#bfdbfe]">Limite solicitado</p><p className="mt-1.5 text-[20px] font-extrabold text-white">{technicalRequestedLimit > 0 ? formatCurrencyBRLCompactExecutive(technicalRequestedLimit) : "—"}</p><p className="mt-0.5 text-[11px] text-[#dbeafe]">Condição comercial proposta</p></div>
              <div className="rounded-[18px] border border-white/20 bg-white/10 p-3.5"><p className="text-[11px] font-semibold text-[#bfdbfe]">Cobertura COFACE</p><p className="mt-1.5 text-[20px] font-extrabold text-white">{technicalCoverageValue !== null ? formatCurrencyBRLCompactExecutive(technicalCoverageValue) : "—"}</p><p className="mt-0.5 text-[11px] text-[#dbeafe]">{executiveCoveragePercent !== null ? `${executiveCoveragePercent}% do limite solicitado` : "Sem percentual"}</p></div>
              <div className="rounded-[18px] border border-white/20 bg-white/10 p-3.5"><p className="text-[11px] font-semibold text-[#bfdbfe]">Valor em Aberto</p><p className="mt-1.5 text-[20px] font-extrabold text-white">{mappedInternalOpenAmount !== null ? formatCurrencyBRLCompactExecutive(mappedInternalOpenAmount) : "—"}</p><p className="mt-0.5 text-[11px] text-[#dbeafe]">Notdue: {mappedInternalNotDue !== null ? formatCurrencyBRLCompactExecutive(mappedInternalNotDue) : "—"} · Overdue: {mappedInternalOverdue !== null ? formatCurrencyBRLCompactExecutive(mappedInternalOverdue) : "—"}</p></div>
              <div className="rounded-[18px] border border-white/20 bg-white/10 p-3.5"><p className="text-[11px] font-semibold text-[#bfdbfe]">Status técnico</p><p className="mt-1.5 text-[20px] font-extrabold text-white">{technicalStatusLabel}</p><p className="mt-0.5 text-[11px] text-[#dbeafe]">Aguardando parecer final</p></div>
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
                    <p className="text-[11px] text-[#dbeafe]">{executiveCofaceFloorApplied ? "Cobertura COFACE utilizada como piso decisório." : "Recomendação preliminar da política institucional."}</p>
                  </div>
                  <div className="rounded-[18px] border border-[#E8EEF5] bg-[rgba(248,250,252,0.78)] p-2.5">
                    <div className="grid gap-2.5 sm:grid-cols-3">
                    <div className="rounded-[14px] border border-[#EDF2F7] border-t bg-[rgba(255,255,255,0.78)] px-3.5 py-2.5" style={executiveRiskAccentStyle}>
                      <div className="flex items-center">
                        <p className="text-[11px] font-semibold text-[#475569]">Perfil de risco</p>
                      </div>
                      <p className="mt-1 text-[18px] font-extrabold leading-tight text-[#0f172a]">{institutionalScore !== null ? executiveRiskProfile : "—"}</p>
                      <p className="mt-0.5 text-[11px] text-[#64748b]">{institutionalScore !== null ? `${Math.round(institutionalScore * 10)}/100` : "Sem score"}</p>
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

              <article className="rounded-[24px] border border-[#D7E1EC] bg-white p-5 shadow-[0_10px_32px_rgba(15,23,42,0.06)]">
                <p className="text-[18px] font-semibold text-[#0f172a]">Score institucional preliminar</p>
                <div className="mt-4 grid gap-4 lg:grid-cols-[220px_1fr]">
                  <InstitutionalScoreGauge score={institutionalScore} />
                  <div>
                    <div className="space-y-3">
                      {institutionalScoreBreakdown.map((item) => (
                        <div key={item.key}>
                          <div className="mb-1 flex items-center justify-between text-[12px] font-semibold text-[#334155]">
                            <span className="inline-flex items-center gap-2">
                              <span>{item.title}</span>
                              <span className="group relative inline-flex">
                                <Info className="h-3.5 w-3.5 text-[#94a3b8] transition-colors duration-150 group-hover:text-[#2563eb]" />
                                <span className="pointer-events-none absolute left-1/2 top-[calc(100%+8px)] z-30 w-[300px] -translate-x-1/2 rounded-[10px] border border-[#E2E8F0] bg-white px-3 py-2 text-left text-[11px] font-normal text-[#334155] opacity-0 shadow-[0_8px_20px_rgba(15,23,42,0.08)] transition-all duration-150 group-hover:translate-y-0 group-hover:opacity-100">
                                  <span className="block text-[11px] font-semibold text-[#0f172a]">{item.tooltip.title}</span>
                                  <span className="mt-1 block leading-4">{item.tooltip.description}</span>
                                  <span className="mt-1 block text-[#475569]"><strong>Fonte:</strong> {item.tooltip.source}</span>
                                  {item.tooltip.weightLabel ? <span className="mt-1 block font-semibold text-[#64748b]">{item.tooltip.weightLabel}</span> : null}
                                  <span className="mt-1 block text-[#64748b]">{item.tooltip.note}</span>
                                </span>
                              </span>
                              {item.key === "financial_liquidity" && hasValidCofaceCoverage ? <span className="inline-flex rounded-full border border-[#BFDBFE] bg-[#EFF6FF] px-2 py-0.5 text-[10px] font-semibold text-[#1D4ED8]">Mitigado por COFACE</span> : null}
                              {item.key === "financial_liquidity" && !hasValidCofaceCoverage && item.score === 0 ? <span className="inline-flex rounded-full border border-[#E2E8F0] bg-[#F8FAFC] px-2 py-0.5 text-[10px] font-semibold text-[#64748b]">Não avaliado</span> : null}
                              {item.key === "market_conditions" && item.score === 0 ? <span className="inline-flex rounded-full border border-[#E2E8F0] bg-[#F8FAFC] px-2 py-0.5 text-[10px] font-semibold text-[#64748b]">Em evolução</span> : null}
                            </span>
                            <span>{item.score.toFixed(1)}/10</span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full border border-[#E2E8F0] bg-[#F1F5F9]">
                            <div className={`h-full rounded-full ${item.key === "financial_liquidity" ? "bg-[#94a3b8]" : "bg-[#2563eb]"}`} style={{ width: `${Math.max(0, Math.min(100, item.score * 10))}%` }} />
                          </div>
                          {item.key === "financial_liquidity" && !hasValidCofaceCoverage && item.score === 0 ? <p className="mt-1 text-[11px] text-[#64748b]">Impacta o score por ausência de demonstrações financeiras estruturadas.</p> : null}
                          {item.key === "guarantees" ? <p className="mt-1 text-[11px] text-[#64748b]">{guaranteeCoverageHelperText}</p> : null}
                          {item.key === "market_conditions" && item.score === 0 ? <p className="mt-1 text-[11px] text-[#64748b]">Metodologia de condições de mercado em evolução no modelo atual.</p> : null}
                          {item.key === "payment_history" ? <p className="mt-1 text-[11px] text-[#64748b]">{paymentPillarHelperText}</p> : null}
                          {item.key === "relationship_history" ? <p className="mt-1 text-[11px] text-[#64748b]">{relationshipPillarHelperText}</p> : null}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </article>

              <article className="rounded-[24px] border border-[#D7E1EC] bg-white p-5 shadow-[0_10px_32px_rgba(15,23,42,0.06)]">
                <p className="text-[18px] font-semibold text-[#0f172a]">Parecer técnico do analista</p>
                <textarea value={analysis.comment} onChange={(event) => setAnalysis((prev) => ({ ...prev, comment: event.target.value }))} onBlur={(event) => persistAnalystComment(event.target.value)} className="mt-3 min-h-[180px] w-full rounded-[20px] border border-[#E2E8F0] px-4 py-3 text-[13px] text-[#334155]" placeholder="Registrar análise qualitativa, fundamentos da recomendação e ressalvas antes da revisão." />
                <p className="mt-2 text-[12px] text-[#64748b]">Parecer usado na geração do dossiê técnico.</p>
              </article>
            </div>
            <aside className="space-y-4">
              <article className={`rounded-[24px] p-6 shadow-[0_4px_14px_rgba(15,23,42,0.04)] ${executiveNarrativeCardClass}`}>
                <div className="flex items-start gap-3">
                  <span className="mt-1 h-10 w-[3px] rounded-full bg-[#8DB8EA]" aria-hidden="true" />
                  <div>
                    <p className="text-[18px] font-semibold text-[#0f172a]">Explicação da análise</p>
                    <p className="mt-1 text-[13px] text-[#64748b]">Leitura executiva da lógica aplicada à recomendação.</p>
                  </div>
                </div>
                <p className="mt-5 max-w-[70ch] text-[13px] leading-[1.85] text-[#334155]">{executiveNarrative.summary}</p>
                <ul className="mt-5 divide-y divide-[#E8EEF5]/70 text-[12px] text-[#475569]">
                  {executiveNarrative.highlights.slice(0, 3).map((item, index) => (
                    <li key={`${item.label}-${index}`} className="py-3.5 first:pt-0 last:pb-0">
                      <p className="text-[12px] font-medium tracking-[0.01em] text-[#5B6E84]">{item.label}</p>
                      <p className="mt-1.5 text-[12px] leading-relaxed text-[#334155]">{item.text}</p>
                    </li>
                  ))}
                </ul>
              </article>
              <article className="rounded-[24px] border border-[#D7E1EC] bg-[linear-gradient(180deg,#FFFFFF_0%,#FAFCFF_100%)] p-5 shadow-[0_10px_24px_rgba(15,23,42,0.05)]">
                <p className="text-[18px] font-semibold text-[#0f172a]">Dossiê de Crédito</p>
                <p className="mt-1 text-[13px] text-[#64748b]">Encerramento institucional da mesa de análise com consolidação do parecer técnico do analista.</p>
                <div className="mt-4 rounded-[18px] border border-[#D7E6F6] bg-[linear-gradient(180deg,#F8FBFF_0%,#F1F6FD_100%)] p-4">
                  <p className="text-[16px] font-extrabold text-[#0b1f3a]">Dossiê técnico consolidado</p>
                  <p className="mt-2 max-w-[560px] text-[13px] leading-relaxed text-[#475569]">O dossiê consolida score institucional, parecer técnico, mitigadores, exposição, condições recomendadas e trilha decisória para submissão à aprovação.</p>
                  <button type="button" onClick={() => navigateToStep(4)} className="mt-4 inline-flex items-center rounded-full bg-[#0b1f3a] px-5 py-2.5 text-[13px] font-extrabold text-white">Avançar para revisão</button>
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
                      <p className="text-[32px] font-light leading-none tracking-[-0.022em] text-[#F2F6FC]">{institutionalScore !== null ? institutionalScorePercent : "—"}</p>
                      <p className="mt-0.5 text-[20px] font-semibold leading-none text-[#A8B4C7]">/100</p>
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
          <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.68fr)_minmax(320px,0.78fr)]">
            <div>
              {(() => {
                const recommended = executiveDisplayedRecommendedLimit ?? 0;
                const requested = technicalRequestedLimit;
                const exposureResidual = executiveNetInternalExposure ?? 0;
                const hasCoverage = technicalCoverageValue !== null && technicalCoverageValue > 0;
                const recommendationLabel =
                  recommended <= 0
                    ? "Reprovação recomendada"
                    : requested > 0 && recommended < requested
                      ? "Aprovação parcial recomendada"
                      : "Aprovação recomendada";
                const recommendationToneClass =
                  recommended <= 0
                    ? "text-[#9f1239]"
                    : requested > 0 && recommended < requested
                      ? "text-[#92400e]"
                      : "text-[#166534]";
                const executiveRationale = hasCoverage && exposureResidual <= 0
                  ? "Cobertura COFACE integral mitigando a exposição da operação."
                  : exposureResidual > 0
                    ? "Exposição residual identificada e destacada para decisão da alçada aprovadora."
                    : hasCoverage
                      ? "Cobertura COFACE considerada na recomendação final submetida para aprovação."
                      : "Recomendação fundamentada no limite institucional preliminar e nos insumos consolidados da análise.";

                return (
                  <article className="h-full w-full">
                    <div className="flex h-full items-stretch gap-3 rounded-[20px] border border-[#d7e3f2] bg-[linear-gradient(180deg,#ffffff_0%,#f9fbff_100%)] px-4 py-3.5 shadow-[0_5px_12px_rgba(10,29,64,.035)]">
                      <div className="w-[2px] rounded-full bg-[linear-gradient(180deg,rgba(74,119,179,.82)_0%,rgba(133,161,198,.42)_100%)] shadow-[0_0_8px_rgba(77,122,184,.20)]" />
                      <div className="flex min-w-0 flex-1 flex-col justify-between">
                        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#5a6f89]">Decisão Executiva</p>
                        <p className={`mt-1.5 text-[10px] font-semibold uppercase tracking-[0.13em] ${recommendationToneClass}`}>Recomendação final</p>
                        <p className="mt-2 text-[22px] font-black leading-[1.2] tracking-[-0.012em] text-[#0f2747]">
                          {recommendationLabel} <span className="font-semibold text-[#33506f]">·</span> <span className="text-[#0b2f5c]">Limite recomendado: {formatCurrencyBRLCompactExecutive(recommended)}</span>
                        </p>
                        <p className="mt-2 text-[12px] leading-[1.5] text-[#4f647a]">
                          <span className="font-semibold text-[#334155]">Solicitado:</span> <span className="font-semibold text-[#0f2747]">{requested > 0 ? formatCurrencyBRLCompactExecutive(requested) : "—"}</span>
                          {" · "}
                          <span className="font-semibold text-[#334155]">COFACE:</span> <span className="font-semibold text-[#0f2747]">{technicalCoverageValue !== null ? formatCurrencyBRLCompactExecutive(technicalCoverageValue) : "—"}</span>
                          {" · "}
                          <span className="font-semibold text-[#334155]">Exposição residual:</span> <span className="font-semibold text-[#0f2747]">{formatCurrencyBRLCompactExecutive(exposureResidual)}</span>
                        </p>
                        <p className="mt-2 text-[12px] leading-[1.55] text-[#2f4157]">
                          <span className="font-semibold text-[#334155]">Justificativa:</span> {executiveRationale}
                        </p>
                      </div>
                    </div>
                  </article>
                );
              })()}
            </div>
            <article className="rounded-[22px] border border-[#dfe8f2] bg-[linear-gradient(180deg,#ffffff_0%,#f9fbff_100%)] p-5 shadow-[0_8px_20px_rgba(10,29,64,.045)]">
              <p className="text-[18px] font-semibold tracking-[-0.01em] text-[#0f172a]">Parecer técnico do analista</p>
              {analysis.comment.trim() ? (
                <div className="mt-3 min-h-[120px] rounded-[14px] border border-[#e3ebf5] bg-[linear-gradient(180deg,#fcfdff_0%,#f6faff_100%)] px-4 py-3.5 text-[13px] leading-[1.82] tracking-[0.002em] text-[#22384f]">{analysis.comment.trim()}</div>
              ) : (
                <div className="mt-3 min-h-[120px] rounded-[14px] border border-[#e3ebf5] bg-[linear-gradient(180deg,#fbfdff_0%,#f7faff_100%)] px-4 py-3.5 text-[#41556f]">
                  <div>
                    <p className="text-[13px] font-semibold tracking-[0.002em] text-[#1f344d]">Parecer técnico ainda não registrado.</p>
                    <p className="mt-1 text-[12px] leading-[1.7] text-[#5b7089]">O analista poderá consolidar observações adicionais antes do envio para aprovação.</p>
                  </div>
                </div>
              )}
            </article>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.68fr)_minmax(320px,0.78fr)]">
            <article className="rounded-[22px] border border-[#e1e9f3] bg-white p-5 shadow-[0_10px_22px_rgba(10,29,64,.052)]">
              <p className="text-[18px] font-semibold tracking-[-0.01em] text-[#0f172a]">Score institucional preliminar</p>
              <p className="mt-1 text-[12px] text-[#64748b]">Score absoluto ponderado pelos pilares da política institucional de crédito.</p>
              <div className="mt-4 grid gap-4 lg:grid-cols-[220px_1fr]">
                <InstitutionalScoreGauge score={institutionalScore} />
                <div className="space-y-3">
                  {institutionalScoreBreakdown.map((item) => (
                    <div key={item.key}>
                      <div className="mb-1 flex items-center justify-between text-[12px] font-semibold text-[#334155]">
                        <span className="inline-flex items-center gap-2">
                          <span>{item.title}</span>
                          {item.key === "financial_liquidity" && hasValidCofaceCoverage ? <span className="inline-flex rounded-full border border-[#BFDBFE] bg-[#EFF6FF] px-2 py-0.5 text-[10px] font-semibold text-[#1D4ED8]">Mitigado por COFACE</span> : null}
                          {item.key === "market_conditions" && item.score === 0 ? <span className="inline-flex rounded-full border border-[#E2E8F0] bg-[#F8FAFC] px-2 py-0.5 text-[10px] font-semibold text-[#64748b]">Em evolução</span> : null}
                        </span>
                        <span>{item.score.toFixed(1)}/10</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full border border-[#E2E8F0] bg-[#F1F5F9]"><div className={`h-full rounded-full ${item.key === "financial_liquidity" ? "bg-[#94a3b8]" : "bg-[#2563eb]"}`} style={{ width: `${Math.max(0, Math.min(100, item.score * 10))}%` }} /></div>
                    </div>
                  ))}
                </div>
              </div>
            </article>
            <article className="rounded-[22px] border border-[#dfe8f2] bg-[linear-gradient(180deg,#ffffff_0%,#f9fbff_100%)] p-5 shadow-[0_9px_20px_rgba(10,29,64,.045)]">
              <p className="text-[18px] font-semibold tracking-[-0.01em] text-[#0f172a]">Trilha da solicitação</p>
              <p className="mt-1 text-[12px] leading-[1.55] text-[#6a7d93]">Fluxo consolidado para aprovação institucional.</p>
              <div className="relative mt-4">
                <div className="pointer-events-none absolute bottom-2 top-2 left-[18px] w-[1.5px] rounded-full bg-[linear-gradient(180deg,rgba(143,164,189,0.14)_0%,rgba(118,143,174,0.45)_48%,rgba(143,164,189,0.14)_100%)]" />
                {[
                  ["✓", "Solicitação criada", "Cliente identificado e limite comercial informado."],
                  ["✓", "Coleta de informações", "Dados internos, documentos e bureaus consolidados."],
                  ["✓", "Mesa de análise", "Score, explicabilidade e parecer técnico consolidados."],
                  ["4", "Revisão e envio", "Perfil corporativo revisado para submissão."],
                  ["5", "Envio para aprovação", "Pronto para encaminhamento à alçada aprovadora."]
                ].map(([mark, title, description]) => (
                  <div key={title} className="relative mb-5 grid grid-cols-[36px_minmax(0,1fr)] items-start gap-3 last:mb-0">
                    <div className="relative z-10 flex w-9 shrink-0 justify-center">
                      <div className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-semibold ${
                      mark === "✓"
                        ? "border border-[#9cc8b0] bg-[linear-gradient(180deg,#5a9b78_0%,#4a8868_100%)] text-white shadow-[0_2px_8px_rgba(74,136,104,0.20)]"
                        : mark === "4"
                          ? "border border-[#7ea6d8] bg-[linear-gradient(180deg,#3f6fa7_0%,#335f91_100%)] text-white shadow-[0_2px_8px_rgba(51,95,145,0.20)]"
                          : "border border-[#c7d4e3] bg-[#edf3f9] text-[#7f95ac]"
                      }`}>{mark === "4" ? "›" : mark}</div>
                    </div>
                    <div className="min-w-0 pt-[1px]">
                      <p className={`text-[12.5px] font-semibold leading-[1.35] tracking-[0.006em] ${
                        mark === "4" ? "text-[#0f2747]" : mark === "✓" ? "text-[#13243a]" : "text-[#445a73]"
                      }`}>{title}</p>
                      <p className={`mt-1 text-[11px] leading-[1.65] ${
                        mark === "4" ? "text-[#607a97]" : mark === "✓" ? "text-[#6f8398]" : "text-[#90a2b5]"
                      }`}>{description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </article>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.68fr)_minmax(320px,0.78fr)]">
            <div className="space-y-4">
              <article className={`rounded-[22px] border border-[#e1e9f3] p-5 shadow-[0_10px_22px_rgba(10,29,64,.052)] ${executiveNarrativeCardClass}`}>
                <p className="text-[18px] font-semibold tracking-[-0.01em] text-[#0f172a]">Explicação da análise</p>
                <p className="mt-1 text-[12px] text-[#64748b]">Leitura executiva da lógica aplicada à recomendação.</p>
                <p className="mt-3.5 w-full text-[13px] leading-[1.82] tracking-[0.002em] text-[#334155]">{executiveNarrative.summary}</p>
              </article>
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
                    const agriskFileName = agriskImport.files[0]?.original_filename ?? null;
                    const cofaceDocument = cofaceFileName ? step1LibraryDocuments.find((doc) => doc.original_filename === cofaceFileName) : null;
                    const agriskDocument = agriskFileName ? step1LibraryDocuments.find((doc) => doc.original_filename === agriskFileName) : null;
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
            <aside className="space-y-4">
              <article className="flex min-h-[214px] self-start flex-col rounded-[22px] border border-[#e5edf6] bg-[linear-gradient(180deg,#ffffff_0%,#f9fbff_100%)] px-5 py-5 shadow-[0_6px_14px_rgba(10,29,64,.04)]">
                <div>
                  <p className="text-[17px] font-semibold tracking-[-0.01em] text-[#0f172a]">Resumo financeiro da carteira</p>
                  <p className="mt-1 text-[12px] leading-[1.55] text-[#70859b]">Composição da posição interna atual.</p>
                </div>
                {hasInternalFinancialSnapshot ? (
                  (() => {
                    const openAmount = mappedInternalOpenAmount;
                    const notDueAmount = mappedInternalNotDue;
                    const overdueAmount = mappedInternalOverdue;
                    const hasOpenBase = openAmount !== null && openAmount > 0;
                    const notDuePercent = hasOpenBase && notDueAmount !== null ? Math.max(0, Math.min(100, Math.round((notDueAmount / openAmount) * 100))) : null;
                    const overduePercent = hasOpenBase && overdueAmount !== null ? Math.max(0, Math.min(100, Math.round((overdueAmount / openAmount) * 100))) : null;
                    const notDueBar = notDuePercent ?? 0;
                    const overdueBar = overduePercent ?? 0;

                    return (
                      <div className="mt-4 flex w-full flex-1 flex-col">
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6a7d93]">Valor em Aberto</p>
                          <p className="mt-1.5 text-[27px] font-black leading-[1.04] tracking-[-0.02em] text-[#0f2747]">{openAmount !== null ? formatCurrencyBRLCompactExecutive(openAmount) : "—"}</p>
                        </div>
                        <div className="mt-4 space-y-1.5 text-[12px] leading-[1.55]">
                          <p className="text-[#5f7288]"><span className="font-medium text-[#3c4f64]">Not Due:</span> <span className="font-semibold text-[#0f2747]">{notDueAmount !== null ? formatCurrencyBRLCompactExecutive(notDueAmount) : "—"}</span> <span className="text-[#73879d]">· {notDuePercent !== null ? `${notDuePercent}%` : "—"}</span></p>
                          <p className="text-[#5f7288]"><span className="font-medium text-[#3c4f64]">Overdue:</span> <span className="font-semibold text-[#0f2747]">{overdueAmount !== null ? formatCurrencyBRLCompactExecutive(overdueAmount) : "—"}</span> <span className="text-[#73879d]">· {overduePercent !== null ? `${overduePercent}%` : "—"}</span></p>
                        </div>
                        <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full border border-[#e2eaf4] bg-[#eff4fa]">
                          <div className="flex h-full w-full">
                            <div className="h-full bg-[linear-gradient(180deg,#879eb9_0%,#7890ab_100%)]" style={{ width: `${notDueBar}%` }} />
                            <div className="h-full bg-[linear-gradient(180deg,#d8abab_0%,#c89797_100%)]" style={{ width: `${overdueBar}%` }} />
                          </div>
                        </div>
                      </div>
                    );
                  })()
                ) : (
                  <p className="mt-4 text-[12px] leading-[1.6] text-[#6a7d93]">Cliente sem histórico financeiro interno identificado na carteira atual.</p>
                )}
              </article>
            </aside>
          </div>
          {submitMutation.isError ? <p className="mt-3 text-[12px] text-[#b91c1c]">{submitMutation.error.message}</p> : null}
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
              Avançar · Mesa de análise <ChevronRight className="ml-1 h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ) : step === 3 ?(
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
              onClick={() => navigateToStep(4)}
              disabled={!canContinue}
              className="rounded-[8px] bg-[#0b1f3a] px-6 py-2 text-[12px] font-medium text-white disabled:cursor-not-allowed disabled:bg-[#D7E1EC] disabled:text-[#8FA3B4]"
            >
              Avançar para revisão
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
              {submitMutation.isPending ?"Enviando..." : "Enviar para aprovação"}
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
              {submitMutation.isPending ?"Enviando..." : "Enviar para aprovação"}
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






