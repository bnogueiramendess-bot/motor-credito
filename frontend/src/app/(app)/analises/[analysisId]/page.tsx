import { notFound } from "next/navigation";

import { AnalysisDetailPageView } from "@/features/credit-analyses/components/analysis-detail-page-view";

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

  return <AnalysisDetailPageView analysisId={analysisId} />;
}
