import { NextResponse } from "next/server";

import { BackendError, fetchBackend } from "@/shared/server/backend-client";

export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ committeeId: string }>;
};

export async function PUT(request: Request, { params }: Context) {
  const { committeeId } = await params;
  try {
    const payload = await request.json();
    const updated = await fetchBackend(`/admin/committees/${committeeId}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Nao foi possivel atualizar o comite." }, { status: 500 });
  }
}
export async function DELETE(_request: Request, { params }: Context) {
  const { committeeId } = await params;
  try {
    await fetchBackend(`/admin/committees/${committeeId}`, {
      method: "DELETE"
    });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Nao foi possivel excluir o comite." }, { status: 500 });
  }
}
