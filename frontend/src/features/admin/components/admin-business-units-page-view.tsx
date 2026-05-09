"use client";

import { FormEvent, useMemo, useState } from "react";
import { Building2, Edit3, Mail, Plus, Power, UserRound } from "lucide-react";

import { ApiError } from "@/shared/lib/http/http-client";
import { cn } from "@/shared/lib/utils";
import { BusinessUnitDto } from "@/features/admin/api/admin.api";
import { useBusinessUnitsQuery } from "@/features/admin/hooks/use-business-units-query";
import { useCreateBusinessUnitMutation } from "@/features/admin/hooks/use-create-business-unit-mutation";
import { useUpdateBusinessUnitMutation } from "@/features/admin/hooks/use-update-business-unit-mutation";
import { useUpdateBusinessUnitStatusMutation } from "@/features/admin/hooks/use-update-business-unit-status-mutation";

type FormState = {
  id?: number;
  name: string;
  head_name: string;
  head_email: string;
  is_active: boolean;
};

const emptyForm: FormState = {
  name: "",
  head_name: "",
  head_email: "",
  is_active: true
};

function emailIsValid(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function AdminBusinessUnitsPageView() {
  const unitsQuery = useBusinessUnitsQuery();
  const createMutation = useCreateBusinessUnitMutation();
  const updateMutation = useUpdateBusinessUnitMutation();
  const statusMutation = useUpdateBusinessUnitStatusMutation();

  const [openForm, setOpenForm] = useState(false);
  const [formState, setFormState] = useState<FormState>(emptyForm);
  const [feedback, setFeedback] = useState<string | null>(null);

  const businessUnits = useMemo(() => unitsQuery.data ?? [], [unitsQuery.data]);

  const summary = useMemo(() => {
    const total = businessUnits.length;
    const active = businessUnits.filter((item) => item.is_active).length;
    const inactive = total - active;
    const heads = new Set(businessUnits.map((item) => item.head_email.toLowerCase())).size;
    return { total, active, inactive, heads };
  }, [businessUnits]);

  function openCreateForm() {
    setFeedback(null);
    setFormState(emptyForm);
    setOpenForm(true);
  }

  function openEditForm(unit: BusinessUnitDto) {
    setFeedback(null);
    setFormState({
      id: unit.id,
      name: unit.name,
      head_name: unit.head_name,
      head_email: unit.head_email,
      is_active: unit.is_active
    });
    setOpenForm(true);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!formState.name.trim() || !formState.head_name.trim() || !formState.head_email.trim() || !emailIsValid(formState.head_email.trim())) {
      setFeedback("Preencha os campos obrigatórios antes de continuar.");
      return;
    }

    const payload = {
      name: formState.name.trim(),
      head_name: formState.head_name.trim(),
      head_email: formState.head_email.trim().toLowerCase(),
      is_active: formState.is_active
    };

    try {
      if (formState.id) {
        await updateMutation.mutateAsync({ id: formState.id, payload });
        setFeedback("BU atualizada com sucesso.");
      } else {
        await createMutation.mutateAsync(payload);
        setFeedback("BU criada com sucesso.");
      }
      setOpenForm(false);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setFeedback("Já existe uma BU cadastrada com essas informações.");
        return;
      }
      setFeedback("Não foi possível salvar a BU. Tente novamente.");
    }
  }

  async function handleStatusChange(unit: BusinessUnitDto) {
    try {
      await statusMutation.mutateAsync({ id: unit.id, isActive: !unit.is_active });
      setFeedback(unit.is_active ? "BU desativada com sucesso." : "BU ativada com sucesso.");
    } catch {
      setFeedback("Não foi possível atualizar o status da BU.");
    }
  }

  return (
    <section className="space-y-5">
      <header className="rounded-2xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
          <h1 className="text-2xl font-semibold text-slate-900">Cadastro de BUs</h1>
            <p className="mt-2 text-sm text-slate-600">
              Gerencie as unidades de negócio utilizadas para controle de acesso, carteira e governança.
            </p>
          </div>
          <button
            type="button"
            onClick={openCreateForm}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800"
          >
            <Plus className="h-4 w-4" /> Nova BU
          </button>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard title="BUs ativas" value={summary.active} />
        <SummaryCard title="BUs inativas" value={summary.inactive} />
        <SummaryCard title="Heads cadastrados" value={summary.heads} />
        <SummaryCard title="Total de BUs" value={summary.total} />
      </div>

      {feedback ? <p className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">{feedback}</p> : null}

      <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        {unitsQuery.isLoading ? <p className="text-sm text-slate-500">Carregando unidades de negócio...</p> : null}
        {unitsQuery.isError ? <p className="text-sm text-rose-700">Não foi possível carregar as BUs.</p> : null}
        {!unitsQuery.isLoading && !unitsQuery.isError && businessUnits.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-600">
            Nenhuma BU cadastrada ainda. Crie a primeira unidade de negócio para organizar o acesso dos usuários e a visão da carteira.
          </p>
        ) : null}

        {!unitsQuery.isLoading && !unitsQuery.isError && businessUnits.length > 0 ? (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.06em] text-slate-500">
                <tr>
                  <th className="px-3 py-2">BU</th>
                  <th className="px-3 py-2">Código</th>
                  <th className="px-3 py-2">Head responsável</th>
                  <th className="px-3 py-2">E-mail do head</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Ações</th>
                </tr>
              </thead>
              <tbody>
                {businessUnits.map((unit) => (
                  <tr key={unit.id} className="border-t border-slate-200 text-slate-800">
                    <td className="px-3 py-2 font-medium">{unit.name}</td>
                    <td className="px-3 py-2">{unit.code}</td>
                    <td className="px-3 py-2">{unit.head_name}</td>
                    <td className="px-3 py-2">{unit.head_email}</td>
                    <td className="px-3 py-2">
                      <span className={cn("inline-flex rounded-full px-2 py-1 text-xs font-semibold", unit.is_active ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700")}>
                        {unit.is_active ? "Ativa" : "Inativa"}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => openEditForm(unit)}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs font-medium hover:border-slate-500"
                        >
                          <Edit3 className="h-3.5 w-3.5" /> Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleStatusChange(unit)}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs font-medium hover:border-slate-500"
                        >
                          <Power className="h-3.5 w-3.5" /> {unit.is_active ? "Desativar" : "Ativar"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </article>

      {openForm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-end bg-slate-950/30">
          <div className="h-full w-full max-w-xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">{formState.id ? "Editar BU" : "Nova BU"}</h2>
              <button type="button" onClick={() => setOpenForm(false)} className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium">Fechar</button>
            </div>

            <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
              <label className="space-y-1 block">
                <span className="text-sm font-medium text-slate-700 inline-flex items-center gap-2"><Building2 className="h-4 w-4" />Nome da BU</span>
                <input value={formState.name} onChange={(event) => setFormState((prev) => ({ ...prev, name: event.target.value }))} className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm" required />
              </label>

              <label className="space-y-1 block">
                <span className="text-sm font-medium text-slate-700 inline-flex items-center gap-2"><UserRound className="h-4 w-4" />Head responsável</span>
                <input value={formState.head_name} onChange={(event) => setFormState((prev) => ({ ...prev, head_name: event.target.value }))} className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm" required />
              </label>

              <label className="space-y-1 block">
                <span className="text-sm font-medium text-slate-700 inline-flex items-center gap-2"><Mail className="h-4 w-4" />E-mail do head</span>
                <input value={formState.head_email} onChange={(event) => setFormState((prev) => ({ ...prev, head_email: event.target.value }))} className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm" type="email" required />
              </label>

              <label className="space-y-1 block">
                <span className="text-sm font-medium text-slate-700">Status</span>
                <select
                  value={formState.is_active ? "active" : "inactive"}
                  onChange={(event) => setFormState((prev) => ({ ...prev, is_active: event.target.value === "active" }))}
                  className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"
                >
                  <option value="active">Ativa</option>
                  <option value="inactive">Inativa</option>
                </select>
              </label>

              <button
                type="submit"
                disabled={createMutation.isPending || updateMutation.isPending}
                className="inline-flex h-10 items-center rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {formState.id ? "Salvar alterações" : "Criar BU"}
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function SummaryCard({ title, value }: { title: string; value: number }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">{title}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
    </article>
  );
}
