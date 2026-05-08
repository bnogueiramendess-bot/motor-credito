"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function ConfiguracoesPage() {
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogout() {
    setError(null);
    setIsLoggingOut(true);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) {
        setError("Nao foi possivel encerrar a sessao. Tente novamente.");
        setIsLoggingOut(false);
        return;
      }
      router.push("/login");
      router.refresh();
    } catch {
      setError("Nao foi possivel encerrar a sessao. Tente novamente.");
      setIsLoggingOut(false);
    }
  }

  return (
    <section className="space-y-6">
      <div className="space-y-3">
        <h1 className="text-xl font-semibold">Gestao de Perfis</h1>
        <p className="text-sm text-slate-600">Matriz de perfis e permissoes (somente leitura nesta fase).</p>
      </div>

      <div className="max-w-md rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Sessao</h2>
        <p className="mt-1 text-sm text-slate-600">Encerre sua sessao com seguranca neste dispositivo.</p>
        {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}
        <button
          type="button"
          onClick={handleLogout}
          disabled={isLoggingOut}
          className="mt-4 inline-flex items-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isLoggingOut ? "Saindo..." : "Fazer logoff"}
        </button>
      </div>
    </section>
  );
}
