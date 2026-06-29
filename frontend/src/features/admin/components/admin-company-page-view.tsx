"use client";

import { FormEvent, useMemo, useState } from "react";

import { PolicyGovernanceApprovalType } from "@/features/admin/api/admin.api";
import { ApiError } from "@/shared/lib/http/http-client";
import { cn } from "@/shared/lib/utils";
import {
  useCompanyPolicyGovernanceQuery,
  useCompanyQuery,
  useUpdateCompanyMutation,
  useUpdateCompanyPolicyGovernanceMutation,
} from "@/features/admin/hooks/use-company";
import { useWorkflowRolesQuery } from "@/features/admin/hooks/use-workflow-roles-query";

type CompanyFormState = {
  legal_name: string;
  trade_name: string;
  cnpj: string;
  is_active: boolean;
  corporate_email_required: boolean;
  allowed_domains: string[];
};

const POLICY_GOVERNANCE_BLOCKS: Array<{
  type: PolicyGovernanceApprovalType;
  title: string;
  description: string;
  required: boolean;
}> = [
  {
    type: "POLICY_PUBLISH",
    title: "Publicação de Política",
    description: "Papéis que devem aprovar a publicação de uma nova versão de política.",
    required: true,
  },
  {
    type: "POLICY_ARCHIVE",
    title: "Arquivamento de Política",
    description: "Papéis que devem aprovar o arquivamento de uma política.",
    required: true,
  },
  {
    type: "POLICY_STRUCTURE_CHANGE",
    title: "Alteração Estrutural de Política",
    description: "Papéis que aprovarão mudanças críticas na estrutura da política. Preparado para uso futuro.",
    required: false,
  },
];

type PolicyGovernanceSelection = Record<PolicyGovernanceApprovalType, number[]>;

function normalizeDomain(input: string) {
  return input.trim().toLowerCase().replace(/^@+/, "");
}

function isValidCnpj(cnpj: string) {
  const digits = cnpj.replace(/\D/g, "");
  return digits.length === 14;
}

function formatCnpj(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 14);
  if (!digits) return "";
  return digits
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

export function AdminCompanyPageView() {
  const companyQuery = useCompanyQuery();
  const workflowRolesQuery = useWorkflowRolesQuery();
  const policyGovernanceQuery = useCompanyPolicyGovernanceQuery();
  const updateMutation = useUpdateCompanyMutation();
  const updatePolicyGovernanceMutation = useUpdateCompanyPolicyGovernanceMutation();

  const [domainInput, setDomainInput] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [policyGovernanceFeedback, setPolicyGovernanceFeedback] = useState<string | null>(null);

  const initialState = useMemo<CompanyFormState | null>(() => {
    if (!companyQuery.data) return null;
    return {
      legal_name: companyQuery.data.legal_name,
      trade_name: companyQuery.data.trade_name ?? "",
      cnpj: companyQuery.data.cnpj ?? "",
      is_active: companyQuery.data.is_active,
      corporate_email_required: companyQuery.data.corporate_email_required,
      allowed_domains: companyQuery.data.allowed_domains
    };
  }, [companyQuery.data]);

  const [form, setForm] = useState<CompanyFormState | null>(null);
  const [policyGovernanceSelection, setPolicyGovernanceSelection] = useState<PolicyGovernanceSelection | null>(null);

  const governanceRoles = useMemo(
    () =>
      (workflowRolesQuery.data ?? [])
        .filter((role) => role.type === "governance" && role.is_active)
        .sort((first, second) => first.name.localeCompare(second.name, "pt-BR")),
    [workflowRolesQuery.data]
  );

  const initialPolicyGovernanceSelection = useMemo<PolicyGovernanceSelection | null>(() => {
    if (!policyGovernanceQuery.data) return null;
    return {
      POLICY_PUBLISH: policyGovernanceQuery.data.approval_roles.POLICY_PUBLISH.map((role) => role.role_id),
      POLICY_ARCHIVE: policyGovernanceQuery.data.approval_roles.POLICY_ARCHIVE.map((role) => role.role_id),
      POLICY_STRUCTURE_CHANGE: policyGovernanceQuery.data.approval_roles.POLICY_STRUCTURE_CHANGE.map((role) => role.role_id),
    };
  }, [policyGovernanceQuery.data]);

  if (!form && initialState) {
    setForm(initialState);
  }

  if (!policyGovernanceSelection && initialPolicyGovernanceSelection) {
    setPolicyGovernanceSelection(initialPolicyGovernanceSelection);
  }

  function togglePolicyGovernanceRole(type: PolicyGovernanceApprovalType, roleId: number) {
    if (!policyGovernanceSelection) return;
    const current = policyGovernanceSelection[type];
    setPolicyGovernanceSelection({
      ...policyGovernanceSelection,
      [type]: current.includes(roleId) ? current.filter((item) => item !== roleId) : [...current, roleId],
    });
  }

  function addDomain() {
    if (!form) return;
    const normalized = normalizeDomain(domainInput);
    if (!normalized) {
      setFeedback("Adicione ao menos um domínio autorizado.");
      return;
    }
    if (form.allowed_domains.includes(normalized)) {
      setFeedback("Este domínio já foi adicionado.");
      return;
    }
    setForm({ ...form, allowed_domains: [...form.allowed_domains, normalized] });
    setDomainInput("");
    setFeedback(null);
  }

  function removeDomain(domain: string) {
    if (!form) return;
    setForm({ ...form, allowed_domains: form.allowed_domains.filter((item) => item !== domain) });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form) return;

    if (!form.legal_name.trim()) {
      setFeedback("Informe uma razão social válida.");
      return;
    }

    if (!isValidCnpj(form.cnpj)) {
      setFeedback("Informe um CNPJ válido.");
      return;
    }

    if (form.corporate_email_required && form.allowed_domains.length === 0) {
      setFeedback("Adicione ao menos um domínio autorizado.");
      return;
    }

    try {
      await updateMutation.mutateAsync({
        legal_name: form.legal_name.trim(),
        trade_name: form.trade_name.trim() || null,
        cnpj: form.cnpj.replace(/\D/g, ""),
        is_active: form.is_active,
        corporate_email_required: form.corporate_email_required,
        allowed_domains: form.allowed_domains
      });
      setFeedback("Dados da empresa atualizados com sucesso.");
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Não foi possível atualizar os dados da empresa. Tente novamente.";
      setFeedback(message);
    }
  }

  async function handlePolicyGovernanceSubmit() {
    if (!policyGovernanceSelection) return;
    if (policyGovernanceSelection.POLICY_PUBLISH.length === 0) {
      setPolicyGovernanceFeedback("Selecione ao menos um papel para publicação de política.");
      return;
    }
    if (policyGovernanceSelection.POLICY_ARCHIVE.length === 0) {
      setPolicyGovernanceFeedback("Selecione ao menos um papel para arquivamento de política.");
      return;
    }

    try {
      const updated = await updatePolicyGovernanceMutation.mutateAsync({ approval_roles: policyGovernanceSelection });
      setPolicyGovernanceSelection({
        POLICY_PUBLISH: updated.approval_roles.POLICY_PUBLISH.map((role) => role.role_id),
        POLICY_ARCHIVE: updated.approval_roles.POLICY_ARCHIVE.map((role) => role.role_id),
        POLICY_STRUCTURE_CHANGE: updated.approval_roles.POLICY_STRUCTURE_CHANGE.map((role) => role.role_id),
      });
      setPolicyGovernanceFeedback("Governanca de Credito - Politicas atualizada com sucesso.");
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Nao foi possivel salvar a governanca de credito para politicas.";
      setPolicyGovernanceFeedback(message);
    }
  }

  return (
    <section className="space-y-5">
      <header className="rounded-2xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">Cadastro da Empresa</h1>
        <p className="mt-2 text-sm text-slate-600">
          Gerencie os dados institucionais, domínios autorizados e políticas básicas de acesso da empresa.
        </p>
      </header>

      {companyQuery.isLoading ? <p className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-sm text-slate-600">Carregando dados da empresa...</p> : null}
      {companyQuery.isError ? <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-6 text-sm text-rose-700">Não foi possível carregar os dados da empresa.</p> : null}

      {form ? (
        <form className="space-y-5" onSubmit={(event) => void handleSubmit(event)}>
          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
            <h2 className="text-base font-semibold text-slate-900">Dados Gerais</h2>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-1">
                <span className="text-sm font-medium text-slate-700">Razão Social</span>
                <input className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm" value={form.legal_name} onChange={(event) => setForm({ ...form, legal_name: event.target.value })} required />
              </label>

              <label className="space-y-1">
                <span className="text-sm font-medium text-slate-700">Nome Fantasia</span>
                <input className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm" value={form.trade_name} onChange={(event) => setForm({ ...form, trade_name: event.target.value })} />
              </label>

              <label className="space-y-1">
                <span className="text-sm font-medium text-slate-700">CNPJ</span>
                <input className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm" value={form.cnpj} onChange={(event) => setForm({ ...form, cnpj: formatCnpj(event.target.value) })} required />
              </label>

              <label className="space-y-1">
                <span className="text-sm font-medium text-slate-700">Status</span>
                <select className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm" value={form.is_active ? "active" : "inactive"} onChange={(event) => setForm({ ...form, is_active: event.target.value === "active" })}>
                  <option value="active">Ativo</option>
                  <option value="inactive">Inativo</option>
                </select>
              </label>
            </div>
          </article>

          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
            <h2 className="text-base font-semibold text-slate-900">Segurança e Domínios</h2>

            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={form.corporate_email_required} onChange={(event) => setForm({ ...form, corporate_email_required: event.target.checked })} />
              Obrigar e-mail corporativo
            </label>

            <p className="text-xs text-slate-500">Usuários convidados só poderão usar e-mails pertencentes aos domínios autorizados.</p>

            <div className="flex gap-2">
              <input className="h-10 flex-1 rounded-lg border border-slate-300 px-3 text-sm" placeholder="Ex.: indorama.com" value={domainInput} onChange={(event) => setDomainInput(event.target.value)} />
              <button type="button" className="h-10 rounded-lg border border-slate-300 px-4 text-sm font-medium" onClick={addDomain}>Adicionar</button>
            </div>

            <div className="flex flex-wrap gap-2">
              {form.allowed_domains.map((domain) => (
                <button key={domain} type="button" onClick={() => removeDomain(domain)} className="inline-flex items-center rounded-full border border-slate-300 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700">
                  {domain} ×
                </button>
              ))}
            </div>
          </article>

          <article className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Governanca de Credito - Politicas</h2>
              <p className="mt-1 text-sm text-slate-600">
                Defina quais papéis devem aprovar publicações, arquivamentos e alterações estruturais das políticas de crédito desta empresa.
              </p>
              <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                Esta configuração não altera a Matriz de Aprovação (DOA) das análises de crédito. Esta seção define somente quem aprova mudanças nas políticas de crédito.
              </p>
            </div>

            {policyGovernanceQuery.isLoading || workflowRolesQuery.isLoading ? (
              <p className="text-sm text-slate-500">Carregando papeis da governanca de credito...</p>
            ) : null}
            {policyGovernanceQuery.isError || workflowRolesQuery.isError ? (
              <p className="text-sm text-rose-700">Nao foi possivel carregar a governanca de credito para politicas.</p>
            ) : null}

            {policyGovernanceSelection && !policyGovernanceQuery.isLoading && !workflowRolesQuery.isLoading ? (
              <div className="grid gap-4 xl:grid-cols-3">
                {POLICY_GOVERNANCE_BLOCKS.map((block) => (
                  <section key={block.type} className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                    <div className="min-h-20">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-sm font-semibold text-slate-900">{block.title}</h3>
                        {policyGovernanceQuery.data?.fallback_used?.[block.type] ? (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.04em] text-amber-700">
                            Padrão
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs leading-5 text-slate-600">{block.description}</p>
                    </div>

                    <div className="mt-4 space-y-2">
                      {governanceRoles.length === 0 ? (
                        <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
                          Nenhum papel DOA ativo disponível.
                        </p>
                      ) : null}
                      {governanceRoles.map((role) => {
                        const selected = policyGovernanceSelection[block.type].includes(role.id);
                        return (
                          <button
                            key={`${block.type}-${role.id}`}
                            type="button"
                            onClick={() => togglePolicyGovernanceRole(block.type, role.id)}
                            className={cn(
                              "flex min-h-12 w-full items-center justify-between gap-3 rounded-lg border bg-white px-3 py-2 text-left text-sm",
                              selected ? "border-slate-900 text-slate-950" : "border-slate-200 text-slate-700"
                            )}
                          >
                            <span className="font-medium">{role.name}</span>
                            <span
                              className={cn(
                                "h-4 w-4 rounded border",
                                selected ? "border-slate-900 bg-slate-900" : "border-slate-300 bg-white"
                              )}
                            />
                          </button>
                        );
                      })}
                    </div>

                    {block.required && policyGovernanceSelection[block.type].length === 0 ? (
                      <p className="mt-3 text-xs text-rose-700">Selecione ao menos um papel.</p>
                    ) : null}
                  </section>
                ))}
              </div>
            ) : null}

            {policyGovernanceFeedback ? (
              <p className={cn("rounded-lg border px-4 py-3 text-sm", policyGovernanceFeedback.includes("sucesso") ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700")}>
                {policyGovernanceFeedback}
              </p>
            ) : null}

            <div>
              <button
                type="button"
                disabled={!policyGovernanceSelection || updatePolicyGovernanceMutation.isPending}
                onClick={() => void handlePolicyGovernanceSubmit()}
                className="inline-flex h-10 items-center rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {updatePolicyGovernanceMutation.isPending ? "Salvando governanca de credito..." : "Salvar Governanca de Credito"}
              </button>
            </div>
          </article>

          {feedback ? (
            <p className={cn("rounded-lg border px-4 py-3 text-sm", feedback.includes("sucesso") ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700")}>
              {feedback}
            </p>
          ) : null}

          <button type="submit" disabled={updateMutation.isPending} className="inline-flex h-10 items-center rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
            {updateMutation.isPending ? "Salvando..." : "Salvar alterações"}
          </button>
        </form>
      ) : null}
    </section>
  );
}
