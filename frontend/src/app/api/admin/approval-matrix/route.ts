import { NextResponse } from "next/server";

import { BackendError, fetchBackend } from "@/shared/server/backend-client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rules = await fetchBackend("/admin/approval-matrix");
    return NextResponse.json(rules);
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Nao foi possivel carregar a matriz de aprovacao." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const created = await fetchBackend("/admin/approval-matrix", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Nao foi possivel criar a regra da matriz." }, { status: 500 });
  }
}
