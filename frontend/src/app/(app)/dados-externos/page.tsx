import { ExternalDataPageView } from "@/features/external-data/components/external-data-page-view";

type ExternalDataPageProps = {
  searchParams?: {
    analysisId?: string;
  };
};

export default function DadosExternosPage({ searchParams }: ExternalDataPageProps) {
  const analysisIdParam = searchParams?.analysisId;
  const parsed = analysisIdParam ? Number(analysisIdParam) : null;
  const analysisId = parsed && Number.isFinite(parsed) && parsed > 0 ? parsed : null;

  return <ExternalDataPageView analysisId={analysisId} />;
}
