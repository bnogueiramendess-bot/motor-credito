import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { ReactNode } from "react";

import "@/app/globals.css";
import { QueryProvider } from "@/shared/providers/query-provider";

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  display: "swap"
});

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
      <body className={plusJakartaSans.className}>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
