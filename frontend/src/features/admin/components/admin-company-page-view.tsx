"use client";

import { FormEvent, useMemo, useState } from "react";

import { ApiError } from "@/shared/lib/http/http-client";
import { cn } from "@/shared/lib/utils";
import { useCompanyQuery, useUpdateCompanyMutation } from "@/features/admin/hooks/use-company";

type CompanyFormState = {
  legal_name: string;
  trade_name: string;
  cnpj: string;
  is_active: boolean;
  corporate_email_required: boolean;
  allowed_domains: string[];
};

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
  const updateMutation = useUpdateCompanyMutation();

  const [domainInput, setDomainInput] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);

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

  if (!form && initialState) {
    setForm(initialState);
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
