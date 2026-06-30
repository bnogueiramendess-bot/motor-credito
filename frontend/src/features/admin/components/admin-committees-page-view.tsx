"use client";

import { FormEvent, useMemo, useState } from "react";
import { Check, CheckCircle2, Crown, Pencil, PlusCircle, ShieldCheck, Trash2, UsersRound } from "lucide-react";

import {
  CommitteeDecisionRule,
  CommitteeDto,
  CommitteeMemberWritePayload,
  CommitteeStatus,
  CommitteeWritePayload
} from "@/features/admin/api/admin.api";
import { useCommitteeNextCodeQuery } from "@/features/admin/hooks/use-committee-next-code-query";
import { useCommitteeOptionsQuery } from "@/features/admin/hooks/use-committee-options-query";
import { useCommitteesQuery } from "@/features/admin/hooks/use-committees-query";
import { useCreateCommitteeMutation } from "@/features/admin/hooks/use-create-committee-mutation";
import { useUpdateCommitteeMutation } from "@/features/admin/hooks/use-update-committee-mutation";
import { ApiError } from "@/shared/lib/http/http-client";
import { cn } from "@/shared/lib/utils";

const decisionRuleLabels: Record<CommitteeDecisionRule, string> = {
  all: "Todos",
  majority: "Maioria",
  unanimous: "Unanime",
  chair_decides: "Presidente decide"
};

const statusLabels: Record<CommitteeStatus, string> = {
  draft: "Draft",
  active: "Active",
  inactive: "Inactive",
  archived: "Archived"
};

const fallbackDecisionRules: CommitteeDecisionRule[] = ["all", "majority", "unanimous", "chair_decides"];
const fallbackStatuses: CommitteeStatus[] = ["draft", "active", "inactive", "archived"];

type WorkflowRoleOption = { id: number; code: string; name: string; type: string; is_active: boolean };

type FieldLabelProps = {
  title: string;
};

function FieldLabel({ title }: FieldLabelProps) {
  return <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.06em] text-slate-600">{title}</label>;
}

function toMembers(committee: CommitteeDto): CommitteeMemberWritePayload[] {
  return committee.members.map((member) => ({
    workflow_role_id: member.workflow_role_id,
    sequence_order: member.sequence_order,
    is_required: member.is_required,
    is_chair: member.is_chair,
    is_active: member.is_active
  }));
}

function memberRoleName(member: CommitteeMemberWritePayload, roles: WorkflowRoleOption[]) {
  return roles.find((role) => role.id === member.workflow_role_id)?.name ?? `Papel #${member.workflow_role_id}`;
}

export function AdminCommitteesPageView() {
  const committeesQuery = useCommitteesQuery();
  const optionsQuery = useCommitteeOptionsQuery();
  const nextCodeQuery = useCommitteeNextCodeQuery();
  const createMutation = useCreateCommitteeMutation();
  const updateMutation = useUpdateCommitteeMutation();

  const [openEditor, setOpenEditor] = useState(false);
  const [editingCommitteeId, setEditingCommitteeId] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [decisionRule, setDecisionRule] = useState<CommitteeDecisionRule>("all");
  const [slaHours, setSlaHours] = useState(48);
  const [status, setStatus] = useState<CommitteeStatus>("draft");
  const [isDefault, setIsDefault] = useState(false);
  const [members, setMembers] = useState<CommitteeMemberWritePayload[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState("");

  const committees = committeesQuery.data ?? [];
  const roleOptions = useMemo(
    () => ((optionsQuery.data?.eligible_roles ?? optionsQuery.data?.workflow_roles) ?? []).filter((role) => role.is_active).sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    [optionsQuery.data?.eligible_roles, optionsQuery.data?.workflow_roles]
  );
  const selectedRoleIds = new Set(members.map((member) => member.workflow_role_id));
  const availableRoles = roleOptions.filter((role) => !selectedRoleIds.has(role.id));
  const slaOptions = optionsQuery.data?.sla_hours?.length ? optionsQuery.data.sla_hours : [48, 72, 96];

  function resetForm() {
    setEditingCommitteeId(null);
    setCode("");
    setName("");
    setDescription("");
    setDecisionRule("all");
    setSlaHours(48);
    setStatus("draft");
    setIsDefault(false);
    setMembers([]);
    setSelectedRoleId("");
  }

  async function openCreate() {
    resetForm();
    const nextCode = nextCodeQuery.data?.code ?? (await nextCodeQuery.refetch()).data?.code ?? "COM-0001";
    setCode(nextCode);
    setOpenEditor(true);
  }

  function openEdit(committee: CommitteeDto) {
    setEditingCommitteeId(committee.id);
    setCode(committee.code);
    setName(committee.name);
    setDescription(committee.description ?? "");
    setDecisionRule(committee.decision_rule);
    setSlaHours(committee.sla_hours);
    setStatus(committee.status);
    setIsDefault(committee.is_default);
    setMembers(toMembers(committee).filter((member) => roleOptions.some((role) => role.id === member.workflow_role_id)));
    setSelectedRoleId("");
    setOpenEditor(true);
  }

  function addMember() {
    const roleId = Number(selectedRoleId);
    if (!roleId || selectedRoleIds.has(roleId)) return;
    setMembers((current) => [
      ...current,
      { workflow_role_id: roleId, sequence_order: current.length + 1, is_required: true, is_chair: current.length === 0, is_active: true }
    ]);
    setSelectedRoleId("");
  }

  function updateMember(index: number, patch: Partial<CommitteeMemberWritePayload>) {
    setMembers((current) =>
      current.map((member, memberIndex) => {
        if (memberIndex !== index) return patch.is_chair ? { ...member, is_chair: false } : member;
        return { ...member, ...patch };
      })
    );
  }

  function removeMember(index: number) {
    setMembers((current) => current.filter((_, memberIndex) => memberIndex !== index).map((member, order) => ({ ...member, sequence_order: order + 1 })));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    const payload: CommitteeWritePayload = {
      code,
      name,
      description: description.trim() || null,
      status,
      decision_rule: decisionRule,
      sla_hours: slaHours,
      is_default: isDefault,
      members
    };
    try {
      if (editingCommitteeId === null) {
        await createMutation.mutateAsync(payload);
        setFeedback("Comite criado com sucesso.");
      } else {
        await updateMutation.mutateAsync({ id: editingCommitteeId, payload });
        setFeedback("Comite atualizado com sucesso.");
      }
      setOpenEditor(false);
    } catch (error) {
      setFeedback(error instanceof ApiError ? error.message : "Nao foi possivel salvar o comite.");
    }
  }

  return (
    <section className="flex flex-col gap-5">
      <header className="rounded-2xl border border-slate-200 bg-[linear-gradient(135deg,#ffffff_0%,#f8fafc_48%,#eef2ff_100%)] px-6 py-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Governanca de Credito</p>
        <div className="mt-1 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-950">Comites</h1>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
              Estrutura corporativa reutilizavel para cadastrar orgaos colegiados por empresa. O Motor de Credito usara inicialmente apenas o Comite de Credito, sem acionar workflow nesta fase.
            </p>
          </div>
          <button type="button" onClick={openCreate} className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white shadow-sm">
            <PlusCircle className="h-4 w-4" /> Novo comite
          </button>
        </div>
      </header>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Comites cadastrados</p>
          <p className="mt-2 text-2xl font-semibold text-slate-950">{committees.length}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Ativos</p>
          <p className="mt-2 text-2xl font-semibold text-slate-950">{committees.filter((committee) => committee.status === "active").length}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Papeis DOA elegiveis</p>
          <p className="mt-2 text-2xl font-semibold text-slate-950">{roleOptions.length}</p>
        </div>
      </div>

      {feedback ? (
        <div className={cn("rounded-xl border px-4 py-3 text-sm", feedback.includes("sucesso") ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700")}>
          <div className="flex items-center gap-2">{feedback.includes("sucesso") ? <CheckCircle2 className="h-4 w-4" /> : null}{feedback}</div>
        </div>
      ) : null}

      {committeesQuery.isLoading ? <p className="text-sm text-slate-500">Carregando comites...</p> : null}
      {committeesQuery.isError ? <p className="text-sm text-rose-700">Nao foi possivel carregar os comites.</p> : null}
      {!committeesQuery.isLoading && !committeesQuery.isError && committees.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">Nenhum comite cadastrado para esta empresa.</p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        {committees.map((committee) => (
          <article key={committee.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">{committee.code}</p>
                <h2 className="mt-1 flex items-center gap-2 text-lg font-semibold text-slate-950">
                  {committee.name}
                  {committee.is_default ? <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-white">Padrao</span> : null}
                </h2>
                <p className="mt-1 text-sm leading-5 text-slate-600">{committee.description ?? "Estrutura corporativa sem descricao adicional."}</p>
              </div>
              <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", committee.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-700")}>
                {statusLabels[committee.status]}
              </span>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">Regra</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">{decisionRuleLabels[committee.decision_rule]}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">SLA</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">{committee.sla_hours} horas</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">Membros</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">{committee.member_count}</p>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700"><ShieldCheck className="h-3.5 w-3.5" /> Papeis DOA</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700"><Crown className="h-3.5 w-3.5" /> {committee.chair_role_name ?? "Sem presidente"}</span>
            </div>

            <button type="button" onClick={() => openEdit(committee)} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700">
              <Pencil className="h-4 w-4" /> Editar comite
            </button>
          </article>
        ))}
      </div>

      {openEditor ? (
        <div className="fixed inset-0 z-50 bg-slate-950/45">
          <div className="absolute right-0 top-0 h-full w-full max-w-4xl overflow-y-auto bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Configuracao corporativa</p>
                <h3 className="mt-1 text-xl font-semibold text-slate-950">{editingCommitteeId ? "Editar Comite" : "Novo Comite"}</h3>
                <p className="mt-1 text-sm text-slate-600">Defina regras administrativas, SLA e composicao por papeis DOA.</p>
              </div>
              <button type="button" onClick={() => setOpenEditor(false)} className="text-sm font-medium text-slate-600">Fechar</button>
            </div>

            <form className="flex flex-col gap-6" onSubmit={(event) => void handleSubmit(event)}>
              <section className="rounded-xl border border-slate-200 p-4">
                <p className="mb-4 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Dados do comite</p>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <FieldLabel title="Codigo" />
                    <input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm text-slate-800" placeholder="COM-0001" />
                  </div>
                  <div>
                    <FieldLabel title="Nome" />
                    <input value={name} onChange={(event) => setName(event.target.value)} className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm text-slate-800" placeholder="Comite de Credito" />
                  </div>
                </div>
                <div className="mt-4">
                  <FieldLabel title="Descricao" />
                  <textarea value={description} onChange={(event) => setDescription(event.target.value)} className="min-h-24 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800" placeholder="Contextualize o objetivo corporativo deste comite." />
                </div>
                <div className="mt-4 grid gap-4 md:grid-cols-4">
                  <div>
                    <FieldLabel title="Regra" />
                    <select value={decisionRule} onChange={(event) => setDecisionRule(event.target.value as CommitteeDecisionRule)} className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm text-slate-800">
                      {(optionsQuery.data?.decision_rules ?? fallbackDecisionRules).map((rule) => <option key={rule} value={rule}>{decisionRuleLabels[rule]}</option>)}
                    </select>
                  </div>
                  <div>
                    <FieldLabel title="SLA" />
                    <select value={slaHours} onChange={(event) => setSlaHours(Number(event.target.value))} className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm text-slate-800">
                      {slaOptions.map((option) => <option key={option} value={option}>{option} horas</option>)}
                    </select>
                  </div>
                  <div>
                    <FieldLabel title="Status" />
                    <select value={status} onChange={(event) => setStatus(event.target.value as CommitteeStatus)} className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm text-slate-800">
                      {(optionsQuery.data?.statuses ?? fallbackStatuses).map((item) => <option key={item} value={item}>{statusLabels[item]}</option>)}
                    </select>
                  </div>
                  <label className="mt-6 flex h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700">
                    <input type="checkbox" checked={isDefault} onChange={(event) => setIsDefault(event.target.checked)} />
                    Padrao da empresa
                  </label>
                </div>
              </section>

              <section className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
                <div className="mb-4 flex items-center gap-2 text-slate-900">
                  <UsersRound className="h-4 w-4" />
                  <p className="text-sm font-semibold">Membros do Comite</p>
                </div>
                <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3 md:flex-row md:items-end">
                  <div className="flex-1">
                    <FieldLabel title="Papel DOA" />
                    <select value={selectedRoleId} onChange={(event) => setSelectedRoleId(event.target.value)} className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm text-slate-800">
                      <option value="">Selecione um papel DOA</option>
                      {availableRoles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                    </select>
                  </div>
                  <button type="button" onClick={addMember} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700">
                    <PlusCircle className="h-4 w-4" /> Adicionar
                  </button>
                </div>

                {members.length === 0 ? (
                  <p className="mt-3 rounded-lg border border-dashed border-slate-300 bg-white px-3 py-3 text-sm text-slate-600">Nenhum membro configurado. O comite pode existir sem membros nesta fase.</p>
                ) : null}

                <div className="mt-3 flex flex-col gap-2">
                  {members.map((member, index) => (
                    <div key={member.workflow_role_id} className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 md:grid-cols-[1fr_88px_120px_120px_120px_40px] md:items-center">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{memberRoleName(member, roleOptions)}</p>
                        <p className="text-xs text-slate-500">{roleOptions.find((role) => role.id === member.workflow_role_id)?.code ?? "Papel elegivel"}</p>
                      </div>
                      <input type="number" min={1} value={member.sequence_order} onChange={(event) => updateMember(index, { sequence_order: Number(event.target.value) })} className="h-9 rounded-lg border border-slate-300 px-2 text-sm" aria-label="Ordem" />
                      <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={member.is_required} onChange={(event) => updateMember(index, { is_required: event.target.checked })} /> Obrigatorio</label>
                      <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={member.is_chair} onChange={(event) => updateMember(index, { is_chair: event.target.checked })} /> Presidente</label>
                      <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={member.is_active} onChange={(event) => updateMember(index, { is_active: event.target.checked })} /> Ativo</label>
                      <button type="button" onClick={() => removeMember(index)} className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-300 text-slate-600" aria-label="Remover membro"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  ))}
                </div>
              </section>

              <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t border-slate-200 bg-white/95 px-1 pb-1 pt-4 backdrop-blur">
                <button type="button" onClick={() => setOpenEditor(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">Cancelar</button>
                <button type="submit" className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-5 py-2 text-sm font-semibold text-white shadow-sm">
                  <Check className="h-4 w-4" /> {editingCommitteeId ? "Salvar alteracoes" : "Criar comite"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  );
}