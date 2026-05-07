"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    if (!response.ok) {
      const data = await response.json();
      setError(data.detail ?? "Falha no login.");
      return;
    }
    router.push("/clientes/dashboard");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center px-6">
      <form onSubmit={handleSubmit} className="w-full space-y-4 rounded-xl border bg-white p-6">
        <h1 className="text-xl font-semibold">Gestao de Carteira de Clientes</h1>
        <p className="text-sm text-slate-600">Acesse com seu usuario corporativo.</p>
        <input className="w-full rounded border p-2" type="email" placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input className="w-full rounded border p-2" type="password" placeholder="Senha" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error ? <p className="text-sm text-rose-700">{error}</p> : null}
        <button className="w-full rounded bg-slate-900 p-2 text-white" type="submit">Entrar</button>
      </form>
    </main>
  );
}
