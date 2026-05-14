import { Suspense } from "react";

import PrimeiroAcessoClientPage from "./primeiro-acesso-client";

export const dynamic = "force-dynamic";

function PrimeiroAcessoFallback() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#121e70] text-white">
      <div className="relative z-10 flex min-h-screen items-center justify-center px-4 py-8 md:px-8">
        <p className="text-sm text-white/70">Carregando...</p>
      </div>
    </main>
  );
}

export default function PrimeiroAcessoPage() {
  return (
    <Suspense fallback={<PrimeiroAcessoFallback />}>
      <PrimeiroAcessoClientPage />
    </Suspense>
  );
}
