import { NextResponse } from "next/server";

import { BackendError, fetchBackend } from "@/shared/server/backend-client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const matrix = await fetchBackend("/admin/roles/matrix");
    return NextResponse.json(matrix);
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Nao foi possivel carregar a matriz de perfis." }, { status: 500 });
  }
}
