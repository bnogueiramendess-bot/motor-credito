import { Sparkles } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";

type DecisionInsightsProps = {
  highlights: string[];
};

export function DecisionInsights({ highlights }: DecisionInsightsProps) {
  return (
    <Card className="rounded-xl shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-primary" />
          Insights de decisao
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {highlights.map((highlight) => (
            <li key={highlight} className="rounded-lg bg-muted/30 px-3 py-2 text-sm text-foreground">
              {highlight}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

