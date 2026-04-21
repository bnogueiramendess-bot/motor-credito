export function sanitizeDigits(value: string) {
  return value.replace(/\D/g, "");
}

export function formatCnpj(value: string) {
  const digits = sanitizeDigits(value).slice(0, 14);
  if (!digits) return "";
  if (digits.length <= 2) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  if (digits.length <= 8) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`;
  if (digits.length <= 12) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8)}`;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

export function toNumberInput(value: string): number {
  const normalized = value
    .replace(/[^\d,.-]/g, "")
    .replace(/\./g, "")
    .replace(",", ".")
    .trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function toNullableNumberInput(value: string): number | null {
  if (!value.trim()) {
    return null;
  }
  const numeric = toNumberInput(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function formatCurrencyInputBRL(raw: string) {
  const digits = raw.replace(/\D/g, "");
  const cents = Number(digits || "0");
  const value = cents / 100;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}
