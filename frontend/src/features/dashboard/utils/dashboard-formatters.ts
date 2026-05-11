import { toNumber } from "@/features/credit-analyses/utils/formatters";

const thousandFormatter = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1
});

export function formatCurrencyInThousands(value: number | string | null | undefined): string {
  const parsed = toNumber(value);
  if (parsed === null) {
    return "Não informado";
  }

  const absoluteValue = Math.abs(parsed);
  const sign = parsed < 0 ? "-" : "";
  if (absoluteValue < 1000) {
    const valueInThousands = absoluteValue / 1000;
    return `${sign}R$ ${thousandFormatter.format(valueInThousands)} k`;
  }

  if (absoluteValue >= 1_000_000) {
    const valueInMillions = absoluteValue / 1_000_000;
    return `${sign}R$ ${thousandFormatter.format(valueInMillions)} MM`;
  }

  const valueInThousands = absoluteValue / 1000;
  return `${sign}R$ ${thousandFormatter.format(valueInThousands)} k`;
}
