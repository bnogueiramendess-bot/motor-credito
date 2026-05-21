"use client";

import { FormEvent, useMemo, useState } from "react";
import { CheckCircle2, Pencil, PlusCircle, Shield } from "lucide-react";

import { ApprovalMatrixRuleDto, ApprovalMatrixRuleWritePayload } from "@/features/admin/api/admin.api";
import { useApprovalMatrixOptionsQuery } from "@/features/admin/hooks/use-approval-matrix-options-query";
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
  if (rule.min_amount && rule.max_amount) return `${formatAmount(rule.min_amount, rule.currency)} atÃ© ${formatAmount(rule.max_amount, rule.currency)}`;
  if (rule.min_amount && !rule.max_amount) return `Acima de ${formatAmount(rule.min_amount, rule.currency)}`;
  if (!rule.min_amount && rule.max_amount) return `AtÃ© ${formatAmount(rule.max_amount, rule.currency)}`;
  return "Faixa nÃ£o limitada";
}

export function AdminApprovalMatrixPageView() {
  const rulesQuery = useApprovalMatrixQuery();
  const optionsQuery = useApprovalMatrixOptionsQuery();
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

  const groupedRoles = useMemo(
    () => ({
      operational: (optionsQuery.data?.workflow_roles ?? []).filter((item) => item.type === "operational"),
      governance: (optionsQuery.data?.workflow_roles ?? []).filter((item) => item.type === "governance"),
      approval: (optionsQuery.data?.workflow_roles ?? []).filter((item) => item.type === "approval")
    }),
    [optionsQuery.data?.workflow_roles]
  );

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

  function openCreate() {
    resetForm();
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
      setFeedback(error instanceof ApiError ? error.message : "NÃ£o foi possÃ­vel salvar a regra.");
    }
  }

  return (
    <section className="space-y-5">
      <header className="rounded-2xl border border-slate-200 bg-gradient-to-r from-white to-slate-50 px-6 py-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">GovernanÃ§a</p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">Matriz de AprovaÃ§Ã£o</h1>
        <p className="mt-2 text-sm text-slate-600">
          Estrutura institucional de alÃ§adas, aprovadores e exceÃ§Ãµes, preparada para integraÃ§Ã£o gradual com o workflow.
        </p>
      </header>

      <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-sm text-slate-600">Gerencie regras por faixa, papÃ©is aprovadores e obrigatoriedades de governanÃ§a.</p>
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
      {rulesQuery.isError ? <p className="text-sm text-rose-700">NÃ£o foi possÃ­vel carregar a matriz de aprovaÃ§Ã£o.</p> : null}

      <div className="grid gap-4 md:grid-cols-2">
        {rules.map((rule) => (
          <article key={rule.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">{rule.code}</p>
                <h2 className="mt-1 text-lg font-semibold text-slate-900">{rule.name}</h2>
                <p className="mt-1 text-sm text-slate-600">{rule.description ?? "Regra institucional sem descriÃ§Ã£o adicional."}</p>
              </div>
              <span className={cn("rounded-full px-2 py-1 text-xs font-semibold", rule.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-700")}>
                {rule.is_active ? "Ativa" : "Inativa"}
              </span>
            </div>
            <div className="mt-4 space-y-2 text-sm text-slate-700">
              <p><strong>Faixa:</strong> {formatRange(rule)}</p>
              <p><strong>Aprovadores mÃ­nimos:</strong> {rule.required_approvals}</p>
              <p><strong>PapÃ©is:</strong> {rule.roles.map((item) => item.workflow_role_name).join(", ")}</p>
              <p><strong>Escopo BU:</strong> {rule.business_unit_name ?? "Todas as BU's"}</p>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {rule.requires_committee ? <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-700">ComitÃª obrigatÃ³rio</span> : null}
              {rule.requires_unanimous ? <span className="rounded-full bg-sky-100 px-2 py-1 text-xs font-semibold text-sky-700">AprovaÃ§Ã£o unÃ¢nime</span> : null}
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
                <p className="text-sm text-slate-600">Configure alÃ§ada, aprovadores e critÃ©rios institucionais.</p>
              </div>
              <button type="button" onClick={() => setOpenEditor(false)} className="text-sm text-slate-600">Fechar</button>
            </div>
            <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
              <div className="grid gap-3 md:grid-cols-2">
                <input value={code} onChange={(event) => setCode(event.target.value)} placeholder="CÃ³digo da regra" className="h-10 rounded-lg border border-slate-300 px-3 text-sm" />
                <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nome da regra" className="h-10 rounded-lg border border-slate-300 px-3 text-sm" />
              </div>
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="DescriÃ§Ã£o institucional" className="min-h-20 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              <div className="grid gap-3 md:grid-cols-3">
                <input value={minAmount} onChange={(event) => setMinAmount(event.target.value)} placeholder="Valor mÃ­nimo" className="h-10 rounded-lg border border-slate-300 px-3 text-sm" />
                <input value={maxAmount} onChange={(event) => setMaxAmount(event.target.value)} placeholder="Valor mÃ¡ximo" className="h-10 rounded-lg border border-slate-300 px-3 text-sm" />
                <input type="number" value={requiredApprovals} onChange={(event) => setRequiredApprovals(Number(event.target.value))} min={1} className="h-10 rounded-lg border border-slate-300 px-3 text-sm" />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <select value={businessUnitId ?? ""} onChange={(event) => setBusinessUnitId(event.target.value ? Number(event.target.value) : null)} className="h-10 rounded-lg border border-slate-300 px-3 text-sm">
                  <option value="">Todas as BU&apos;s</option>
                  {businessUnits.map((bu) => <option key={bu.id} value={bu.id}>{bu.name}</option>)}
                </select>
                <input type="number" value={priority} onChange={(event) => setPriority(Number(event.target.value))} className="h-10 rounded-lg border border-slate-300 px-3 text-sm" />
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                <label className="rounded-lg border border-slate-200 p-3 text-sm"><input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} /> <span className="ml-2">Regra ativa</span></label>
                <label className="rounded-lg border border-slate-200 p-3 text-sm"><input type="checkbox" checked={requiresCommittee} onChange={(event) => setRequiresCommittee(event.target.checked)} /> <span className="ml-2">ComitÃª obrigatÃ³rio</span></label>
                <label className="rounded-lg border border-slate-200 p-3 text-sm"><input type="checkbox" checked={requiresUnanimous} onChange={(event) => setRequiresUnanimous(event.target.checked)} /> <span className="ml-2">AprovaÃ§Ã£o unÃ¢nime</span></label>
              </div>
              <div className="space-y-3 rounded-xl border border-slate-200 p-4">
                <div className="flex items-center gap-2 text-slate-800"><Shield className="h-4 w-4" /> <p className="text-sm font-semibold">PapÃ©is aprovadores</p></div>
                {optionsQuery.isLoading ? <p className="text-sm text-slate-500">Carregando papÃ©is...</p> : null}
                <div className="space-y-3">
                  {([['Operacionais', groupedRoles.operational], ['Governança', groupedRoles.governance], ['Aprovação', groupedRoles.approval]] as const).map(([title, roleList]) => (
                    <div key={title} className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">{title}</p>
                      <div className="grid gap-2 md:grid-cols-2">
                        {roleList.map((role) => (
                          <label key={role.code} className="rounded-lg border border-slate-200 p-2 text-sm">
                            <input type="checkbox" checked={selectedRoleCodes.includes(role.code)} onChange={() => toggleRole(role.code)} />
                            <span className="ml-2 font-medium text-slate-800">{role.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
                {editingRuleId ? "Salvar alteraÃ§Ãµes" : "Criar regra"}
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  );
}

