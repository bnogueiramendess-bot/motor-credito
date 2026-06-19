"use client";

import { FormEvent, useMemo, useState } from "react";
import { Check, CheckCircle2, Info, Lock, Pencil, PlusCircle, Shield } from "lucide-react";

import { ApprovalMatrixRuleDto, ApprovalMatrixRuleWritePayload } from "@/features/admin/api/admin.api";
import { useApprovalMatrixOptionsQuery } from "@/features/admin/hooks/use-approval-matrix-options-query";
import { useApprovalMatrixNextCodeQuery } from "@/features/admin/hooks/use-approval-matrix-next-code-query";
import { useApprovalMatrixQuery } from "@/features/admin/hooks/use-approval-matrix-query";
import { useCreateApprovalMatrixRuleMutation } from "@/features/admin/hooks/use-create-approval-matrix-rule-mutation";
import { useUpdateApprovalMatrixRuleMutation } from "@/features/admin/hooks/use-update-approval-matrix-rule-mutation";
import { ApiError } from "@/shared/lib/http/http-client";
import { cn } from "@/shared/lib/utils";

function formatAmount(value: string | null, currency: string) {
  if (!value) return "Sem limite";
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return value;
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(parsed);
}

function formatRange(rule: ApprovalMatrixRuleDto) {
  if (rule.min_amount && rule.max_amount) return `${formatAmount(rule.min_amount, rule.currency)} até ${formatAmount(rule.max_amount, rule.currency)}`;
  if (rule.min_amount && !rule.max_amount) return `Acima de ${formatAmount(rule.min_amount, rule.currency)}`;
  if (!rule.min_amount && rule.max_amount) return `Até ${formatAmount(rule.max_amount, rule.currency)}`;
  return "Faixa não limitada";
}

function normalizeWorkflowRoleType(value: string | null | undefined): "operational" | "governance" | "approval" | null {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "operational" || normalized === "governance" || normalized === "approval") return normalized;
  return null;
}

type HelpTipProps = {
  text: string;
};

function HelpTip({ text }: HelpTipProps) {
  return (
    <span className="group relative inline-flex">
      <span className="inline-flex h-4.5 w-4.5 cursor-help items-center justify-center rounded-full border border-slate-300 text-slate-500 transition-colors duration-150 group-hover:border-slate-400 group-hover:text-slate-700">
        <Info className="h-3 w-3" />
      </span>
      <span className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-20 w-64 -translate-x-1/2 rounded-lg bg-slate-900 px-3 py-2 text-[11px] font-medium leading-4 text-slate-100 opacity-0 shadow-xl ring-1 ring-slate-700/60 transition duration-200 group-hover:opacity-100">
        {text}
      </span>
    </span>
  );
}

type FieldLabelProps = {
  title: string;
  helpText?: string;
};

function FieldLabel({ title, helpText }: FieldLabelProps) {
  return (
    <label className="mb-1.5 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-slate-600">
      {title}
      {helpText ? <HelpTip text={helpText} /> : null}
    </label>
  );
}

export function AdminApprovalMatrixPageView() {
  const rulesQuery = useApprovalMatrixQuery();
  const optionsQuery = useApprovalMatrixOptionsQuery();
  const nextCodeQuery = useApprovalMatrixNextCodeQuery();
  const createMutation = useCreateApprovalMatrixRuleMutation();
  const updateMutation = useUpdateApprovalMatrixRuleMutation();

  const [openEditor, setOpenEditor] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [requiredApprovals, setRequiredApprovals] = useState(1);
  const [requiresCommittee, setRequiresCommittee] = useState(false);
  const [requiresUnanimous, setRequiresUnanimous] = useState(false);
  const [businessUnitId, setBusinessUnitId] = useState<number | null>(null);
  const [priority, setPriority] = useState(100);
  const [selectedRoleCodes, setSelectedRoleCodes] = useState<string[]>([]);

  const rules = rulesQuery.data ?? [];
  const businessUnits = optionsQuery.data?.business_units ?? [];

  const groupedRoles = useMemo(() => {
    const base = { operational: [], governance: [], approval: [] } as {
      operational: Array<{ id: number; code: string; name: string; type: string; is_active?: boolean }>;
      governance: Array<{ id: number; code: string; name: string; type: string; is_active?: boolean }>;
      approval: Array<{ id: number; code: string; name: string; type: string; is_active?: boolean }>;
    };
    for (const role of optionsQuery.data?.workflow_roles ?? []) {
      const normalizedType = normalizeWorkflowRoleType(role.type);
      const isActive = role.is_active ?? true;
      if (!normalizedType || !isActive) continue;
      base[normalizedType].push(role);
    }
    return base;
  }, [optionsQuery.data?.workflow_roles]);

  const totalAvailableRoles = groupedRoles.governance.length;

  function resetForm() {
    setEditingRuleId(null);
    setCode("");
    setName("");
    setDescription("");
    setIsActive(true);
    setMinAmount("");
    setMaxAmount("");
    setRequiredApprovals(1);
    setRequiresCommittee(false);
    setRequiresUnanimous(false);
    setBusinessUnitId(null);
    setPriority(100);
    setSelectedRoleCodes([]);
  }

  async function openCreate() {
    resetForm();
    const nextCode = nextCodeQuery.data?.code ?? (await nextCodeQuery.refetch()).data?.code ?? "";
    setCode(nextCode);
    setOpenEditor(true);
  }

  function openEdit(rule: ApprovalMatrixRuleDto) {
    setEditingRuleId(rule.id);
    setCode(rule.code);
    setName(rule.name);
    setDescription(rule.description ?? "");
    setIsActive(rule.is_active);
    setMinAmount(rule.min_amount ?? "");
    setMaxAmount(rule.max_amount ?? "");
    setRequiredApprovals(rule.required_approvals);
    setRequiresCommittee(rule.requires_committee);
    setRequiresUnanimous(rule.requires_unanimous);
    setBusinessUnitId(rule.business_unit_id);
    setPriority(rule.priority);
    setSelectedRoleCodes(rule.roles.map((item) => item.workflow_role_code));
    setOpenEditor(true);
  }

  function toggleRole(codeValue: string) {
    setSelectedRoleCodes((current) =>
      current.includes(codeValue) ? current.filter((item) => item !== codeValue) : [...current, codeValue]
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    const payload: ApprovalMatrixRuleWritePayload = {
      code,
      name,
      description: description.trim() || null,
      is_active: isActive,
      min_amount: minAmount.trim() || null,
      max_amount: maxAmount.trim() || null,
      currency: "BRL",
      required_approvals: requiredApprovals,
      requires_committee: requiresCommittee,
      requires_unanimous: requiresUnanimous,
      business_unit_id: businessUnitId,
      priority,
      workflow_role_codes: selectedRoleCodes
    };
    try {
      if (editingRuleId === null) {
        await createMutation.mutateAsync(payload);
        setFeedback("Regra criada com sucesso.");
      } else {
        await updateMutation.mutateAsync({ id: editingRuleId, payload });
        setFeedback("Regra atualizada com sucesso.");
      }
      setOpenEditor(false);
    } catch (error) {
      setFeedback(error instanceof ApiError ? error.message : "Não foi possível salvar a regra.");
    }
  }

  return (
    <section className="space-y-5">
      <header className="rounded-2xl border border-slate-200 bg-gradient-to-r from-white to-slate-50 px-6 py-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Papéis de Aprovação (DOA)</p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">Matriz de Aprovação</h1>
        <p className="mt-2 text-sm text-slate-600">
          Papéis corporativos utilizados na Matriz de Aprovação (DOA) para definição de alçadas, aprovações e exceções.
        </p>
      </header>

      <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-sm text-slate-600">Gerencie regras por faixa, papéis aprovadores e exigências da estrutura DOA.</p>
        <button type="button" onClick={openCreate} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
          <PlusCircle className="h-4 w-4" /> Nova regra
        </button>
      </div>

      {feedback ? (
        <div className={cn("rounded-xl border px-4 py-3 text-sm", feedback.includes("sucesso") ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700")}>
          <div className="flex items-center gap-2">{feedback.includes("sucesso") ? <CheckCircle2 className="h-4 w-4" /> : null}{feedback}</div>
        </div>
      ) : null}

      {rulesQuery.isLoading ? <p className="text-sm text-slate-500">Carregando matriz...</p> : null}
      {rulesQuery.isError ? <p className="text-sm text-rose-700">Não foi possível carregar a matriz de aprovação.</p> : null}

      <div className="grid gap-4 md:grid-cols-2">
        {rules.map((rule) => (
          <article key={rule.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">{rule.code}</p>
                <h2 className="mt-1 text-lg font-semibold text-slate-900">{rule.name}</h2>
                <p className="mt-1 text-sm text-slate-600">{rule.description ?? "Regra institucional sem descrição adicional."}</p>
              </div>
              <span className={cn("rounded-full px-2 py-1 text-xs font-semibold", rule.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-700")}>
                {rule.is_active ? "Ativa" : "Inativa"}
              </span>
            </div>
            <div className="mt-4 space-y-2 text-sm text-slate-700">
              <p><strong>Faixa:</strong> {formatRange(rule)}</p>
              <p><strong>Aprovadores mínimos:</strong> {rule.required_approvals}</p>
              <p><strong>Papéis:</strong> {rule.roles.map((item) => item.workflow_role_name).join(", ")}</p>
              <p><strong>Escopo BU:</strong> {rule.business_unit_name ?? "Todas as BU's"}</p>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {rule.requires_committee ? <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-700">Comitê obrigatório</span> : null}
              {rule.requires_unanimous ? <span className="rounded-full bg-sky-100 px-2 py-1 text-xs font-semibold text-sky-700">Aprovação unânime</span> : null}
              <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">Prioridade {rule.priority}</span>
            </div>
            <button type="button" onClick={() => openEdit(rule)} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700">
              <Pencil className="h-4 w-4" /> Editar regra
            </button>
          </article>
        ))}
      </div>

      {openEditor ? (
        <div className="fixed inset-0 z-50 bg-slate-900/40">
          <div className="absolute right-0 top-0 h-full w-full max-w-3xl overflow-y-auto bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h3 className="text-xl font-semibold text-slate-900">{editingRuleId ? "Editar Regra" : "Nova Regra"}</h3>
                <p className="text-sm text-slate-600">Defina critérios institucionais, alçadas e responsáveis pela aprovação corporativa.</p>
              </div>
              <button type="button" onClick={() => setOpenEditor(false)} className="text-sm text-slate-600">Fechar</button>
            </div>
            <form className="space-y-6" onSubmit={(event) => void handleSubmit(event)}>
              <section className="space-y-4 border-b border-slate-200 pb-5">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Informações da regra</p>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <FieldLabel title="Código da regra" helpText="Identificador técnico e institucional da regra utilizado para rastreabilidade e auditoria da DOA." />
                    <div className="relative">
                      <input value={code} readOnly placeholder="DOA-0001" className="h-10 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 pr-9 text-sm text-slate-800 placeholder:text-slate-400" />
                      <Lock className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    </div>
                    <p className="mt-1 text-xs text-slate-500">Código institucional gerado automaticamente.</p>
                  </div>
                  <div>
                    <FieldLabel title="Nome da regra" />
                    <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Alçada corporativa padrão" className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm text-slate-800 placeholder:text-slate-400" />
                  </div>
                </div>
                <div>
                  <FieldLabel title="Descrição institucional" />
                  <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Contextualize objetivo e aplicação institucional desta regra." className="min-h-24 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400" />
                </div>
              </section>

              <section className="space-y-4 border-b border-slate-200 pb-5">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Critérios de aprovação</p>
                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <FieldLabel title="Valor mínimo" helpText="Define a faixa de valor em que esta alçada será aplicada." />
                    <input value={minAmount} onChange={(event) => setMinAmount(event.target.value)} placeholder="Ex.: 10000.00" className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm text-slate-800 placeholder:text-slate-400" />
                  </div>
                  <div>
                    <FieldLabel title="Valor máximo" helpText="Define a faixa de valor em que esta alçada será aplicada." />
                    <input value={maxAmount} onChange={(event) => setMaxAmount(event.target.value)} placeholder="Ex.: 500000.00" className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm text-slate-800 placeholder:text-slate-400" />
                  </div>
                  <div>
                    <FieldLabel title="Mín. de aprovadores" helpText="Quantidade mínima de aprovadores exigidos para validação da operação. Preparado para aprovações múltiplas futuras." />
                    <input type="number" value={requiredApprovals} onChange={(event) => setRequiredApprovals(Number(event.target.value))} min={1} className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm text-slate-800" />
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <FieldLabel title="Unidade de negócio" />
                    <select value={businessUnitId ?? ""} onChange={(event) => setBusinessUnitId(event.target.value ? Number(event.target.value) : null)} className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm text-slate-800">
                      <option value="">Todas as BU&apos;s</option>
                      {businessUnits.map((bu) => <option key={bu.id} value={bu.id}>{bu.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <FieldLabel title="Prioridade" helpText="Usada para resolver conflitos entre regras. Regras com menor prioridade numérica possuem precedência." />
                    <input type="number" value={priority} onChange={(event) => setPriority(Number(event.target.value))} className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm text-slate-800" />
                  </div>
                </div>
              </section>

              <section className="space-y-4 border-b border-slate-200 pb-5">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Critérios DOA</p>
                <div className="grid gap-3 md:grid-cols-3">
                  <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-3 text-sm font-medium text-slate-700">
                    <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
                    <span>Regra ativa</span>
                  </label>
                  <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-3 text-sm font-medium text-slate-700">
                    <input type="checkbox" checked={requiresCommittee} onChange={(event) => setRequiresCommittee(event.target.checked)} />
                    <span>Comitê obrigatório</span>
                    <HelpTip text="Indica que a operação exige participação formal do Comitê de Crédito." />
                  </label>
                  <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-3 text-sm font-medium text-slate-700">
                    <input type="checkbox" checked={requiresUnanimous} onChange={(event) => setRequiresUnanimous(event.target.checked)} />
                    <span>Aprovação unânime</span>
                    <HelpTip text="Quando habilitado, todos os aprovadores exigidos deverão aprovar a operação." />
                  </label>
                </div>
              </section>

              <section className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/40 p-4">
                <div className="flex items-center gap-2 text-slate-800">
                  <Shield className="h-4 w-4" />
                  <p className="text-sm font-semibold">Papéis aprovadores</p>
                  <HelpTip text="Os papéis abaixo definem quem pode aprovar, rejeitar ou solicitar ajustes em análises de crédito conforme a Matriz DOA." />
                </div>
                {optionsQuery.isLoading ? <p className="text-sm text-slate-500">Carregando papéis...</p> : null}
                {optionsQuery.isError ? <p className="text-sm text-rose-700">Não foi possível carregar os papéis de workflow.</p> : null}
                {!optionsQuery.isLoading && !optionsQuery.isError && totalAvailableRoles === 0 ? (
                  <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                    Nenhum papel de Aprovação (DOA) ativo encontrado. Cadastre ou ative papéis corporativos antes de criar regras de aprovação.
                  </p>
                ) : null}
                <div className="space-y-4">
                  {([["Papéis de Aprovação (DOA)", groupedRoles.governance]] as const)
                    .filter(([, roleList]) => roleList.length > 0)
                    .map(([title, roleList]) => (
                    <div key={title} className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">{title}</p>
                      <div className="grid gap-2 md:grid-cols-2">
                        {roleList.map((role) => (
                          <label
                            key={role.code}
                            className={cn(
                              "flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm transition-colors",
                              selectedRoleCodes.includes(role.code)
                                ? "border-emerald-300 bg-emerald-50/70"
                                : "border-emerald-200 bg-white"
                            )}
                          >
                            <span className="flex items-center gap-2">
                              <input type="checkbox" checked={selectedRoleCodes.includes(role.code)} onChange={() => toggleRole(role.code)} />
                              <span className="font-medium text-slate-800">{role.name}</span>
                            </span>
                            <span className="inline-flex items-center gap-1">
                              {selectedRoleCodes.includes(role.code) ? <Check className="h-3.5 w-3.5 text-emerald-700" /> : null}
                              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.04em] text-emerald-700">DOA</span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                    ))}
                </div>
              </section>

              <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t border-slate-200 bg-white/95 px-1 pb-1 pt-4 backdrop-blur">
                <button type="button" onClick={() => setOpenEditor(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">
                  Cancelar
                </button>
                <button type="submit" className="rounded-lg bg-slate-900 px-5 py-2 text-sm font-semibold text-white shadow-sm">
                  {editingRuleId ? "Salvar alterações" : "Criar regra"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  );
}
