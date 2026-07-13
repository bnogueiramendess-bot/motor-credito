import { redirect } from "next/navigation";

import { getCreditAnalysisWorkspaceRoute } from "@/features/credit-analyses/utils/routes";

type DossierRouteProps = {
  params: {
    id: string;
  };
};

export default function DossierPage({ params }: DossierRouteProps) {
  redirect(getCreditAnalysisWorkspaceRoute(params.id));
}
