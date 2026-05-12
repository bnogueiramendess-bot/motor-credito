import { notFound } from "next/navigation";

import { NewAnalysisPageView } from "@/features/analysis-journey/components/new-analysis-page-view";

type AnalysisWorkspacePageProps = {
  params: {
    analysisId: string;
  };
};

export default function AnalysisWorkspacePage({ params }: AnalysisWorkspacePageProps) {
  const analysisId = Number(params.analysisId);
  if (!Number.isFinite(analysisId) || analysisId <= 0) {
    notFound();
  }
  return <NewAnalysisPageView mode="workspace" analysisId={analysisId} />;
}
