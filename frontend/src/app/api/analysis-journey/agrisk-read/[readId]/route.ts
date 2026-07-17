import { NextResponse } from "next/server";

import { AgriskReportReadResponse } from "@/features/analysis-journey/api/contracts";
import { BackendError, fetchBackend } from "@/shared/server/backend-client";

export const dynamic = "force-dynamic";

type Context = { params: { readId: string } };

function resolveWorkspaceAnalysisIdFromReferer(request: Request): number | null {
  const referer = request.headers.get("referer");
  if (!referer) return null;

  try {
    const pathname = new URL(referer).pathname;
    const match = pathname.match(/^\/analises\/(\d+)\/workspace(?:\/)?$/);
    if (!match) return null;
    const id = Number(match[1]);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

function appendAnalysisId(path: string, analysisId: number | null): string {
  return analysisId ? `${path}?analysis_id=${analysisId}` : path;
}

export async function GET(request: Request, context: Context) {
  const readId = Number(context.params.readId);
  if (!Number.isFinite(readId) || readId <= 0) {
    return NextResponse.json({ detail: "ID de leitura inválido." }, { status: 400 });
  }
  try {
    const backendPath = appendAnalysisId(`/credit-report-reads/agrisk/${readId}`, resolveWorkspaceAnalysisIdFromReferer(request));
    const result = await fetchBackend<AgriskReportReadResponse>(backendPath);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Falha ao buscar leitura AgRisk." }, { status: 500 });
  }
}
