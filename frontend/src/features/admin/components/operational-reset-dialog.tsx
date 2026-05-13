"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, ShieldAlert, X } from "lucide-react";

import { ResetDomainKey, ResetOperationalDataResponse, resetOperationalData } from "@/features/admin/api/admin.api";
import { ApiError } from "@/shared/lib/http/http-client";
import { cn } from "@/shared/lib/utils";

type OperationalResetDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
};

type ResetDomainOption = {
  key: ResetDomainKey;
  title: string;
  description: string;
};

const RESET_CONFIRM_TEXT = "RESET_OPERATIONAL_DATA";

const DOMAIN_OPTIONS: ResetDomainOption[] = [
  {
    key: "credit_analysis",
    title: "Análises de Crédito",
    description: "Remove workflow, scores, decisões, eventos e histórico das análises."
  },
  {
    key: "external_reports",
    title: "Relatórios Externos",
    description: "Remove leituras, uploads e enriquecimentos externos, como COFACE e AgRisk. Não remove AR/Carteira."
  },
  {
    key: "portfolio_ar",
    title: "Carteira / AR",
    description: "Remove importações AR, snapshots financeiros, grupos econômicos e histórico da carteira."
  },
  {
    key: "customers",
    title: "Clientes",
    description: "Remove cadastros operacionais de clientes e memórias de reaproveitamento."
  },
  {
    key: "operational_users",
    title: "Usuários Operacionais",
    description: "Remove usuários, convites, sessões e vínculos operacionais. O acesso Master/Admin será preservado ou recriado."
  },
  {
    key: "governance",
    title: "Governança e Permissões",
    description: "Remove empresas, perfis e permissões operacionais. A estrutura mínima de acesso Master/Admin será recriada quando necessário."
  },
  {
    key: "credit_policies",
    title: "Políticas de Crédito",
    description: "Remove políticas e regras do motor de crédito."
  }
];

function mapFriendlyError(error: unknown) {
  if (!(error instanceof ApiError)) {
    return "Falha inesperada ao executar a limpeza operacional. Tente novamente.";
  }
  if (error.status === 400) {
    return "A confirmação informada é inválida ou os domínios selecionados não são aceitos.";
  }
  if (error.status === 401) {
    return "Sua sessão expirou. Faça login novamente para continuar.";
  }
  if (error.status === 403) {
    return "Operação não permitida para este usuário ou bloqueada no ambiente atual.";
  }
  if (error.status >= 500) {
    return "Não foi possível concluir a limpeza operacional neste momento. Tente novamente.";
  }
  return error.message;
}

function resetSummaryLabel(status: string | undefined) {
  if (status === "recreated") return "Master/Admin recriado";
  return "Master/Admin preservado";
}

export function OperationalResetDialog({ open, onOpenChange, onSuccess }: OperationalResetDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [totalSelected, setTotalSelected] = useState(false);
  const [selectedDomains, setSelectedDomains] = useState<Set<ResetDomainKey>>(new Set());
  const [confirmInput, setConfirmInput] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<ResetOperationalDataResponse | null>(null);

  const hasDomainSelection = totalSelected || selectedDomains.size > 0;
  const isConfirmationValid = confirmInput.trim() === RESET_CONFIRM_TEXT;
  const canSubmit = hasDomainSelection && isConfirmationValid && !isSubmitting;

  const resolvedDomains = useMemo(() => {
    if (totalSelected) return ["total_operational"];
    return Array.from(selectedDomains);
  }, [selectedDomains, totalSelected]);

  function handleToggleDomain(key: ResetDomainKey) {
    if (totalSelected) return;
    setSelectedDomains((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function handleToggleTotal(checked: boolean) {
    setTotalSelected(checked);
    setResult(null);
    setErrorMessage(null);
    if (checked) {
      setSelectedDomains(new Set());
    }
  }

  function handleClose() {
    if (isSubmitting) return;
    onOpenChange(false);
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    setIsSubmitting(true);
    setErrorMessage(null);
    setResult(null);
    try {
      const response = await resetOperationalData(RESET_CONFIRM_TEXT, resolvedDomains);
      setResult(response);
      onSuccess?.();
    } catch (error) {
      setErrorMessage(mapFriendlyError(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!open) return null;

  const hasCoverageWarnings = Boolean(
    (result?.coverage?.missing_in_registry?.length ?? 0) > 0 || (result?.coverage?.unknown_in_registry?.length ?? 0) > 0
  );

  return (
    <>
      <div className="fixed inset-0 z-[80] bg-[#020617]/55" onClick={handleClose} />
      <div className="fixed inset-0 z-[81] flex items-center justify-center p-4">
        <section className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-[0_22px_60px_rgba(2,6,23,0.28)]">
          <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">Limpeza Operacional</h2>
              <p className="mt-1 text-sm text-slate-600">
                Selecione quais domínios operacionais deseja redefinir. Esta ação remove dados de forma permanente.
              </p>
            </div>
            <button
              type="button"
              onClick={handleClose}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-600 transition hover:bg-slate-50"
              aria-label="Fechar modal"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          <div className="space-y-5 px-6 py-6">
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3 text-sm text-amber-900">
              A limpeza remove dados operacionais e memórias de reaproveitamento. A estrutura técnica do sistema será preservada.
            </div>

            <article className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={totalSelected}
                  onChange={(event) => handleToggleTotal(event.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-slate-300"
                />
                <span>
                  <span className="block text-base font-semibold text-slate-900">Reset total operacional</span>
                  <span className="mt-1 block text-sm text-slate-600">
                    Remove todos os dados operacionais, cadastros, políticas, histórico, importações e memórias do ambiente, preservando apenas a estrutura técnica e o acesso Master/Admin.
                  </span>
                </span>
              </label>
            </article>

            <div className="space-y-3">
              {DOMAIN_OPTIONS.map((domain) => {
                const checked = selectedDomains.has(domain.key);
                return (
                  <label
                    key={domain.key}
                    className={cn(
                      "flex items-start gap-3 rounded-xl border px-4 py-3 transition",
                      totalSelected ? "cursor-not-allowed border-slate-200 bg-slate-100/70 opacity-70" : "cursor-pointer border-slate-200 bg-white hover:border-slate-300"
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={totalSelected}
                      onChange={() => handleToggleDomain(domain.key)}
                      className="mt-1 h-4 w-4 rounded border-slate-300"
                    />
                    <span>
                      <span className="block text-sm font-semibold text-slate-900">{domain.title}</span>
                      <span className="mt-1 block text-sm text-slate-600">{domain.description}</span>
                    </span>
                  </label>
                );
              })}
            </div>

            <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
              <label className="mb-2 block text-sm font-semibold text-slate-900">Confirmação obrigatória</label>
              <p className="mb-2 text-xs text-slate-600">
                Digite exatamente <span className="font-semibold">{RESET_CONFIRM_TEXT}</span> para habilitar a execução.
              </p>
              <input
                value={confirmInput}
                onChange={(event) => setConfirmInput(event.target.value)}
                className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-slate-500"
                placeholder={RESET_CONFIRM_TEXT}
              />
            </div>

            {errorMessage ? (
              <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                <ShieldAlert className="mt-0.5 h-4 w-4" />
                <p>{errorMessage}</p>
              </div>
            ) : null}

            {result ? (
              <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-4">
                <div className="flex items-center gap-2 text-emerald-800">
                  <CheckCircle2 className="h-4 w-4" />
                  <p className="text-sm font-semibold">Limpeza operacional concluída com sucesso</p>
                </div>
                <div className="grid gap-2 text-sm text-emerald-900 md:grid-cols-2">
                  <p>Registros removidos: <strong>{result.total_deleted}</strong></p>
                  <p>Escopo: <strong>{result.reset_scope ?? "operational"}</strong></p>
                  <p className="md:col-span-2">
                    Domínios executados: <strong>{(result.domains ?? resolvedDomains).join(", ")}</strong>
                  </p>
                  <p className="md:col-span-2">
                    Status de acesso: <strong>{resetSummaryLabel(result.master_admin?.status)}</strong>
                  </p>
                </div>

                {hasCoverageWarnings ? (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5" />
                    <p>Há divergências de cobertura no registry de reset. Verifique logs técnicos.</p>
                  </div>
                ) : null}

                <details className="rounded-lg border border-emerald-200 bg-white">
                  <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-slate-700">Detalhes técnicos</summary>
                  <div className="max-h-52 overflow-y-auto border-t border-emerald-100 px-3 py-2 text-xs text-slate-700">
                    <ul className="space-y-1">
                      {(result.tables ?? []).map((item) => (
                        <li key={item.table}>
                          {item.table}: {item.deleted} removidos {item.sequence_reset ? "(sequence resetada)" : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                </details>
              </div>
            ) : null}
          </div>

          <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-6 py-4">
            <button
              type="button"
              onClick={handleClose}
              className="inline-flex h-10 items-center rounded-lg border border-slate-300 px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              disabled={isSubmitting}
            >
              Fechar
            </button>
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={!canSubmit}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {isSubmitting ? "Executando limpeza..." : "Executar limpeza operacional"}
            </button>
          </footer>
        </section>
      </div>
    </>
  );
}

