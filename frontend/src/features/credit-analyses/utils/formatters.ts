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
    return "Nao informado";
  }
  return currencyFormatter.format(parsed);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "Nao informado";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Nao informado";
  }
  return dateTimeFormatter.format(date);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "Nao informado";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Nao informado";
  }
  return dateFormatter.format(date);
}
