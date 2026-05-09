"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Copy, KeyRound, Mail, Pencil, Power, UserPlus, Users } from "lucide-react";

import { AdminProfileDto, AdminUserDto, BusinessUnitDto, InviteUserPayload } from "@/features/admin/api/admin.api";
import { useAdminProfilesQuery } from "@/features/admin/hooks/use-admin-profiles-query";
import { useAdminUsersQuery } from "@/features/admin/hooks/use-admin-users-query";
import { useBusinessUnitsQuery } from "@/features/admin/hooks/use-business-units-query";
import { useInviteAdminUserMutation } from "@/features/admin/hooks/use-invite-admin-user-mutation";
import { useRegenerateAdminUserInviteTokenMutation } from "@/features/admin/hooks/use-regenerate-admin-user-invite-token-mutation";
import { useUpdateAdminUserMutation } from "@/features/admin/hooks/use-update-admin-user-mutation";
import { useUpdateAdminUserStatusMutation } from "@/features/admin/hooks/use-update-admin-user-status-mutation";
import { ApiError } from "@/shared/lib/http/http-client";
import { cn } from "@/shared/lib/utils";

function profileOptionLabel(profile: AdminProfileDto) {
  return profile.name;
}

function userStatusLabel(user: AdminUserDto) {
  if (user.first_access_pending) return "Pendente de primeiro acesso";
  return user.is_active ? "Ativo" : "Inativo";
}

export function AdminUsersPageView() {
  const usersQuery = useAdminUsersQuery();
  const businessUnitsQuery = useBusinessUnitsQuery();
  const profilesQuery = useAdminProfilesQuery();
  const inviteMutation = useInviteAdminUserMutation();
  const updateUserMutation = useUpdateAdminUserMutation();
  const updateUserStatusMutation = useUpdateAdminUserStatusMutation();
  const regenerateTokenMutation = useRegenerateAdminUserInviteTokenMutation();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [profileId, setProfileId] = useState<number | null>(null);
  const [selectedBuIds, setSelectedBuIds] = useState<number[]>([]);
  const [lastInviteToken, setLastInviteToken] = useState<string | null>(null);
  const [lastInviteEmail, setLastInviteEmail] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [openDrawer, setOpenDrawer] = useState(false);
  const [drawerMode, setDrawerMode] = useState<"create" | "edit">("create");
  const [editingUserId, setEditingUserId] = useState<number | null>(null);

  const users = usersQuery.data ?? [];
  const allProfiles = useMemo(() => profilesQuery.data ?? [], [profilesQuery.data]);
  const activeProfiles = useMemo(
    () => allProfiles.filter((profile) => profile.status === "active"),
    [allProfiles]
  );
  const activeBusinessUnits = useMemo(
    () => (businessUnitsQuery.data ?? []).filter((unit) => unit.is_active),
    [businessUnitsQuery.data]
  );

  useEffect(() => {
    if (profileId !== null) return;
    if (activeProfiles.length > 0) {
      setProfileId(activeProfiles[0].id);
    }
  }, [activeProfiles, profileId]);

  function toggleBusinessUnit(businessUnitId: number) {
    setSelectedBuIds((current) =>
      current.includes(businessUnitId)
        ? current.filter((id) => id !== businessUnitId)
        : [...current, businessUnitId]
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

    if (profileId === null) {
      setFeedbackMessage("Selecione um perfil de acesso ativo.");
      return;
    }
    if (!phone.trim()) {
      setFeedbackMessage("Informe um telefone válido.");
      return;
    }
    const selectedProfile = allProfiles.find((profile) => profile.id === profileId);
    if (!selectedProfile || selectedProfile.status !== "active") {
      setFeedbackMessage("Selecione um perfil de acesso ativo.");
      return;
    }

    try {
      if (drawerMode === "edit" && editingUserId !== null) {
        await updateUserMutation.mutateAsync({
          id: editingUserId,
          payload: {
            full_name: fullName.trim(),
            phone: phone.trim(),
            profile_id: profileId,
            business_unit_ids: selectedBuIds
          }
        });
        setFeedbackMessage("Usuário atualizado com sucesso.");
      } else {
        const payload: InviteUserPayload = {
          full_name: fullName.trim(),
          email: email.trim().toLowerCase(),
          phone: phone.trim(),
          profile_id: profileId,
          business_unit_ids: selectedBuIds
        };
        const response = await inviteMutation.mutateAsync(payload);
        setLastInviteToken(response.invitation_token);
        setLastInviteEmail(response.email);
        setFeedbackMessage("Usuário incluído com sucesso.");
      }
      setFullName("");
      setEmail("");
      setPhone("");
      setSelectedBuIds([]);
      setOpenDrawer(false);
      setEditingUserId(null);
      setDrawerMode("create");
    } catch (error) {
      setFeedbackMessage(error instanceof ApiError ? error.message : "Não foi possível incluir o usuário. Tente novamente.");
    }
  }

  function openCreateDrawer() {
    setDrawerMode("create");
    setEditingUserId(null);
    setFullName("");
    setEmail("");
    setPhone("");
    setSelectedBuIds([]);
    setProfileId(activeProfiles[0]?.id ?? null);
    setOpenDrawer(true);
  }

  function openEditDrawer(user: AdminUserDto) {
    setDrawerMode("edit");
    setEditingUserId(user.id);
    setFullName(user.full_name);
    setEmail(user.email);
    setPhone(user.phone ?? "");
    setSelectedBuIds(user.business_unit_ids);
    const matchedProfile = allProfiles.find((profile) => profile.name === user.profile_name);
    setProfileId(matchedProfile?.id ?? activeProfiles[0]?.id ?? null);
    setOpenDrawer(true);
  }

  async function handleToggleStatus(user: AdminUserDto) {
    try {
      await updateUserStatusMutation.mutateAsync({ id: user.id, isActive: !user.is_active });
      setFeedbackMessage(user.is_active ? "Usuário inativado com sucesso." : "Usuário ativado com sucesso.");
    } catch (error) {
      setFeedbackMessage(error instanceof ApiError ? error.message : "Não foi possível atualizar o status do usuário.");
    }
  }

  async function handleRegenerateToken(user: AdminUserDto) {
    try {
      const response = await regenerateTokenMutation.mutateAsync(user.id);
      setLastInviteToken(response.invitation_token);
      setLastInviteEmail(response.email);
      setFeedbackMessage("Novo token de acesso gerado com sucesso.");
    } catch (error) {
      setFeedbackMessage(error instanceof ApiError ? error.message : "Não foi possível gerar novo token de acesso.");
    }
  }

  const activeUsersCount = users.filter((user) => user.is_active).length;
  const pendingFirstAccessCount = users.filter((user) => user.first_access_pending).length;

  return (
    <section className="space-y-5">
      <header className="rounded-2xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Administração</p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">Gestão de Usuários</h1>
        <p className="mt-2 text-sm text-slate-600">
          Cadastre usuários, vincule perfis de acesso e controle o escopo operacional por unidade de negócio.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
          <p className="text-xs uppercase tracking-[0.06em] text-slate-500">Usuários ativos</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{activeUsersCount}</p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
          <p className="text-xs uppercase tracking-[0.06em] text-slate-500">Pendentes de primeiro acesso</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{pendingFirstAccessCount}</p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
          <p className="text-xs uppercase tracking-[0.06em] text-slate-500">Perfis ativos</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{activeProfiles.length}</p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
          <p className="text-xs uppercase tracking-[0.06em] text-slate-500">Unidades de negócio ativas</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{activeBusinessUnits.length}</p>
        </article>
      </div>

      <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-slate-700" />
            <h2 className="text-base font-semibold text-slate-900">Inclusão de usuário</h2>
          </div>
          <button
            type="button"
            onClick={openCreateDrawer}
            className="inline-flex h-10 items-center justify-center rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Incluir Novo Usuário
          </button>
        </div>
        <p className="mt-3 text-sm text-slate-600">
          Use o botão para abrir o formulário lateral e concluir a inclusão governada.
        </p>

        {feedbackMessage ? (
          <p className={cn("mt-4 text-sm", feedbackMessage.includes("sucesso") ? "text-emerald-700" : "text-rose-700")}>
            {feedbackMessage}
          </p>
        ) : null}

        {lastInviteToken && lastInviteEmail ? (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="mb-2 flex items-center gap-2 text-emerald-800">
              <CheckCircle2 className="h-4 w-4" />
              <p className="text-sm font-semibold">Convite de primeiro acesso gerado</p>
            </div>
            <p className="text-sm text-emerald-800">Usuário incluído: {lastInviteEmail}</p>
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

      {openDrawer ? (
        <div className="fixed inset-0 z-50 bg-slate-900/40">
          <div className="absolute right-0 top-0 h-full w-full max-w-2xl overflow-y-auto bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-xl font-semibold text-slate-900">
                  {drawerMode === "edit" ? "Editar Usuário" : "Incluir Novo Usuário"}
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  {drawerMode === "edit" ? "Atualize os dados do usuário selecionado." : "Preencha os dados para inclusão governada."}
                </p>
              </div>
              <button type="button" onClick={() => setOpenDrawer(false)} className="text-sm text-slate-600">
                Fechar
              </button>
            </div>

            <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
              <div className="grid gap-3">
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
                    disabled={drawerMode === "edit"}
                    className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-slate-500"
                    placeholder="nome.sobrenome@indorama.com"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-sm font-medium text-slate-700">Telefone</span>
                  <input
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    required
                    className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-slate-500"
                    placeholder="(11) 99999-9999"
                  />
                </label>
              </div>

              <div className="grid gap-3">
                <label className="space-y-1">
                  <span className="text-sm font-medium text-slate-700">Perfil de acesso</span>
                  <select
                    value={profileId ?? ""}
                    onChange={(event) => setProfileId(Number(event.target.value))}
                    className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-slate-500"
                    disabled={profilesQuery.isLoading || allProfiles.length === 0}
                  >
                    {allProfiles.map((profile) => (
                      <option key={profile.id} value={profile.id} disabled={profile.status !== "active"}>
                        {profileOptionLabel(profile)} {profile.status === "active" ? "" : "(Inativo)"}
                      </option>
                    ))}
                  </select>
                  {profilesQuery.isLoading ? <p className="text-xs text-slate-500">Carregando perfis...</p> : null}
                  {profilesQuery.isError ? <p className="text-xs text-rose-700">Não foi possível carregar os perfis.</p> : null}
                </label>

                <div className="space-y-1">
                  <span className="text-sm font-medium text-slate-700">Unidades de negócio</span>
                  <div className="rounded-lg border border-slate-300 p-3">
                    {businessUnitsQuery.isLoading ? <p className="text-sm text-slate-500">Carregando unidades...</p> : null}
                    {businessUnitsQuery.isError ? <p className="text-sm text-rose-700">Não foi possível carregar as unidades.</p> : null}
                    {!businessUnitsQuery.isLoading && !businessUnitsQuery.isError && activeBusinessUnits.length === 0 ? (
                      <p className="text-sm text-slate-500">Nenhuma unidade ativa disponível.</p>
                    ) : null}
                    <div className="grid gap-2 md:grid-cols-2">
                      {activeBusinessUnits.map((unit) => {
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
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                Código do usuário e nome de usuário são gerados automaticamente pelo sistema no momento da inclusão.
              </div>

              <button
                type="submit"
                disabled={inviteMutation.isPending || profileId === null}
                className="inline-flex h-10 items-center justify-center rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {drawerMode === "edit" ? "Salvar alterações" : inviteMutation.isPending ? "Incluindo usuário..." : "Incluir usuário"}
              </button>
            </form>
          </div>
        </div>
      ) : null}

      <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <Users className="h-4 w-4 text-slate-700" />
          <h2 className="text-base font-semibold text-slate-900">Usuários cadastrados</h2>
        </div>

        {usersQuery.isLoading ? <p className="text-sm text-slate-500">Carregando usuários...</p> : null}
        {usersQuery.isError ? <p className="text-sm text-rose-700">Não foi possível carregar os usuários.</p> : null}

        {!usersQuery.isLoading && !usersQuery.isError ? (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.06em] text-slate-500">
                <tr>
                  <th className="px-3 py-2">Código</th>
                  <th className="px-3 py-2">Nome completo</th>
                  <th className="px-3 py-2">Nome de usuário</th>
                  <th className="px-3 py-2">E-mail</th>
                  <th className="px-3 py-2">Telefone</th>
                  <th className="px-3 py-2">Perfil</th>
                  <th className="px-3 py-2">Unidade de negócio</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Ações</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className="border-t border-slate-200 text-slate-800">
                    <td className="px-3 py-2 font-medium">{user.user_code}</td>
                    <td className="px-3 py-2">{user.full_name}</td>
                    <td className="px-3 py-2">{user.username}</td>
                    <td className="px-3 py-2">{user.email}</td>
                    <td className="px-3 py-2">{user.phone ?? "-"}</td>
                    <td className="px-3 py-2">{user.profile_name}</td>
                    <td className="px-3 py-2">{user.business_unit_names.length > 0 ? user.business_unit_names.join(", ") : "Sem vínculo"}</td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          "inline-flex rounded-full px-2 py-1 text-xs font-semibold",
                          user.first_access_pending ? "bg-amber-100 text-amber-800" : user.is_active ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"
                        )}
                      >
                        {userStatusLabel(user)}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => openEditDrawer(user)}
                          className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs text-slate-700"
                        >
                          <Pencil className="h-3 w-3" /> Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleToggleStatus(user)}
                          className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs text-slate-700"
                        >
                          <Power className="h-3 w-3" /> {user.is_active ? "Inativar" : "Ativar"}
                        </button>
                        {user.first_access_pending ? (
                          <button
                            type="button"
                            onClick={() => void handleRegenerateToken(user)}
                            className="inline-flex items-center gap-1 rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs text-emerald-700"
                          >
                            <KeyRound className="h-3 w-3" /> Novo Token de Acesso
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
          <div className="flex items-center gap-2">
            <Mail className="h-3.5 w-3.5" />
            <span>
              O fluxo de primeiro acesso permanece ativo: ao incluir o usuário, o sistema registra convite com token para definição de senha.
            </span>
          </div>
        </div>
      </article>
    </section>
  );
}
