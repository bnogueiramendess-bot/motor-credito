"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Building2, ChevronDown, FileUp, Settings, Users } from "lucide-react";

import { resetOperationalData } from "@/features/admin/api/admin.api";
import { AgingImportDrawer } from "@/features/portfolio/components/aging-import-drawer";
import { OPEN_AGING_IMPORT_DRAWER_EVENT } from "@/shared/lib/events";
import { ApiError } from "@/shared/lib/http/http-client";
import { getCurrentUserDisplayName, getCurrentUserLoginName } from "@/shared/lib/auth/current-user";
import { cn } from "@/shared/lib/utils";

type NavItem = {
  type?: "link" | "divider";
  href?: string;
  label?: string;
};

type NavGroup = {
  id: string;
  label: string;
  activePrefix: string;
  items: NavItem[];
};

const navGroups: NavGroup[] = [
  {
    id: "clientes",
    label: "Clientes",
    activePrefix: "/clientes",
    items: [
      { type: "link", href: "/clientes/dashboard", label: "Dashboard" },
      { type: "link", href: "/clientes/carteira", label: "Carteira de Clientes" },
      { type: "link", href: "/clientes/evolucao", label: "Evolução da Carteira" }
    ]
  },
  {
    id: "motor-credito",
    label: "Motor de Crédito",
    activePrefix: "/motor-credito",
    items: [
      { type: "link", href: "/motor-credito/dashboard", label: "Dashboard" },
      { type: "link", href: "/motor-credito/regras", label: "Regras" },
      { type: "divider" },
      { type: "link", href: "/analises/nova", label: "+ Nova análise" },
      { type: "link", href: "/analises/monitor", label: "Monitor de Solicitações" },
      { type: "link", href: "/analises", label: "Localizar análise" }
    ]
  }
];

function getPermissionsFromCookie() {
  if (typeof document === "undefined") return [] as string[];
  const cookie = document.cookie.split("; ").find((item) => item.startsWith("gcc_permissions="));
  if (!cookie) return [];
  const value = cookie.split("=")[1];
  if (!value) return [];
  try {
    return JSON.parse(decodeURIComponent(value)) as string[];
  } catch {
    return [];
  }
}

function getRoleFromCookie() {
  if (typeof document === "undefined") return "";
  const cookie = document.cookie.split("; ").find((item) => item.startsWith("gcc_user_role="));
  if (!cookie) return "";
  const value = cookie.split("=")[1];
  if (!value) return "";
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return value.trim();
  }
}

function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function isMotorCreditoRoute(pathname: string) {
  return pathname.startsWith("/motor-credito") || pathname.startsWith("/analises") || pathname.startsWith("/dados-externos");
}

function isSubmenuItemActive(pathname: string, groupId: string, href: string) {
  if (groupId === "motor-credito") {
    if (href === "/analises/nova") return pathname === "/analises/nova";
    if (href === "/analises/monitor") return pathname === "/analises/monitor";
    if (href === "/analises") return pathname === "/analises" || /^\/analises\/\d+$/.test(pathname);
  }
  return isActivePath(pathname, href);
}

function resolveTopbarMeta(pathname: string): { title: string; subtitle: string } {
  if (pathname.startsWith("/clientes/dashboard")) {
    return { title: "Clientes · Dashboard", subtitle: "Visão de clientes" };
  }
  if (pathname.startsWith("/clientes/carteira")) {
    return { title: "Clientes · Carteira de Clientes", subtitle: "Consulta operacional da carteira" };
  }
  if (pathname.startsWith("/clientes/evolucao")) {
    return { title: "Clientes · Evolução da Carteira", subtitle: "Comparação entre fechamentos" };
  }
  if (pathname.startsWith("/motor-credito/dashboard") || pathname.startsWith("/dashboard")) {
    return { title: "Motor de Crédito · Dashboard", subtitle: "Visão executiva" };
  }
  if (pathname.startsWith("/motor-credito/regras") || pathname.startsWith("/regras")) {
    return { title: "Motor de Crédito · Regras", subtitle: "Políticas e critérios" };
  }
  if (pathname.startsWith("/dados-externos")) {
    return { title: "Dados Externos", subtitle: "Evidências da análise" };
  }
  if (pathname.startsWith("/analises/nova")) {
    return { title: "Nova Análise", subtitle: "Cadastro e consolidação" };
  }
  if (pathname.startsWith("/analises/monitor")) {
    return { title: "Monitor de Solicitações", subtitle: "Acompanhamento operacional do workflow" };
  }
  if (/^\/analises\/\d+$/.test(pathname)) {
    return { title: "Análise de Crédito", subtitle: "Detalhamento da decisão" };
  }
  return { title: "Análises de Crédito", subtitle: "Acompanhamento operacional" };
}

function toFirstAndSecondName(fullName: string): string {
  const normalized = fullName
    .trim()
    .toLowerCase();
  if (
    !normalized ||
    normalized === "usuário não identificado" ||
    normalized === "usuario nao identificado" ||
    normalized === "usuário nao identificado"
  ) {
    return "Usuário";
  }
  const chunks = fullName
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (chunks.length === 0) return "Usuário";
  if (chunks.length === 1) return chunks[0];
  return `${chunks[0]} ${chunks[1]}`;
}

function toInitials(name: string): string {
  const chunks = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (chunks.length === 0) return "US";
  if (chunks.length === 1) return chunks[0].slice(0, 2).toUpperCase();
  return `${chunks[0][0] ?? ""}${chunks[1][0] ?? ""}`.toUpperCase();
}

export function AppTopbar() {
  const router = useRouter();
  const pathname = usePathname();
  const meta = useMemo(() => resolveTopbarMeta(pathname), [pathname]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [currentUserRole, setCurrentUserRole] = useState("");
  const [currentUserName, setCurrentUserName] = useState("Usuário");
  const [currentLoginName, setCurrentLoginName] = useState("Usuário");

  useEffect(() => {
    setPermissions(getPermissionsFromCookie());
    setCurrentUserRole(getRoleFromCookie());
    setCurrentUserName(toFirstAndSecondName(getCurrentUserDisplayName()));
    setCurrentLoginName(getCurrentUserLoginName());
  }, []);

  const canManageCompany = permissions.includes("company:manage");
  const canManageBusinessUnits = permissions.includes("bu:manage");
  const canManageUsers = permissions.includes("users:manage");
  const canViewProfiles = permissions.includes("profiles:view");
  const canResetBase = currentUserRole === "administrador_master";

  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const [isImportDrawerOpen, setIsImportDrawerOpen] = useState(false);
  const [isSettingsMenuOpen, setIsSettingsMenuOpen] = useState(false);
  const [isResettingBase, setIsResettingBase] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isAdminMenuOpen, setIsAdminMenuOpen] = useState(false);
  const [isUsersMenuOpen, setIsUsersMenuOpen] = useState(false);
  const menusRef = useRef<HTMLDivElement | null>(null);

  const openGroup = navGroups.find((group) => group.id === openGroupId) ?? null;

  function toggleGroup(groupId: string) {
    setOpenGroupId((current) => (current === groupId ? null : groupId));
  }

  useEffect(() => {
    const openDrawer = () => setIsImportDrawerOpen(true);
    window.addEventListener(OPEN_AGING_IMPORT_DRAWER_EVENT, openDrawer);
    return () => window.removeEventListener(OPEN_AGING_IMPORT_DRAWER_EVENT, openDrawer);
  }, []);

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (!menusRef.current) return;
      if (event.target instanceof Node && !menusRef.current.contains(event.target)) {
        setIsAdminMenuOpen(false);
        setIsUsersMenuOpen(false);
        setIsSettingsMenuOpen(false);
      }
    }

    window.addEventListener("mousedown", handleOutsideClick);
    return () => window.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  async function handleResetOperationalData() {
    setIsSettingsMenuOpen(false);
    const confirmation = window.prompt('Esta ação limpará todos os dados operacionais. Digite "Confirmo" para continuar:');
    if (confirmation !== "Confirmo") return;

    setIsResettingBase(true);
    try {
      const response = await resetOperationalData("RESET_OPERATIONAL_DATA");
      const defaultUserInfo = response.default_master_user
        ? `\nUsuario master padrao: ${response.default_master_user.email}\nSenha padrao: ${response.default_master_user.password}`
        : "";
      window.alert(`Reset concluído com sucesso. Registros removidos: ${response.total_deleted}.${defaultUserInfo}`);
      window.location.reload();
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Falha ao executar reset operacional.";
      window.alert(message);
    } finally {
      setIsResettingBase(false);
    }
  }

  async function handleLogout() {
    setIsSettingsMenuOpen(false);
    setIsLoggingOut(true);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) {
        window.alert("Nao foi possivel encerrar a sessao. Tente novamente.");
        setIsLoggingOut(false);
        return;
      }
      router.push("/login");
      router.refresh();
    } catch {
      window.alert("Nao foi possivel encerrar a sessao. Tente novamente.");
      setIsLoggingOut(false);
    }
  }

  return (
    <header className="sticky top-0 z-30 border-b border-[#334155] bg-[#0B132B] shadow-[0_3px_14px_rgba(2,6,23,0.22)]">
      <div className="mx-auto w-full max-w-[1520px] px-4 sm:px-6 lg:px-8">
        <div className="flex h-[82px] items-center gap-4">
          <div className="min-w-0 shrink-0 pr-1">
            <p className="truncate text-lg font-semibold tracking-[-0.01em] text-[#FFFFFF]">Gestão de Carteira de Clientes</p>
            <p className="truncate text-[11px] font-medium uppercase tracking-[0.08em] text-[#CBD5E1]">{meta.title}</p>
          </div>

          <div className="hidden h-8 w-px bg-[#334155] lg:block" aria-hidden="true" />

          <nav aria-label="Navegação principal" className="hidden min-w-0 flex-1 items-center gap-3 lg:flex">
            {navGroups.map((group) => {
              const menuId = `topbar-submenu-${group.id}`;
              const isOpen = openGroupId === group.id;
              const groupActive = group.id === "motor-credito" ? isMotorCreditoRoute(pathname) : pathname.startsWith(group.activePrefix);

              return (
                <button
                  key={group.id}
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={menuId}
                  onClick={() => toggleGroup(group.id)}
                  className={cn(
                    "inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#93C5FD] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B132B]",
                    groupActive
                      ? "bg-[#1E3A8A] text-white shadow-[0_1px_4px_rgba(30,58,138,0.36)]"
                      : "text-[#E2E8F0] hover:bg-[#334155] hover:text-white"
                  )}
                >
                  {group.label}
                  <ChevronDown
                    className={cn("h-3 w-3 transition-transform", isOpen ? "rotate-180" : "rotate-0")}
                    aria-hidden="true"
                  />
                </button>
              );
            })}
          </nav>

          <div className="hidden h-8 w-px bg-[#334155] xl:block" aria-hidden="true" />

          <div ref={menusRef} className="ml-auto flex items-center gap-2 sm:gap-3">
            {(canManageCompany || canManageBusinessUnits) ? (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setIsAdminMenuOpen((current) => !current);
                    setIsUsersMenuOpen(false);
                    setIsSettingsMenuOpen(false);
                  }}
                  title="Empresa"
                  aria-label="Empresa"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[#E2E8F0]/40 bg-white/5 text-[#E2E8F0] transition hover:bg-white/10"
                >
                  <Building2 className="h-4 w-4" />
                </button>
                {isAdminMenuOpen ? (
                  <div className="absolute right-0 top-12 z-50 min-w-[220px] rounded-lg border border-[#dbe3ef] bg-white p-1.5 shadow-[0_8px_24px_rgba(15,23,42,0.16)]">
                    {canManageCompany ? (
                      <Link href="/admin/company" className="block rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
                        Cadastro da Empresa
                      </Link>
                    ) : null}
                    {canManageBusinessUnits ? (
                      <Link href="/admin/business-units" className="block rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
                        Cadastro de BU&apos;s
                      </Link>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            {canManageUsers ? (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setIsUsersMenuOpen((current) => !current);
                    setIsAdminMenuOpen(false);
                    setIsSettingsMenuOpen(false);
                  }}
                  title="Usuários"
                  aria-label="Usuários"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[#E2E8F0]/40 bg-white/5 text-[#E2E8F0] transition hover:bg-white/10"
                >
                  <Users className="h-4 w-4" />
                </button>
                {isUsersMenuOpen ? (
                  <div className="absolute right-0 top-12 z-50 min-w-[220px] rounded-lg border border-[#dbe3ef] bg-white p-1.5 shadow-[0_8px_24px_rgba(15,23,42,0.16)]">
                    <Link href="/admin/users" className="block rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
                      Gestão de Usuários
                    </Link>
                    {canViewProfiles ? (
                      <Link href="/admin/profiles" className="block rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
                        Gestão de Perfis
                      </Link>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setIsSettingsMenuOpen((current) => !current);
                  setIsAdminMenuOpen(false);
                  setIsUsersMenuOpen(false);
                }}
                title="Configurações"
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[#E2E8F0]/40 bg-white/5 text-[#E2E8F0] transition hover:bg-white/10"
                aria-label="Configurações do sistema"
              >
                <Settings className="h-4 w-4" />
              </button>
              {isSettingsMenuOpen ? (
                <div className="absolute right-0 top-12 z-40 min-w-[220px] rounded-lg border border-[#dbe3ef] bg-white p-1.5 shadow-[0_8px_24px_rgba(15,23,42,0.16)]">
                  <button
                    type="button"
                    onClick={() => void handleLogout()}
                    disabled={isLoggingOut}
                    className="flex w-full items-center rounded-md px-3 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isLoggingOut ? "Saindo..." : "Logoff"}
                  </button>
                  {canResetBase ? (
                    <button
                      type="button"
                      onClick={() => void handleResetOperationalData()}
                      disabled={isResettingBase}
                      className="flex w-full items-center rounded-md px-3 py-2 text-left text-sm font-medium text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isResettingBase ? "Resetando base..." : "Reset da Base"}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>

            <button
              type="button"
              onClick={() => setIsImportDrawerOpen(true)}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#E2E8F0]/40 bg-white/5 px-3.5 text-sm font-medium text-[#E2E8F0] transition hover:bg-white/10"
            >
              <FileUp className="h-4 w-4" />
              Importação
            </button>

            <div className="hidden items-center gap-2 rounded-xl border border-[#E2E8F0]/25 bg-white/5 px-2.5 py-1.5 xl:flex">
              <div className="text-right text-xs text-[#CBD5E1]">
                <p className="font-medium text-[#E2E8F0]">{currentUserName}</p>
                <p>{currentLoginName}</p>
              </div>
              <div className="flex h-8 w-8 items-center justify-center rounded-full border border-[#E2E8F0]/35 bg-[#1E3A8A] text-[11px] font-semibold text-white">{toInitials(currentUserName)}</div>
            </div>

            <div className="flex h-9 w-9 items-center justify-center rounded-full border border-[#E2E8F0]/35 bg-[#1E3A8A] text-xs font-semibold text-white xl:hidden">{toInitials(currentUserName)}</div>
          </div>
        </div>

        <div
          id={openGroup ? `topbar-submenu-${openGroup.id}` : undefined}
          className={cn(
            "hidden overflow-hidden border-t border-[#334155]/80 transition-all duration-200 lg:block",
            openGroup ? "max-h-16 py-2 opacity-100" : "max-h-0 border-t-transparent py-0 opacity-0"
          )}
        >
          {openGroup ? (
            <nav aria-label={`Submenu ${openGroup.label}`} className="flex items-center gap-2 overflow-x-auto whitespace-nowrap pr-1">
              {openGroup.items.map((item, index) => {
                if (item.type === "divider") {
                  return <span key={`divider-${openGroup.id}-${index}`} className="mx-1 h-4 w-px bg-[#334155]" aria-hidden="true" />;
                }

                if (!item.href || !item.label) return null;
                const active = isSubmenuItemActive(pathname, openGroup.id, item.href);

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "inline-flex h-8 items-center rounded-md px-3 text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#93C5FD] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B132B]",
                      active
                        ? "bg-[#1E3A8A]/70 text-white shadow-[inset_0_0_0_1px_rgba(147,197,253,0.25)]"
                        : "text-[#CBD5E1] hover:bg-[#22345F] hover:text-white"
                    )}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          ) : null}
        </div>
      </div>
      <AgingImportDrawer open={isImportDrawerOpen} onOpenChange={setIsImportDrawerOpen} />
    </header>
  );
}

