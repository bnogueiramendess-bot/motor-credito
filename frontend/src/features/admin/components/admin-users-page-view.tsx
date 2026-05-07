"use client";

import { FormEvent, useMemo, useState } from "react";
import { CheckCircle2, Copy, ShieldCheck, UserPlus, Users } from "lucide-react";

import { AdminUserDto, BusinessUnitDto, InviteUserPayload } from "@/features/admin/api/admin.api";
import { useBusinessUnitsQuery } from "@/features/admin/hooks/use-business-units-query";
import { useAdminUsersQuery } from "@/features/admin/hooks/use-admin-users-query";
import { useInviteAdminUserMutation } from "@/features/admin/hooks/use-invite-admin-user-mutation";
import { ApiError } from "@/shared/lib/http/http-client";
import { cn } from "@/shared/lib/utils";

const roleOptions: Array<{ value: InviteUserPayload["role"]; label: string; guidance: string }> = [
  { value: "administrador_master", label: "Administrador Master", guidance: "Acesso administrativo completo" },
  { value: "administrador_bu", label: "Administrador de Unidade", guidance: "Gestao de usuarios e unidades" },
  { value: "analista", label: "Analista", guidance: "Acesso operacional controlado" },
  { value: "visualizador", label: "Visualizador", guidance: "Acesso somente para consulta" }
];

function roleLabel(role: string) {
  const found = roleOptions.find((item) => item.value === role);
  return found?.label ?? role;
}

function scopeSummary(user: AdminUserDto, businessUnits: BusinessUnitDto[]) {
  const hasAllScope = roleOptions[0].value === user.role;
  if (hasAllScope) return "Todas as unidades";
  if (user.business_unit_ids.length === 0) return "Sem unidade atribuida";

  const names = businessUnits
    .filter((unit) => user.business_unit_ids.includes(unit.id))
    .map((unit) => unit.name);

  if (names.length === 0) return "Escopo definido";
  return names.join(", ");
}

export function AdminUsersPageView() {
  const usersQuery = useAdminUsersQuery();
  const businessUnitsQuery = useBusinessUnitsQuery();
  const inviteMutation = useInviteAdminUserMutation();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteUserPayload["role"]>("analista");
  const [selectedBuIds, setSelectedBuIds] = useState<number[]>([]);
  const [lastInviteToken, setLastInviteToken] = useState<string | null>(null);
  const [lastInviteEmail, setLastInviteEmail] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  const businessUnits = useMemo(
    () => (businessUnitsQuery.data ?? []).filter((businessUnit) => businessUnit.is_active),
    [businessUnitsQuery.data]
  );
  const users = usersQuery.data ?? [];

  const canManageBuScope = useMemo(() => role !== "administrador_master", [role]);

  function toggleBusinessUnit(buId: number) {
    setSelectedBuIds((current) =>
      current.includes(buId) ? current.filter((id) => id !== buId) : [...current, buId]
    );
  }

  async function copyInviteLink(token: string) {
    const link = `${window.location.origin}/primeiro-acesso?token=${encodeURIComponent(token)}`;
    await navigator.clipboard.writeText(link);
    setFeedbackMessage("Link de primeiro acesso copiado com sucesso.");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedbackMessage(null);
    setLastInviteToken(null);
    setLastInviteEmail(null);

    const payload: InviteUserPayload = {
      full_name: fullName.trim(),
      email: email.trim().toLowerCase(),
      role,
      business_unit_ids: canManageBuScope ? selectedBuIds : []
    };

    try {
      const response = await inviteMutation.mutateAsync(payload);
      setLastInviteToken(response.invitation_token);
      setLastInviteEmail(response.email);
      setFeedbackMessage("Convite enviado com sucesso.");
      setFullName("");
      setEmail("");
      setRole("analista");
      setSelectedBuIds([]);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Nao foi possivel enviar o convite.";
      setFeedbackMessage(message);
    }
  }

  return (
    <section className="space-y-5">
      <header className="rounded-2xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Administracao</p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-900">Gestao de usuarios</h1>
            <p className="mt-2 text-sm text-slate-600">
              Convide usuarios, defina o perfil de acesso e controle o escopo por unidade de negocio.
            </p>
          </div>
          <div className="rounded-xl bg-slate-50 px-4 py-3 text-right">
            <p className="text-xs uppercase tracking-[0.08em] text-slate-500">Usuarios ativos</p>
            <p className="text-2xl font-semibold text-slate-900">{users.filter((user) => user.is_active).length}</p>
          </div>
        </div>
      </header>

      <div className="grid gap-5 xl:grid-cols-[1.2fr_1fr]">
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-slate-700" />
            <h2 className="text-base font-semibold text-slate-900">Convidar novo usuario</h2>
          </div>

          <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1">
                <span className="text-sm font-medium text-slate-700">Nome completo</span>
                <input
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  required
                  className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-slate-500"
                  placeholder="Ex.: Maria Souza"
                />
              </label>

              <label className="space-y-1">
                <span className="text-sm font-medium text-slate-700">E-mail corporativo</span>
                <input
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  type="email"
                  className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-slate-500"
                  placeholder="nome.sobrenome@indorama.com"
                />
              </label>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-700">Perfil de acesso</p>
              <div className="grid gap-2 md:grid-cols-2">
                {roleOptions.map((option) => {
                  const active = role === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setRole(option.value)}
                      className={cn(
                        "rounded-lg border px-3 py-2 text-left transition",
                        active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white hover:border-slate-500"
                      )}
                    >
                      <p className="text-sm font-semibold">{option.label}</p>
                      <p className={cn("text-xs", active ? "text-slate-200" : "text-slate-500")}>{option.guidance}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-700">Escopo por unidade de negocio</p>
              {canManageBuScope ? (
                <div className="rounded-lg border border-slate-300 p-3">
                  {businessUnitsQuery.isLoading ? <p className="text-sm text-slate-500">Carregando unidades...</p> : null}
                  {businessUnitsQuery.isError ? <p className="text-sm text-rose-700">Nao foi possivel carregar as unidades.</p> : null}
                  {!businessUnitsQuery.isLoading && !businessUnitsQuery.isError && businessUnits.length === 0 ? (
                    <p className="text-sm text-slate-500">Nenhuma unidade cadastrada. Cadastre ao menos uma unidade antes do convite.</p>
                  ) : null}
                  <div className="grid gap-2 md:grid-cols-2">
                    {businessUnits.map((unit) => {
                      const selected = selectedBuIds.includes(unit.id);
                      return (
                        <button
                          key={unit.id}
                          type="button"
                          onClick={() => toggleBusinessUnit(unit.id)}
                          className={cn(
                            "rounded-lg border px-3 py-2 text-left text-sm",
                            selected ? "border-slate-900 bg-slate-100" : "border-slate-300"
                          )}
                        >
                          <p className="font-medium text-slate-900">{unit.name}</p>
                          <p className="text-xs text-slate-500">{unit.code}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <p className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  Este perfil recebe acesso completo em todas as unidades de negocio.
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={inviteMutation.isPending}
              className="inline-flex h-10 items-center justify-center rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {inviteMutation.isPending ? "Enviando convite..." : "Enviar convite"}
            </button>
          </form>

          {feedbackMessage ? (
            <p className={cn("mt-4 text-sm", feedbackMessage.includes("sucesso") ? "text-emerald-700" : "text-rose-700")}>
              {feedbackMessage}
            </p>
          ) : null}

          {lastInviteToken && lastInviteEmail ? (
            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <div className="mb-2 flex items-center gap-2 text-emerald-800">
                <CheckCircle2 className="h-4 w-4" />
                <p className="text-sm font-semibold">Convite pronto para envio ao usuario</p>
              </div>
              <p className="text-sm text-emerald-800">Usuario convidado: {lastInviteEmail}</p>
              <button
                type="button"
                onClick={() => void copyInviteLink(lastInviteToken)}
                className="mt-3 inline-flex items-center gap-2 rounded-lg border border-emerald-400 bg-white px-3 py-2 text-sm font-medium text-emerald-800"
              >
                <Copy className="h-4 w-4" /> Copiar link de primeiro acesso
              </button>
            </div>
          ) : null}
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-slate-700" />
            <h2 className="text-base font-semibold text-slate-900">Perfis disponiveis</h2>
          </div>
          <ul className="space-y-3 text-sm">
            {roleOptions.map((roleOption) => (
              <li key={roleOption.value} className="rounded-lg border border-slate-200 p-3">
                <p className="font-semibold text-slate-900">{roleOption.label}</p>
                <p className="text-slate-600">{roleOption.guidance}</p>
              </li>
            ))}
          </ul>
        </article>
      </div>

      <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <Users className="h-4 w-4 text-slate-700" />
          <h2 className="text-base font-semibold text-slate-900">Usuarios cadastrados</h2>
        </div>

        {usersQuery.isLoading ? <p className="text-sm text-slate-500">Carregando usuarios...</p> : null}
        {usersQuery.isError ? <p className="text-sm text-rose-700">Nao foi possivel carregar os usuarios.</p> : null}

        {!usersQuery.isLoading && !usersQuery.isError ? (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.06em] text-slate-500">
                <tr>
                  <th className="px-3 py-2">Nome</th>
                  <th className="px-3 py-2">E-mail</th>
                  <th className="px-3 py-2">Perfil</th>
                  <th className="px-3 py-2">Escopo</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className="border-t border-slate-200 text-slate-800">
                    <td className="px-3 py-2 font-medium">{user.full_name}</td>
                    <td className="px-3 py-2">{user.email}</td>
                    <td className="px-3 py-2">{roleLabel(user.role)}</td>
                    <td className="px-3 py-2">{scopeSummary(user, businessUnits)}</td>
                    <td className="px-3 py-2">
                      <span className={cn("inline-flex rounded-full px-2 py-1 text-xs font-semibold", user.is_active ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700")}>
                        {user.is_active ? "Ativo" : "Inativo"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </article>
    </section>
  );
}
