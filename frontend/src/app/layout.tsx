import type { Metadata } from "next";
import { ReactNode } from "react";

import "@/app/globals.css";
import { QueryProvider } from "@/shared/providers/query-provider";

export const metadata: Metadata = {
  title: "Gestao de Carteira de Clientes",
  description: "Painel para acompanhamento de clientes e analises de credito"
};

export default function RootLayout({
  children
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
