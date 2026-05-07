"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function PrimeiroAcessoPage() {
  const search = useSearchParams();
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = search.get("token");
    if (!token) {
      setError("Token de convite ausente.");
      return;
    }

    const response = await fetch("/api/auth/accept-invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, full_name: fullName, password })
    });
    if (!response.ok) {
      const data = await response.json();
      setError(data.detail ?? "Falha no primeiro acesso.");
      return;
    }

    router.push("/clientes/dashboard");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center px-6">
      <form onSubmit={handleSubmit} className="w-full space-y-4 rounded-xl border bg-white p-6">
        <h1 className="text-xl font-semibold">Primeiro acesso</h1>
        <p className="text-sm text-slate-600">Defina seu nome e senha para acessar o sistema.</p>
        <input className="w-full rounded border p-2" placeholder="Nome completo" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        <input className="w-full rounded border p-2" type="password" placeholder="Nova senha" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error ? <p className="text-sm text-rose-700">{error}</p> : null}
        <button className="w-full rounded bg-slate-900 p-2 text-white" type="submit">Concluir cadastro</button>
      </form>
    </main>
  );
}
