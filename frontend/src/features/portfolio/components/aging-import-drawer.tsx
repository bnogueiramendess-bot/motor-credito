"use client";

import { ChangeEvent, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileUp, Loader2, UploadCloud, X } from "lucide-react";

import { AgingImportItem, createAgingImport } from "@/features/portfolio/api/aging-imports.api";
import { useAgingImportsHistoryQuery } from "@/features/portfolio/hooks/use-aging-imports-history-query";
import { getCurrentUserDisplayName } from "@/shared/lib/auth/current-user";
import { ApiError } from "@/shared/lib/http/http-client";
import { cn } from "@/shared/lib/utils";

type AgingImportDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

async function toBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function formatDate(value: string) {
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat("pt-BR").format(parsed);
}

function formatDateTime(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(parsed);
}

function formatFileSize(bytes: number) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function statusLabel(status: AgingImportItem["status"]) {
  if (status === "valid") return "Válida";
  if (status === "valid_with_warnings") return "Válida com alertas";
  if (status === "error") return "Erro";
  return "Processando";
}

function statusTone(status: AgingImportItem["status"]) {
  if (status === "valid") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "valid_with_warnings") return "bg-amber-50 text-amber-700 border-amber-200";
  if (status === "error") return "bg-rose-50 text-rose-700 border-rose-200";
  return "bg-slate-50 text-slate-700 border-slate-200";
}

export function AgingImportDrawer({ open, onOpenChange }: AgingImportDrawerProps) {
  const queryClient = useQueryClient();
  const currentUserName = useMemo(() => getCurrentUserDisplayName(), []);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [warningMessage, setWarningMessage] = useState<string | null>(null);
  const [duplicateMessage, setDuplicateMessage] = useState<string | null>(null);
  const [drawerErrorMessage, setDrawerErrorMessage] = useState<string | null>(null);
  const [lastPayload, setLastPayload] = useState<{
    original_filename: string;
    mime_type: string;
    file_size: number;
    file_content_base64: string;
    imported_by: string;
  } | null>(null);
  const [toastState, setToastState] = useState<{ message: string; tone: "success" | "error" } | null>(null);

  const historyQuery = useAgingImportsHistoryQuery(10);
  const sortedHistory = useMemo(
    () => (historyQuery.data ?? []).slice().sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [historyQuery.data]
  );
  const currentBaseId = useMemo(
    () => sortedHistory.find((entry) => entry.status === "valid" || entry.status === "valid_with_warnings")?.id ?? null,
    [sortedHistory]
  );

  const importMutation = useMutation({
    mutationFn: createAgingImport,
    onSuccess: async (result) => {
      const warnings = Array.isArray(result.warnings) ? result.warnings : [];
      const olderBaseWarning = warnings.find((item) => item.includes("mais antiga que a atual"));
      setWarningMessage(olderBaseWarning ?? null);
      setDuplicateMessage(null);
      setDrawerErrorMessage(null);
      setToastState({ message: "Base Aging atualizada com sucesso.", tone: "success" });
      setTimeout(() => setToastState(null), 3500);

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["portfolio-aging-latest"] }),
        queryClient.invalidateQueries({ queryKey: ["portfolio-aging-alerts-latest"] }),
        queryClient.invalidateQueries({ queryKey: ["portfolio-aging-movements-latest"] }),
        queryClient.invalidateQueries({ queryKey: ["ar-aging-imports-history"] })
      ]);
    }
  });

  function resetMessages() {
    setWarningMessage(null);
    setDuplicateMessage(null);
    setDrawerErrorMessage(null);
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setSelectedFile(file);
    resetMessages();
  }

  async function submitImport(overwrite: boolean) {
    if (!selectedFile) {
      return;
    }

    const payload = {
      original_filename: selectedFile.name,
      mime_type: selectedFile.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      file_size: selectedFile.size,
      file_content_base64: await toBase64(selectedFile),
      imported_by: currentUserName
    };

    setLastPayload(payload);

    try {
      await importMutation.mutateAsync({
        ...payload,
        overwrite
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setDuplicateMessage("Já existe uma base importada para esta data.");
        setDrawerErrorMessage("Já existe uma base importada para esta data.");
        setToastState({ message: "Já existe uma base importada para esta data.", tone: "error" });
        return;
      }
      const message = error instanceof Error ? error.message : "Falha ao importar base Aging AR.";
      setDuplicateMessage(message);
      setDrawerErrorMessage(message);
      setToastState({ message, tone: "error" });
    }
  }

  async function handleOverwrite() {
    if (!lastPayload) {
      return;
    }
    try {
      await importMutation.mutateAsync({
        ...lastPayload,
        overwrite: true
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao sobrescrever base.";
      setDuplicateMessage(message);
      setDrawerErrorMessage(message);
      setToastState({ message, tone: "error" });
    }
  }

  if (!open) {
    return null;
  }

  return (
    <>
      {toastState ? (
        <div
          className={cn(
            "fixed right-6 top-6 z-[70] rounded-lg px-4 py-2 text-sm font-medium shadow-lg",
            toastState.tone === "success" ? "border border-emerald-200 bg-emerald-50 text-emerald-700" : "border border-rose-200 bg-rose-50 text-rose-700"
          )}
        >
          {toastState.message}
        </div>
      ) : null}

      <div className="fixed inset-0 z-[60] bg-[#020617]/50" onClick={() => onOpenChange(false)} />
      <aside className="fixed right-0 top-0 z-[61] h-screen w-full max-w-[560px] overflow-y-auto border-l border-[#cbd5e1] bg-white shadow-[0_8px_30px_rgba(15,23,42,0.24)]">
        <div className="flex items-center justify-between border-b border-[#e2e8f0] px-6 py-5">
          <div>
            <h3 className="text-lg font-semibold text-[#0f172a]">Importação Aging AR</h3>
            <p className="mt-1 text-sm text-[#64748b]">Atualize a base diária da carteira de clientes.</p>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#dbe3ef] text-[#64748b] transition hover:bg-[#f8fafc]"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-6 px-6 py-6">
          <section className="rounded-xl border border-[#e2e8f0] bg-[#f8fbff] p-4">
            <label className="mb-2 block text-sm font-semibold text-[#0f172a]">Arquivo Excel</label>
            <div className="flex items-center gap-3">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-[#cbd5e1] bg-white px-3 py-2 text-sm font-medium text-[#334155] transition hover:bg-[#f8fafc]">
                <FileUp className="h-4 w-4" />
                Selecionar arquivo
                <input type="file" accept=".xlsx,.xls" onChange={onFileChange} className="hidden" />
              </label>
              <span className="max-w-[280px] truncate text-sm text-[#475569]">{selectedFile?.name ?? "Nenhum arquivo selecionado"}</span>
            </div>
            {selectedFile ? <p className="mt-2 text-xs text-[#475569]">Tamanho: {formatFileSize(selectedFile.size)}</p> : null}
            <p className="mt-2 text-xs text-[#64748b]">A nova base substituirá a base vigente para fins de dashboard.</p>

            <label className="mb-2 mt-4 block text-sm font-semibold text-[#0f172a]">Importado por</label>
            <input
              type="text"
              value={currentUserName}
              readOnly
              className="h-10 w-full rounded-md border border-[#dbe3ef] bg-[#f8fafc] px-3 text-sm text-[#334155]"
            />

            {warningMessage ? (
              <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                Você está importando uma base mais antiga que a atual.
              </div>
            ) : null}
            {duplicateMessage ? (
              <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{duplicateMessage}</div>
            ) : null}
            {drawerErrorMessage ? (
              <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{drawerErrorMessage}</div>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void submitImport(false)}
                disabled={!selectedFile || importMutation.isPending}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-[#0f172a] px-4 text-sm font-semibold text-white transition hover:bg-[#1e293b] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {importMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                {importMutation.isPending ? "Importando base..." : selectedFile ? "Confirmar importação" : "Importar base"}
              </button>

              {duplicateMessage ? (
                <button
                  type="button"
                  onClick={() => void handleOverwrite()}
                  disabled={importMutation.isPending}
                  className="inline-flex h-10 items-center rounded-md border border-[#cbd5e1] px-4 text-sm font-semibold text-[#334155] transition hover:bg-[#f8fafc] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Sobrescrever base
                </button>
              ) : null}
            </div>
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-sm font-semibold uppercase tracking-[0.06em] text-[#334155]">Últimas importações</h4>
              <button
                type="button"
                onClick={() => void historyQuery.refetch()}
                className="text-xs font-medium text-[#475569] underline-offset-2 hover:underline"
              >
                Atualizar
              </button>
            </div>

            <div className="space-y-2">
              {historyQuery.isLoading ? <p className="text-sm text-[#64748b]">Carregando histórico...</p> : null}
              {historyQuery.isError ? <p className="text-sm text-rose-700">Não foi possível carregar o histórico.</p> : null}
              {sortedHistory.map((item) => {
                  const isCurrentBase = currentBaseId === item.id;
                  return (
                <article key={item.id} className="rounded-lg border border-[#e2e8f0] bg-white p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-[#0f172a]">Base: {formatDate(item.base_date)}</p>
                      <p className="mt-1 text-xs text-[#64748b]">Importado em {formatDateTime(item.created_at)}</p>
                      <p className="text-xs text-[#64748b]">Importado por: {item.imported_by?.trim() || "Usuário não identificado"}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-semibold", statusTone(item.status))}>{statusLabel(item.status)}</span>
                      {isCurrentBase ? <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700">Base atual</span> : null}
                    </div>
                  </div>
                </article>
                  );
                })}

              {!historyQuery.isLoading && !historyQuery.isError && (historyQuery.data?.length ?? 0) === 0 ? (
                <p className="text-sm text-[#64748b]">Nenhuma importação encontrada.</p>
              ) : null}
            </div>
          </section>
        </div>
      </aside>
    </>
  );
}
