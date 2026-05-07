import { NextResponse } from "next/server";

import { BackendError, fetchBackend } from "@/shared/server/backend-client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const units = await fetchBackend("/admin/business-units");
    return NextResponse.json(units);
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Nao foi possivel carregar as unidades de negocio." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const created = await fetchBackend("/admin/business-units", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Nao foi possivel cadastrar a unidade de negocio." }, { status: 500 });
  }
}
