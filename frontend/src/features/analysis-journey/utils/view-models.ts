type ManualState = {
  enabled: boolean;
  negativationsCount: string;
  negativationsAmount: string;
  protestsCount: string;
  protestsAmount: string;
  activeLawsuits: boolean;
  observations: string;
  comments: string;
  hasCommercialHistory: boolean;
  commercialHistoryRevenue: string;
  contractualAvgTermDays: string;
  effectiveAvgTermDays: string;
};

type FileBlockState = {
  enabled: boolean;
  files: unknown[];
};

export function formatCurrencyBRL(value: string) {
  const parsed = Number(value.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(parsed)) return "R$ 0,00";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(parsed);
}

export function resolveUploadStatus(block: FileBlockState) {
  if (!block.enabled) return "não selecionado";
  if (block.files.length === 0) return "selecionado / não enviado";
  return "enviado";
}

export function resolveManualStatus(manual: ManualState) {
  if (!manual.enabled) return "não preenchido";
  const hasMainData =
    Number(manual.negativationsCount || 0) > 0 ||
    Number(manual.negativationsAmount || 0) > 0 ||
    Number(manual.protestsCount || 0) > 0 ||
    Number(manual.protestsAmount || 0) > 0 ||
    manual.activeLawsuits;
  const hasText = Boolean(manual.observations.trim() || manual.comments.trim());
  const hasHistory =
    manual.hasCommercialHistory &&
    Boolean(
      manual.commercialHistoryRevenue.trim() ||
        manual.contractualAvgTermDays.trim() ||
        manual.effectiveAvgTermDays.trim()
    );
  return hasMainData || hasText || hasHistory ? "preenchido" : "não preenchido";
}
