import { NextResponse } from "next/server";

import { BackendError, fetchBackend } from "@/shared/server/backend-client";

export async function PATCH(
  request: Request,
  { params }: { params: { businessUnitId: string } }
) {
  const businessUnitId = Number(params.businessUnitId);
  if (!Number.isFinite(businessUnitId) || businessUnitId <= 0) {
    return NextResponse.json({ detail: "Identificador da unidade de negocio invalido." }, { status: 400 });
  }

  try {
    const payload = await request.json();
    const updated = await fetchBackend(`/admin/business-units/${businessUnitId}/status`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Nao foi possivel atualizar o status da unidade de negocio." }, { status: 500 });
  }
}
