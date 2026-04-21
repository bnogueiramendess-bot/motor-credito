import { ExternalDataDashboardApiResponse, ExternalDataEntryDashboardDto } from "@/features/external-data/api/contracts";
import { toNumber } from "@/features/credit-analyses/utils/formatters";

export type SourceStatus = "completed" | "failed" | "no_return";

export type SourceViewModel = ExternalDataEntryDashboardDto & {
  status: SourceStatus;
  hasPartialData: boolean;
};

export type ExternalDataKpi = {
  id: string;
  label: string;
  value: string;
  helper: string;
};

export type ExternalDataFinding = {
  id: string;
  title: string;
  description: string;
  tone: "danger" | "warning" | "info";
};

function hasNoBusinessReturn(entry: ExternalDataEntryDashboardDto): boolean {
  const score = toNumber(entry.source_score);
  const protestsAmount = toNumber(entry.protests_amount) ?? 0;
  const lawsuitsAmount = toNumber(entry.lawsuits_amount) ?? 0;
  const declaredRevenue = toNumber(entry.declared_revenue);
  const declaredIndebtedness = toNumber(entry.declared_indebtedness);

  return (
    score === null &&
    !entry.source_rating &&
    !entry.has_restrictions &&
    entry.protests_count === 0 &&
    protestsAmount === 0 &&
    entry.lawsuits_count === 0 &&
    lawsuitsAmount === 0 &&
    entry.bounced_checks_count === 0 &&
    declaredRevenue === null &&
    declaredIndebtedness === null &&
    !entry.notes &&
    entry.files.length === 0
  );
}

function hasPartialData(entry: ExternalDataEntryDashboardDto): boolean {
  if (entry.detail_fetch_status === "failed") {
    return false;
  }

  return entry.report_date === null || entry.source_score === null || entry.source_rating === null;
}

export function resolveSourceStatus(entry: ExternalDataEntryDashboardDto): SourceStatus {
  if (entry.detail_fetch_status === "failed") {
    return "failed";
  }

  if (hasNoBusinessReturn(entry)) {
    return "no_return";
  }

  return "completed";
}

export function mapSources(entries: ExternalDataEntryDashboardDto[]): SourceViewModel[] {
  return entries.map((entry) => ({
    ...entry,
    status: resolveSourceStatus(entry),
    hasPartialData: hasPartialData(entry)
  }));
}

export function buildKpis(sources: SourceViewModel[]): ExternalDataKpi[] {
  const total = sources.length;
  const completed = sources.filter((source) => source.status === "completed").length;
  const failed = sources.filter((source) => source.status === "failed").length;
  const noReturn = sources.filter((source) => source.status === "no_return").length;
  const restricted = sources.filter((source) => source.has_restrictions).length;
  const withFiles = sources.filter((source) => source.files.length > 0).length;

  return [
    {
      id: "total",
      label: "Fontes Consultadas",
      value: String(total),
      helper: `${completed} com retorno`
    },
    {
      id: "restrictions",
      label: "Fontes com Restricoes",
      value: String(restricted),
      helper: `${noReturn} sem retorno`
    },
    {
      id: "attachments",
      label: "Registros com Arquivos",
      value: String(withFiles),
      helper: `${failed} com falha de detalhamento`
    }
  ];
}

export function buildFindings(sources: SourceViewModel[]): ExternalDataFinding[] {
  const findings: ExternalDataFinding[] = [];

  sources.forEach((source) => {
    if (source.status === "failed") {
      findings.push({
        id: `failed-${source.id}`,
        title: "Falha no detalhamento da fonte",
        description: `Entrada ${source.id} nao teve detalhes carregados: ${source.detail_fetch_error ?? "erro nao informado"}.`,
        tone: "danger"
      });
    }

    if (source.status === "no_return") {
      findings.push({
        id: `no-return-${source.id}`,
        title: "Fonte sem retorno de dados",
        description: `Entrada ${source.id} nao trouxe indicadores numericos, notas ou arquivos.`,
        tone: "warning"
      });
    }

    if (source.has_restrictions) {
      findings.push({
        id: `restriction-${source.id}`,
        title: "Fonte com restricoes ativas",
        description: `Entrada ${source.id} sinalizou restricoes, com ${source.protests_count} protesto(s), ${source.lawsuits_count} acao(oes) e ${source.bounced_checks_count} cheque(s) sem fundo.`,
        tone: "warning"
      });
    }
  });

  if (!findings.length) {
    findings.push({
      id: "no-findings",
      title: "Sem achados relevantes no retorno atual",
      description: "Nao ha falhas de consulta nem indicadores de restricao nas fontes carregadas.",
      tone: "info"
    });
  }

  return findings.slice(0, 8);
}

export function countPartialDataSources(sources: SourceViewModel[]): number {
  return sources.filter((source) => source.hasPartialData).length;
}

export function mapExternalDataDashboard(data: ExternalDataDashboardApiResponse) {
  const sources = mapSources(data.entries);

  return {
    analysis: data.analysis,
    customer: data.customer,
    events: data.events,
    sources,
    kpis: buildKpis(sources),
    findings: buildFindings(sources),
    partialDataCount: countPartialDataSources(sources)
  };
}
