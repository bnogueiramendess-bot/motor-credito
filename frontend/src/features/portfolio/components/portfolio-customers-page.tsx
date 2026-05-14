"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Search } from "lucide-react";

import { PortfolioGroupCardDto } from "@/features/portfolio/api/contracts";
import { usePortfolioGroupsQuery } from "@/features/portfolio/hooks/use-portfolio-groups-query";
import { usePortfolioOpenInvoicesQuery } from "@/features/portfolio/hooks/use-portfolio-open-invoices-query";
import { usePortfolioSnapshotsQuery } from "@/features/portfolio/hooks/use-portfolio-snapshots-query";
import { toNumber } from "@/features/credit-analyses/utils/formatters";
import { formatCurrencyInThousands } from "@/features/dashboard/utils/dashboard-formatters";
import { EmptyState } from "@/shared/components/states/empty-state";
import { ErrorState } from "@/shared/components/states/error-state";
import { PermissionDeniedState } from "@/shared/components/states/permission-denied-state";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { getEffectivePermissions, hasPermission } from "@/shared/lib/auth/permissions";
import { openAgingImportDrawer } from "@/shared/lib/events";
import { cn } from "@/shared/lib/utils";

type SortOption = "open_desc" | "overdue_desc" | "net_exposure_desc" | "consumed_limit_desc";
const buOptions = ["Todos", "Additive", "Fertilizer", "Additive Intl", "Nao informado"];
const sortOptions: Array<{ value: SortOption; label: string }> = [
  { value: "open_desc", label: "Maior valor em aberto" },
  { value: "overdue_desc", label: "Maior overdue" },
  { value: "net_exposure_desc", label: "Maior exposicao liquida" },
  { value: "consumed_limit_desc", label: "Maior limite disponivel" }
];

function formatCnpj(value: string | null | undefined): string {
  if (!value) return "Nao informado";
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 14) return value;
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

function formatMoney(value: number | string | null | undefined): string {
  const parsed = toNumber(value);
  if (parsed === null) return "Nao informado";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(parsed);
}

function formatMoneyShort(value: number | string | null | undefined): string {
  return formatCurrencyInThousands(value);
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "Nao informado";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "Nao informado";
  return new Intl.DateTimeFormat("pt-BR").format(date);
}

function statusLabel(status: string | undefined): string {
  if (status === "overdue") return "Atrasado";
  if (status === "at_risk") return "Em risco";
  if (status === "uncovered") return "Sem cobertura";
  return "Em dia";
}

function statusClasses(status: string | undefined): string {
  if (status === "overdue") return "bg-orange-50 text-orange-700 border-orange-200";
  if (status === "at_risk") return "bg-amber-50 text-amber-700 border-amber-200";
  if (status === "uncovered") return "bg-slate-100 text-slate-700 border-slate-300";
  return "bg-emerald-50 text-emerald-700 border-emerald-200";
}

function invoiceStatusLabel(status: string | undefined): string {
  return status === "overdue" ? "Vencida" : "Em dia";
}

function LimitConsumptionBar({ consumed, total, overLimit }: { consumed: number; total: number; overLimit: boolean }) {
  const percentage = total > 0 ? Math.min((consumed / total) * 100, 100) : 0;
  return (
    <div className="h-2 w-full rounded-full bg-[#e2e8f0]">
      <div
        className={cn("h-2 rounded-full", overLimit ? "bg-rose-600" : "bg-[#0f766e]")}
        style={{ width: `${overLimit ? 100 : percentage}%` }}
      />
    </div>
  );
}

function PortfolioGroupInvoices({ economicGroup, snapshotId }: { economicGroup: string; snapshotId: string }) {
  const query = usePortfolioOpenInvoicesQuery({ economicGroup, snapshotId, enabled: true });
  if (query.isLoading) return <div className="py-3 text-sm text-[#475569]">Carregando NFs em aberto...</div>;
  if (query.isError) return <p className="py-3 text-sm text-rose-700">Nao foi possivel carregar as NFs em aberto.</p>;
  if (!query.data || query.data.length === 0) return <p className="py-3 text-sm text-[#64748b]">Nenhuma NF em aberto encontrada para este cliente/grupo.</p>;
  const totalOpenAmount = query.data.reduce((acc, item) => acc + (toNumber(item.open_amount) ?? 0), 0);
  const totalDocuments = query.data.filter((item) => Boolean(item.document_number && item.document_number.trim())).length;

  return (
    <div className="mt-3 overflow-x-auto rounded-xl border border-[#e2e8f0]">
      <table className="min-w-full text-sm">
        <thead className="bg-[#f8fafc] text-left text-xs uppercase tracking-[0.04em] text-[#64748b]">
          <tr>
            <th className="px-3 py-2">Razao social</th>
            <th className="px-3 py-2">CNPJ</th>
            <th className="px-3 py-2">NF / Documento</th>
            <th className="px-3 py-2">Natureza</th>
            <th className="px-3 py-2">Valor em aberto</th>
            <th className="px-3 py-2">Data de vencimento</th>
            <th className="px-3 py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {query.data.map((item, index) => (
            <tr key={`${item.document_number ?? "nf"}-${index}`} className="border-t border-[#e2e8f0] text-[#0f172a]">
              <td className="px-3 py-2">{item.customer_name ?? "Nao informado"}</td>
              <td className="px-3 py-2">{formatCnpj(item.cnpj)}</td>
              <td className="px-3 py-2">{item.document_number ?? "Nao informado"}</td>
              <td className="px-3 py-2">{item.data_total_col_m ?? "Nao informado"}</td>
              <td className="px-3 py-2 font-medium">{formatMoney(item.open_amount)}</td>
              <td className="px-3 py-2">{formatDate(item.due_date)}</td>
              <td className="px-3 py-2">{invoiceStatusLabel(item.status)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-[#cbd5e1] bg-[#f8fafc] font-semibold text-[#0f172a]">
            <td className="px-3 py-2">Total</td>
            <td className="px-3 py-2">-</td>
            <td className="px-3 py-2">{totalDocuments}</td>
            <td className="px-3 py-2">-</td>
            <td className="px-3 py-2">{formatMoney(totalOpenAmount)}</td>
            <td className="px-3 py-2">-</td>
            <td className="px-3 py-2">-</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function PortfolioGroupCard({ group, snapshotId }: { group: PortfolioGroupCardDto; snapshotId: string }) {
  const [expanded, setExpanded] = useState(false);
  const creditLimit = toNumber(group.credit_limit_amount) ?? 0;
  const available = toNumber(group.credit_limit_available) ?? 0;
  const openAmount = toNumber(group.total_open_amount) ?? 0;
  const overLimit = available < 0;
  const canShowBar = creditLimit > 0 || overLimit;
  const barTotal = creditLimit > 0 ? creditLimit : Math.max(openAmount, 1);

  return (
    <article className="rounded-2xl border border-[#dbe3ef] bg-white p-4 shadow-[0_6px_20px_rgba(15,23,42,0.04)] transition hover:shadow-[0_10px_30px_rgba(15,23,42,0.08)]">
      <div className="grid gap-4 lg:grid-cols-[1.8fr_1fr_1fr_1fr_auto] lg:items-start">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-[#0f172a]">{group.display_name}</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge className="border-[#dbeafe] bg-[#eff6ff] text-[#1d4ed8]">{group.bu ?? "Nao informado"}</Badge>
            <Badge className={cn("border", statusClasses(group.status))}>{statusLabel(group.status)}</Badge>
            {group.is_litigation ? <Badge className="border-rose-200 bg-rose-50 text-rose-700">Cliente em Litigio</Badge> : null}
          </div>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.04em] text-[#64748b]">Valor em aberto</p>
          <p className="mt-1 text-lg font-semibold text-[#0f172a]">{formatMoneyShort(group.total_open_amount)}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.04em] text-[#64748b]">Limite Total Aprovado</p>
          <p className="mt-1 text-sm font-semibold text-[#0f172a]">{formatMoneyShort(creditLimit)}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.04em] text-[#64748b]">Limite Disponivel</p>
          <p className="mt-1 text-sm font-semibold text-[#0f172a]">{formatMoneyShort(available)}</p>
          {canShowBar ? <div className="mt-2"><LimitConsumptionBar consumed={openAmount} total={barTotal} overLimit={overLimit} /></div> : null}
        </div>
        <div className="lg:justify-self-end">
          <Button variant="outline" className="w-full lg:w-auto" onClick={() => setExpanded((prev) => !prev)}>
            {expanded ? <span className="inline-flex items-center gap-2"><ChevronUp className="h-4 w-4" />Ocultar NFs em aberto</span> : <span className="inline-flex items-center gap-2"><ChevronDown className="h-4 w-4" />Mostrar NFs em aberto</span>}
          </Button>
        </div>
      </div>
      {expanded ? <PortfolioGroupInvoices economicGroup={group.economic_group} snapshotId={snapshotId} /> : null}
    </article>
  );
}

export function PortfolioCustomersPage() {
  const permissions = getEffectivePermissions();
  const canViewPortfolio = hasPermission("clients.portfolio.view", permissions);
  const canImportAging = hasPermission("clients.aging.import", permissions);
  const snapshotsQuery = usePortfolioSnapshotsQuery();
  const [selectedSnapshotId, setSelectedSnapshotId] = useState("current");
  const [search, setSearch] = useState("");
  const [bu, setBu] = useState("Todos");
  const [status, setStatus] = useState("Todos");
  const [sortBy, setSortBy] = useState<SortOption>("open_desc");
  const query = usePortfolioGroupsQuery({ bu: bu === "Todos" ? undefined : bu, q: search || undefined, snapshot_id: selectedSnapshotId });
  const selectedSnapshot = useMemo(() => {
    const snapshots = snapshotsQuery.data ?? [];
    if (selectedSnapshotId === "current") {
      return snapshots.find((item) => item.is_current) ?? null;
    }
    return snapshots.find((item) => item.id === selectedSnapshotId) ?? null;
  }, [snapshotsQuery.data, selectedSnapshotId]);

  const filteredGroups = useMemo(() => {
    const base = query.data ?? [];
    const statusFiltered = status === "Todos" ? base : base.filter((item) => statusLabel(item.status) === status);
    return [...statusFiltered].sort((a, b) => {
      const openA = toNumber(a.total_open_amount) ?? 0;
      const openB = toNumber(b.total_open_amount) ?? 0;
      const overdueA = toNumber(a.total_overdue_amount) ?? 0;
      const overdueB = toNumber(b.total_overdue_amount) ?? 0;
      const exposureA = toNumber(a.net_exposure_amount) ?? 0;
      const exposureB = toNumber(b.net_exposure_amount) ?? 0;
      const consumedA = toNumber(a.credit_limit_available) ?? 0;
      const consumedB = toNumber(b.credit_limit_available) ?? 0;
      if (sortBy === "overdue_desc") return overdueB - overdueA;
      if (sortBy === "net_exposure_desc") return exposureB - exposureA;
      if (sortBy === "consumed_limit_desc") return consumedB - consumedA;
      return openB - openA;
    });
  }, [query.data, status, sortBy]);

  const isInitialPortfolioImplantation =
    !query.isLoading &&
    !query.isError &&
    filteredGroups.length === 0 &&
    (snapshotsQuery.data?.length ?? 0) === 0 &&
    !search.trim() &&
    bu === "Todos" &&
    status === "Todos";

  if (!canViewPortfolio) {
    return <PermissionDeniedState />;
  }

  return (
    <section className="space-y-4">
      <header className="rounded-2xl border border-[#dde5f0] bg-gradient-to-br from-white via-[#fbfdff] to-[#f7faff] px-5 py-5 shadow-[0_8px_24px_rgba(15,23,42,0.06)] xl:px-7 xl:py-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-[#7b8797]">GestÃ£o de Carteira</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-[-0.015em] text-[#0f172a] xl:text-[32px]">Carteira de Clientes</h1>
            <p className="mt-3 max-w-2xl text-sm text-[#5b6b7f]">Base consolidada dos clientes importados no Ãºltimo AR Aging.</p>
          </div>

          <div className="w-full self-center rounded-xl border border-[#e2e8f0] bg-white/95 p-4 lg:w-[360px] lg:self-center">
            <label className="block text-xs font-semibold uppercase tracking-[0.08em] text-[#64748b]">VisÃ£o da Carteira</label>
            <select
              value={selectedSnapshotId}
              onChange={(event) => setSelectedSnapshotId(event.target.value)}
              className="mt-2 h-10 w-full rounded-md border border-[#dbe3ef] bg-white px-3 text-sm text-[#0f172a]"
            >
              <option value="current">Atual</option>
              {(snapshotsQuery.data ?? []).filter((item) => !item.is_current).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            <div className="mt-3 inline-flex rounded-full border border-[#dbe3ef] bg-[#f8fafc] px-3 py-1 text-xs text-[#475569]">
              {selectedSnapshotId === "current" ? "VisÃ£o atual da carteira" : `Snapshot histÃ³rico Â· ${selectedSnapshot?.label ?? selectedSnapshotId}`}
            </div>
            <p className="mt-2 text-xs font-medium text-[#475569]">Base Aging vigente: {formatDate(selectedSnapshot?.base_date)}</p>
          </div>
        </div>
      </header>
      <div className="rounded-2xl border border-[#e2e8f0] bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-[#64748b]" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por cliente, razao social, grupo ou CNPJ" className="h-10 w-full rounded-lg border border-[#dbe3ef] bg-white pl-9 pr-3 text-sm text-[#0f172a] outline-none focus:border-[#60a5fa]" />
          </label>
          <select value={bu} onChange={(event) => setBu(event.target.value)} className="h-10 rounded-lg border border-[#dbe3ef] px-3 text-sm">{buOptions.map((item) => <option key={item}>{item}</option>)}</select>
          <select value={status} onChange={(event) => setStatus(event.target.value)} className="h-10 rounded-lg border border-[#dbe3ef] px-3 text-sm">{["Todos", "Em dia", "Atrasado", "Em risco", "Sem cobertura"].map((item) => <option key={item}>{item}</option>)}</select>
          <select value={sortBy} onChange={(event) => setSortBy(event.target.value as SortOption)} className="h-10 rounded-lg border border-[#dbe3ef] px-3 text-sm">{sortOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
        </div>
      </div>

      {query.isLoading ? <div className="space-y-3">{[...Array.from({ length: 4 })].map((_, index) => <div key={index} className="rounded-2xl border border-[#e2e8f0] bg-white p-4"><Skeleton className="h-6 w-1/3" /><Skeleton className="mt-3 h-5 w-full" /></div>)}</div> : null}
      {query.isError ? <ErrorState title="Falha ao carregar carteira" description="Nao foi possivel carregar os grupos da carteira." onRetry={query.refetch} /> : null}
      {!query.isLoading && !query.isError && filteredGroups.length === 0 && isInitialPortfolioImplantation ? (
        <EmptyState
          title="Ambiente pronto para a primeira importaÃ§Ã£o AR Aging"
          description="Importe o relatÃ³rio AR Aging para iniciar a gestÃ£o da carteira de clientes, acompanhar exposiÃ§Ã£o, inadimplÃªncia, limites e snapshots histÃ³ricos."
          actionLabel={canImportAging ? "Importar AR Aging" : undefined}
          onActionClick={canImportAging ? openAgingImportDrawer : undefined}
        />
      ) : null}
      {!query.isLoading && !query.isError && filteredGroups.length === 0 && !isInitialPortfolioImplantation ? <EmptyState title="Nenhum grupo encontrado" description="Ajuste os filtros para visualizar grupos da carteira." /> : null}
      {!query.isLoading && !query.isError && filteredGroups.length > 0 ? <div className="space-y-3">{filteredGroups.map((group) => <PortfolioGroupCard key={group.economic_group} group={group} snapshotId={selectedSnapshotId} />)}</div> : null}
    </section>
  );
}


