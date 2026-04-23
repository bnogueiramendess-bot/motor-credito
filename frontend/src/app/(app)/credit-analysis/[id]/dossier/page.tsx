import { redirect } from "next/navigation";

type DossierRouteProps = {
  params: {
    id: string;
  };
};

export default function DossierPage({ params }: DossierRouteProps) {
  redirect(`/analises/${params.id}`);
}
