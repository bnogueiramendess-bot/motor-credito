import { NextResponse } from "next/server";

import { BackendError, fetchBackend } from "@/shared/server/backend-client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const company = await fetchBackend("/admin/company");
    return NextResponse.json(company);
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Nao foi possivel carregar os dados da empresa." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const payload = await request.json();
    const updated = await fetchBackend("/admin/company", {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Nao foi possivel atualizar os dados da empresa." }, { status: 500 });
  }
}
