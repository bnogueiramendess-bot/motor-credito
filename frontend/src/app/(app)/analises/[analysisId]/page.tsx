import { notFound, redirect } from "next/navigation";

import { getCreditAnalysisWorkspaceRoute } from "@/features/credit-analyses/utils/routes";

type AnalysisPageProps = {
  params: {
    analysisId: string;
  };
};

export default function AnalysisDetailPage({ params }: AnalysisPageProps) {
  const analysisId = Number(params.analysisId);

  if (!Number.isFinite(analysisId) || analysisId <= 0) {
    notFound();
  }

  redirect(getCreditAnalysisWorkspaceRoute(analysisId));
}
