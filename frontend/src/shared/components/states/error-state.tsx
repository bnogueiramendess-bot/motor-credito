import { AlertTriangle } from "lucide-react";

import { Button } from "@/shared/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/shared/components/ui/alert";

type ErrorStateProps = {
  title: string;
  description: string;
  onRetry?: () => void;
};

export function ErrorState({ title, description, onRetry }: ErrorStateProps) {
  return (
    <Alert variant="destructive">
      <AlertTitle className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4" />
        {title}
      </AlertTitle>
      <AlertDescription className="mt-2 space-y-4">
        <p>{description}</p>
        {onRetry ? (
          <Button variant="outline" className="border-rose-300 bg-transparent text-rose-700 hover:bg-rose-100" onClick={onRetry}>
            Tentar novamente
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
