import { NextResponse } from "next/server";

import { BackendError, fetchBackend } from "@/shared/server/backend-client";

export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ committeeId: string }>;
};

export async function POST(_request: Request, { params }: Context) {
  const { committeeId } = await params;
  try {
    const archived = await fetchBackend(`/admin/committees/${committeeId}/archive`, {
      method: "POST"
    });
    return NextResponse.json(archived);
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Nao foi possivel arquivar o comite." }, { status: 500 });
  }
}