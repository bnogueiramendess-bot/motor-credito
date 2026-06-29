"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardList, Loader2, ShieldAlert, X } from "lucide-react";

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
  group: "Dados Operacionais" | "Dados Mestres" | "Administracao" | "Politica de Credito";
  title: string;
  description: string;
};

const RESET_CONFIRM_TEXT = "RESET_OPERATIONAL_DATA";

const DOMAIN_OPTIONS: ResetDomainOption[] = [
  {
    key: "credit_analysis",
    group: "Dados Operacionais",
    title: "Analises de Credito",
    description: "Remove analises, score, decisoes, eventos, historico, workspace e memorias da analise."
  },
  {
    key: "approval_workflow",
    group: "Dados Operacionais",
    title: "Workflow de Aprovacao",
    description: "Remove todo o fluxo sequencial de aprovacao das analises."
  },
  {
    key: "customers",
    group: "Dados Mestres",
    title: "Clientes",
    description: "Remove cadastros operacionais de clientes e memorias de reaproveitamento."
  },
  {
    key: "portfolio_ar",
    group: "Dados Mestres",
    title: "Carteira / AR",
    description: "Remove importacoes AR, snapshots financeiros, grupos economicos e historico da carteira."
  },
  {
    key: "external_reports",
    group: "Dados Mestres",
    title: "Relatorios Externos",
    description: "Remove leituras, uploads e enriquecimentos externos, como COFACE e AgRisk."
  },
  {
    key: "operational_users",
    group: "Administracao",
    title: "Usuarios Operacionais",
    description: "Remove usuarios, convites, sessoes e vinculos operacionais. O acesso Master/Admin sera preservado ou recriado."
  },
  {
    key: "workflow_roles",
    group: "Administracao",
    title: "Papeis do Workflow",
    description: "Remove papeis operacionais e vinculos de usuarios do workflow."
  },
  {
    key: "approval_matrix",
    group: "Administracao",
    title: "Matriz DOA",
    description: "Remove matriz de alcadas e regras de aprovacao de credito."
  },
  {
    key: "companies_permissions",
    group: "Administracao",
    title: "Empresas e Permissoes",
    description: "Remove empresas, perfis e permissoes operacionais. A estrutura minima de acesso Master/Admin sera recriada quando necessario."
  },
  {
    key: "configurable_policy",
    group: "Politica de Credito",
    title: "Politica Configuravel",
    description: "Remove todas as versoes da Politica Configuravel e sua estrutura normalizada."
  },
  {
    key: "policy_governance",
    group: "Politica de Credito",
    title: "Governanca da Politica",
    description: "Remove solicitacoes, aprovacoes e historico de governanca da Politica Configuravel."
  },
  {
    key: "legacy_policies",
    group: "Politica de Credito",
    title: "Politicas Legadas",
    description: "Remove politicas e regras legadas do motor de credito."
  }
];

const DOMAIN_GROUPS = ["Dados Operacionais", "Dados Mestres", "Administracao", "Politica de Credito"] as const;
const ALL_DOMAIN_KEYS = DOMAIN_OPTIONS.map((domain) => domain.key);

function mapFriendlyError(error: unknown) {
  if (!(error instanceof ApiError)) {
    return "Falha inesperada ao executar a limpeza operacional. Tente novamente.";
  }
  if (error.status === 400) {
    return "A confirmacao informada e invalida ou os dominios selecionados nao sao aceitos.";
  }
  if (error.status === 401) {
    return "Sua sessao expirou. Faca login novamente para continuar.";
  }
  if (error.status === 403) {
    return "Operacao nao permitida para este usuario ou bloqueada no ambiente atual.";
  }
  if (error.status >= 500) {
    return "Nao foi possivel concluir a limpeza operacional neste momento. Tente novamente.";
  }
  return error.message;
}

function resetSummaryLabel(status: string | undefined) {
  if (status === "recreated") return "Master/Admin recriado";
  return "Master/Admin preservado";
}

function formatCount(value: number) {
  return value.toLocaleString("pt-BR");
}

export function OperationalResetDialog({ open, onOpenChange, onSuccess }: OperationalResetDialogProps) {
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedDomains, setSelectedDomains] = useState<Set<ResetDomainKey>>(new Set());
  const [confirmInput, setConfirmInput] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [previewResult, setPreviewResult] = useState<ResetOperationalDataResponse | null>(null);
  const [result, setResult] = useState<ResetOperationalDataResponse | null>(null);

  const allSelected = selectedDomains.size === DOMAIN_OPTIONS.length;
  const hasDomainSelection = selectedDomains.size > 0;
  const isConfirmationValid = confirmInput.trim() === RESET_CONFIRM_TEXT;
  const canPreview = hasDomainSelection && isConfirmationValid && !isPreviewLoading && !isSubmitting;
  const canSubmit = Boolean(previewResult) && isConfirmationValid && !isPreviewLoading && !isSubmitting;

  const resolvedDomains = useMemo(() => Array.from(selectedDomains), [selectedDomains]);

  function clearFeedback() {
    setPreviewResult(null);
    setResult(null);
    setErrorMessage(null);
  }

  function handleToggleDomain(key: ResetDomainKey) {
    clearFeedback();
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
    clearFeedback();
    setSelectedDomains(checked ? new Set(ALL_DOMAIN_KEYS) : new Set());
  }

  function handleConfirmChange(value: string) {
    setConfirmInput(value);
    setPreviewResult(null);
    setResult(null);
    setErrorMessage(null);
  }

  function handleClose() {
    if (isSubmitting || isPreviewLoading) return;
    onOpenChange(false);
  }

  async function handlePreview() {
    if (!canPreview) return;
    setIsPreviewLoading(true);
    setErrorMessage(null);
    setResult(null);
    try {
      const response = await resetOperationalData(RESET_CONFIRM_TEXT, resolvedDomains, true);
      setPreviewResult(response);
    } catch (error) {
      setErrorMessage(mapFriendlyError(error));
    } finally {
      setIsPreviewLoading(false);
    }
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    setIsSubmitting(true);
    setErrorMessage(null);
    setResult(null);
    try {
      const response = await resetOperationalData(RESET_CONFIRM_TEXT, resolvedDomains, false);
      setResult(response);
      setPreviewResult(null);
      onSuccess?.();
    } catch (error) {
      setErrorMessage(mapFriendlyError(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!open) return null;

  const activeResult = result ?? previewResult;
  const hasCoverageWarnings = Boolean(
    (activeResult?.coverage?.missing_in_registry?.length ?? 0) > 0 || (activeResult?.coverage?.unknown_in_registry?.length ?? 0) > 0
  );

  return (
    <>
      <div className="fixed inset-0 z-[80] bg-[#020617]/55" onClick={handleClose} />
      <div className="fixed inset-0 z-[81] flex items-center justify-center p-4">
        <section className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-[0_22px_60px_rgba(2,6,23,0.28)]">
          <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">Reset Operacional</h2>
              <p className="mt-1 text-sm text-slate-600">
                Utilize esta ferramenta apenas em ambientes de desenvolvimento e homologacao para reinicializar parcial ou totalmente os dados operacionais do Motor de Credito.
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

          <div className="flex flex-col gap-5 px-6 py-6">
            <section className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-4 text-sm text-amber-950">
              <p className="font-semibold">Estruturas preservadas</p>
              <p className="mt-1">A limpeza remove apenas dados operacionais. A estrutura tecnica do sistema permanece preservada.</p>
              <ul className="mt-3 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                <li>• Estrutura do banco</li>
                <li>• Migrations</li>
                <li>• Seeds</li>
                <li>• Configuracoes do sistema</li>
                <li>• Usuario Master</li>
                <li>• Estrutura tecnica da aplicacao</li>
              </ul>
            </section>

            <article className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(event) => handleToggleTotal(event.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-slate-300"
                />
                <span>
                  <span className="block text-base font-semibold text-slate-900">Reset total operacional</span>
                  <span className="mt-1 block text-sm text-slate-600">
                    Seleciona automaticamente todos os dominios atuais: analises, workflow, clientes, AR, relatorios, usuarios, roles, DOA, empresas, politica configuravel, governanca e politicas legadas.
                  </span>
                </span>
              </label>
            </article>

            <div className="grid gap-4 lg:grid-cols-2">
              {DOMAIN_GROUPS.map((group) => (
                <section key={group} className="rounded-xl border border-slate-200 bg-white p-4">
                  <h3 className="text-sm font-semibold text-slate-900">{group}</h3>
                  <div className="mt-3 flex flex-col gap-2">
                    {DOMAIN_OPTIONS.filter((domain) => domain.group === group).map((domain) => {
                      const checked = selectedDomains.has(domain.key);
                      return (
                        <label
                          key={domain.key}
                          className={cn(
                            "flex min-h-20 cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 transition",
                            checked ? "border-slate-500 bg-slate-50" : "border-slate-200 bg-white hover:border-slate-300"
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => handleToggleDomain(domain.key)}
                            className="mt-1 h-4 w-4 rounded border-slate-300"
                          />
                          <span>
                            <span className="block text-sm font-semibold text-slate-900">{domain.title}</span>
                            <span className="mt-1 block text-sm leading-5 text-slate-600">{domain.description}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>

            <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
              <label className="mb-2 block text-sm font-semibold text-slate-900">Confirmacao obrigatoria</label>
              <p className="mb-2 text-xs text-slate-600">
                Digite exatamente <span className="font-semibold">{RESET_CONFIRM_TEXT}</span> para habilitar a previa e a execucao.
              </p>
              <input
                value={confirmInput}
                onChange={(event) => handleConfirmChange(event.target.value)}
                className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-slate-500"
                placeholder={RESET_CONFIRM_TEXT}
              />
            </div>

            {errorMessage ? (
              <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <p>{errorMessage}</p>
              </div>
            ) : null}

            {previewResult ? (
              <section className="rounded-xl border border-slate-300 bg-slate-50/80 px-4 py-4">
                <div className="flex items-center gap-2 text-slate-900">
                  <ClipboardList className="h-4 w-4" />
                  <p className="text-sm font-semibold">Previa da limpeza</p>
                </div>
                <p className="mt-2 text-sm text-slate-700">Esta operacao ira remover:</p>
                {(previewResult.impact_preview ?? []).length > 0 ? (
                  <ul className="mt-3 grid gap-1 text-sm text-slate-800 sm:grid-cols-2">
                    {(previewResult.impact_preview ?? []).map((item) => (
                      <li key={`${item.table}-${item.label}`}>• {formatCount(item.count)} {item.label}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-sm text-slate-600">Nenhum registro encontrado nos dominios selecionados.</p>
                )}
              </section>
            ) : null}

            {result ? (
              <div className="flex flex-col gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-4">
                <div className="flex items-center gap-2 text-emerald-800">
                  <CheckCircle2 className="h-4 w-4" />
                  <p className="text-sm font-semibold">Limpeza operacional concluida com sucesso</p>
                </div>
                <div className="grid gap-2 text-sm text-emerald-900 md:grid-cols-2">
                  <p>Registros removidos: <strong>{formatCount(result.total_deleted)}</strong></p>
                  <p>Escopo: <strong>{result.reset_scope ?? "operational"}</strong></p>
                  <p className="md:col-span-2">
                    Dominios executados: <strong>{(result.domains ?? resolvedDomains).join(", ")}</strong>
                  </p>
                  <p className="md:col-span-2">
                    Status de acesso: <strong>{resetSummaryLabel(result.master_admin?.status)}</strong>
                  </p>
                </div>

                {hasCoverageWarnings ? (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <p>Ha divergencias de cobertura no registry de reset. Verifique logs tecnicos.</p>
                  </div>
                ) : null}

                <details className="rounded-lg border border-emerald-200 bg-white">
                  <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-slate-700">Detalhes tecnicos</summary>
                  <div className="max-h-52 overflow-y-auto border-t border-emerald-100 px-3 py-2 text-xs text-slate-700">
                    <ul className="flex flex-col gap-1">
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
              disabled={isSubmitting || isPreviewLoading}
            >
              Fechar
            </button>
            <button
              type="button"
              onClick={() => void handlePreview()}
              disabled={!canPreview}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPreviewLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {isPreviewLoading ? "Gerando previa..." : "Gerar previa"}
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
