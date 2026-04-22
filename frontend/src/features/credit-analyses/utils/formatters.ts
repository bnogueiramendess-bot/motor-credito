const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL"
});

const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short"
});

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short"
});

export function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatCurrency(value: number | string | null | undefined): string {
  const parsed = toNumber(value);
  if (parsed === null) {
    return "Não informado";
  }
  return currencyFormatter.format(parsed);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "Não informado";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Não informado";
  }
  return dateTimeFormatter.format(date);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "Não informado";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Não informado";
  }
  return dateFormatter.format(date);
}
