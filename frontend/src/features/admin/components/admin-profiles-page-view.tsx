"use client";

import { FormEvent, useMemo, useState } from "react";
import { Eye, Pencil, ShieldCheck } from "lucide-react";

import { AdminProfileDto, ProfileStatus, UpsertAdminProfilePayload } from "@/features/admin/api/admin.api";
import { useAdminProfilesQuery } from "@/features/admin/hooks/use-admin-profiles-query";
import { useCreateAdminProfileMutation } from "@/features/admin/hooks/use-create-admin-profile-mutation";
import { useRoleMatrixQuery } from "@/features/admin/hooks/use-role-matrix-query";
import { useUpdateAdminProfileMutation } from "@/features/admin/hooks/use-update-admin-profile-mutation";
import { useUpdateAdminProfileStatusMutation } from "@/features/admin/hooks/use-update-admin-profile-status-mutation";
import { ApiError } from "@/shared/lib/http/http-client";
import { cn } from "@/shared/lib/utils";

type PermissionGroup = { id: string; title: string; items: { key: string; label: string; hint?: string }[] };
const permissionGroups: PermissionGroup[] = [
  { id: "clientes", title: "Clientes", items: [
    { key: "clients.dashboard.view", label: "Visualizar Dashboard de Clientes" },
    { key: "clients.portfolio.view", label: "Visualizar Carteira de Clientes" },
    { key: "clients.portfolio.evolution.view", label: "Visualizar Evolução da Carteira" },
    { key: "clients.dossier.view", label: "Abrir detalhe/dossiê do cliente" },
    { key: "clients.aging.import", label: "Importar AR Aging", hint: "Permissão sensível de carga de dados." },
    { key: "clients.imports.history.view", label: "Visualizar histórico de importações" }
  ]},
  { id: "credito", title: "Crédito", items: [
    { key: "credit.dashboard.view", label: "Visualizar Dashboard de Crédito" },
    { key: "credit.request.create", label: "Criar Solicitação de Crédito" },
    { key: "credit.requests.view", label: "Visualizar Solicitações" },
    { key: "credit.analysis.execute", label: "Executar Análise" },
    { key: "credit.dossier.edit", label: "Editar Dossiê" },
    { key: "credit.request.submit", label: "Submeter para Aprovação" },
    { key: "credit.approval.approve", label: "Aprovar Crédito", hint: "Concede papel de aprovador no fluxo." },
    { key: "credit.approval.reject", label: "Reprovar Crédito", hint: "Concede papel de aprovador no fluxo." },
    { key: "credit.policy.view", label: "Visualizar Política de Crédito" },
    { key: "credit.policy.manage", label: "Gerenciar Política de Crédito", hint: "Permissão crítica de governança." }
  ]},
  { id: "administracao", title: "Administração", items: [
    { key: "company:view", label: "Visualizar Empresa" },
    { key: "company:manage", label: "Gerenciar Empresa" },
    { key: "bu:manage", label: "Gerenciar BU's" },
    { key: "users:view", label: "Visualizar Usuários" },
    { key: "users:manage", label: "Gerenciar Usuários" },
    { key: "profiles:view", label: "Visualizar Perfis" },
    { key: "profiles:manage", label: "Gerenciar Perfis" },
    { key: "audit:view", label: "Visualizar Auditoria" }
  ]},
  { id: "escopo", title: "Escopo", items: [{ key: "scope:all_bu", label: "Acesso total às BU's", hint: "Escopo específico por BU continua no cadastro do usuário." }] }
];

function readPermissionsFromCookie() {
  if (typeof document === "undefined") return new Set<string>();
  const raw = document.cookie.split("; ").find((item) => item.startsWith("gcc_permissions="))?.split("=")[1];
  if (!raw) return new Set<string>();
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as string[];
    return new Set(parsed);
  } catch {
    return new Set<string>();
  }
}

export function AdminProfilesPageView() {
  const profileQuery = useAdminProfilesQuery();
  const matrixQuery = useRoleMatrixQuery();
  const createMutation = useCreateAdminProfileMutation();
  const updateMutation = useUpdateAdminProfileMutation();
  const updateStatusMutation = useUpdateAdminProfileStatusMutation();

  const [mode, setMode] = useState<"create" | "edit" | "view">("create");
  const [selectedProfile, setSelectedProfile] = useState<AdminProfileDto | null>(null);
  const [openEditor, setOpenEditor] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<ProfileStatus>("active");
  const [permissionKeys, setPermissionKeys] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<string | null>(null);

  const profiles = useMemo(() => profileQuery.data ?? [], [profileQuery.data]);
  const canManage = readPermissionsFromCookie().has("profiles:manage");

  const selectedCode = mode === "create" ? "Gerado automaticamente ao salvar" : (selectedProfile?.code ?? "");

  function openForCreate() {
    setMode("create");
    setSelectedProfile(null);
    setName("");
    setDescription("");
    setStatus("active");
    setPermissionKeys([]);
    setFeedback(null);
    setOpenEditor(true);
  }

  function openForProfile(profile: AdminProfileDto, nextMode: "edit" | "view") {
    setMode(nextMode);
    setSelectedProfile(profile);
    setName(profile.name);
    setDescription(profile.description ?? "");
    setStatus(profile.status);
    setPermissionKeys(profile.permission_keys);
    setFeedback(null);
    setOpenEditor(true);
  }

  function togglePermission(key: string) {
    setPermissionKeys((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    if (!name.trim()) return setFeedback("Informe um nome válido para o perfil.");
    if (permissionKeys.length === 0) return setFeedback("Selecione ao menos uma permissão.");

    const payload: UpsertAdminProfilePayload = {
      name: name.trim(),
      description: description.trim() || null,
      status,
      permission_keys: permissionKeys
    };
    try {
      if (mode === "edit" && selectedProfile) {
        await updateMutation.mutateAsync({ id: selectedProfile.id, payload });
        setFeedback("Perfil atualizado com sucesso.");
      } else {
        await createMutation.mutateAsync(payload);
        setFeedback("Perfil criado com sucesso.");
      }
      setOpenEditor(false);
    } catch (error) {
      setFeedback(error instanceof ApiError ? error.message : "Não foi possível salvar o perfil. Tente novamente.");
    }
  }

  async function toggleStatus(profile: AdminProfileDto) {
    setFeedback(null);
    try {
      const nextStatus: ProfileStatus = profile.status === "active" ? "inactive" : "active";
      await updateStatusMutation.mutateAsync({ id: profile.id, status: nextStatus });
      setFeedback(nextStatus === "active" ? "Perfil ativado com sucesso." : "Perfil desativado com sucesso.");
    } catch (error) {
      setFeedback(error instanceof ApiError ? error.message : "Não foi possível salvar o perfil. Tente novamente.");
    }
  }

  const allPermissions = useMemo(() => Array.from(new Set(profiles.flatMap((item) => item.permission_keys))).sort(), [profiles]);

  return (
    <section className="space-y-5">
      <header className="rounded-2xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Administração</p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">Gestão de Perfis</h1>
        <p className="mt-2 text-sm text-slate-600">Cadastre e gerencie os perfis de acesso utilizados na plataforma.</p>
      </header>

      <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-slate-900">Perfis cadastrados</h2>
          <button onClick={openForCreate} disabled={!canManage} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">Novo perfil</button>
        </div>
        {feedback ? <p className={cn("mb-3 text-sm", feedback.includes("sucesso") ? "text-emerald-700" : "text-rose-700")}>{feedback}</p> : null}
        {profileQuery.isLoading ? <p className="text-sm text-slate-500">Carregando perfis...</p> : null}
        {profileQuery.isError ? <p className="text-sm text-rose-700">Não foi possível carregar os perfis.</p> : null}
        {!profileQuery.isLoading && !profileQuery.isError ? (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.06em] text-slate-500">
                <tr><th className="px-3 py-2">Código</th><th className="px-3 py-2">Nome do Perfil</th><th className="px-3 py-2">Tipo</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Permissões</th><th className="px-3 py-2">Ações</th></tr>
              </thead>
              <tbody>
                {profiles.map((profile) => (
                  <tr key={profile.id} className="border-t border-slate-200 text-slate-800">
                    <td className="px-3 py-2 font-medium">{profile.code}</td><td className="px-3 py-2">{profile.name}</td><td className="px-3 py-2">{profile.type}</td>
                    <td className="px-3 py-2"><span className={cn("inline-flex rounded-full px-2 py-1 text-xs font-semibold", profile.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-700")}>{profile.status === "active" ? "Ativo" : "Inativo"}</span></td>
                    <td className="px-3 py-2">{profile.permission_keys.length}</td>
                    <td className="px-3 py-2"><div className="flex gap-2">
                      <button onClick={() => openForProfile(profile, "view")} className="rounded border border-slate-300 p-1.5 text-slate-700"><Eye className="h-4 w-4" /></button>
                      <button onClick={() => openForProfile(profile, "edit")} disabled={!canManage || profile.is_protected} className="rounded border border-slate-300 p-1.5 text-slate-700 disabled:opacity-40"><Pencil className="h-4 w-4" /></button>
                      <button onClick={() => void toggleStatus(profile)} disabled={!canManage || profile.is_protected} className="rounded border border-slate-300 px-2 text-xs disabled:opacity-40">{profile.status === "active" ? "Desativar" : "Ativar"}</button>
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </article>

      <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-slate-700" /><h2 className="text-base font-semibold text-slate-900">Visão de Governança</h2></div>
        {matrixQuery.isLoading ? <p className="text-sm text-slate-500">Carregando visão de governança...</p> : null}
        {matrixQuery.isError ? <p className="text-sm text-slate-500">Matriz técnica indisponível.</p> : null}
        {!matrixQuery.isLoading && !matrixQuery.isError && allPermissions.length > 0 ? <p className="text-sm text-slate-600">Matriz técnica mantida como apoio. O cadastro operacional permanece na seção principal.</p> : null}
      </article>

      {openEditor ? (
        <div className="fixed inset-0 z-40 bg-slate-900/40 p-4">
          <div className="mx-auto max-h-[95vh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-white p-6">
            <div className="mb-4 flex items-start justify-between"><div><h3 className="text-xl font-semibold text-slate-900">{mode === "create" ? "Novo Perfil" : mode === "edit" ? "Editar Perfil" : "Visualizar Perfil"}</h3><p className="text-sm text-slate-600">Código do Perfil: <span className="rounded bg-slate-100 px-2 py-1 font-semibold">{selectedCode}</span></p></div><button onClick={() => setOpenEditor(false)} className="text-sm text-slate-600">Fechar</button></div>
            <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1"><span className="text-sm font-medium text-slate-700">Nome do Perfil</span><input value={name} onChange={(event) => setName(event.target.value)} disabled={mode === "view"} className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm" /></label>
                <label className="space-y-1"><span className="text-sm font-medium text-slate-700">Status</span><select value={status} onChange={(event) => setStatus(event.target.value as ProfileStatus)} disabled={mode === "view"} className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"><option value="active">Ativo</option><option value="inactive">Inativo</option></select></label>
              </div>
              <label className="space-y-1"><span className="text-sm font-medium text-slate-700">Descrição</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} disabled={mode === "view"} className="min-h-20 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
              <div className="space-y-3">
                {permissionGroups.map((group) => {
                  const count = group.items.filter((item) => permissionKeys.includes(item.key)).length;
                  return (
                    <section key={group.id} className="rounded-xl border border-slate-200 p-4">
                      <div className="mb-2 flex items-center justify-between"><h4 className="font-semibold text-slate-900">{group.title}</h4><span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700">{count} selecionada(s)</span></div>
                      <div className="grid gap-2 md:grid-cols-2">
                        {group.items.map((item) => (
                          <label key={item.key} className="rounded-lg border border-slate-200 p-2 text-sm">
                            <div className="flex items-center gap-2"><input type="checkbox" checked={permissionKeys.includes(item.key)} disabled={mode === "view"} onChange={() => togglePermission(item.key)} /><span className="font-medium text-slate-800">{item.label}</span></div>
                            {item.hint ? <p className="mt-1 text-xs text-slate-500">{item.hint}</p> : null}
                          </label>
                        ))}
                      </div>
                    </section>
                  );
                })}
              </div>
              {feedback ? <p className={cn("text-sm", feedback.includes("sucesso") ? "text-emerald-700" : "text-rose-700")}>{feedback}</p> : null}
              {mode !== "view" ? <button type="submit" disabled={createMutation.isPending || updateMutation.isPending} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">{mode === "edit" ? "Salvar alterações" : "Criar perfil"}</button> : null}
            </form>
          </div>
        </div>
      ) : null}
    </section>
  );
}
