import { PolicyGovernanceSummaryPage } from "@/features/credit-decision-policy/components/policy-governance-summary-page";

type PageProps = {
  params: {
    requestId: string;
  };
};

export default function PolicyGovernanceRequestPage({ params }: PageProps) {
  const parsedRequestId = Number(params.requestId);
  return <PolicyGovernanceSummaryPage requestId={Number.isFinite(parsedRequestId) ? parsedRequestId : 0} />;
}
