import { toNumber } from "@/features/credit-analyses/utils/formatters";

const integerFormatter = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2
});

const thousandFormatter = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1
});

export function formatCurrencyInThousands(value: number | string | null | undefined): string {
  const parsed = toNumber(value);
  if (parsed === null) {
    return "Não informado";
  }

  const absoluteValue = Math.abs(parsed);
  if (absoluteValue < 1000) {
    return `R$ ${integerFormatter.format(parsed)}`;
  }

  const sign = parsed < 0 ? "-" : "";
  const valueInThousands = absoluteValue / 1000;

  return `${sign}R$ ${thousandFormatter.format(valueInThousands)} mil`;
}
