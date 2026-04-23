"use client";

import { cn } from "@/shared/lib/utils";

const steps = ["Cliente", "Dados", "Operação", "Análise"] as const;

type StepperProps = {
  currentStep: number;
};

export function Stepper({ currentStep }: StepperProps) {
  return (
    <div className="rounded-xl border border-border/80 bg-card p-4 shadow-sm">
      <div className="grid gap-3 sm:grid-cols-4">
        {steps.map((label, index) => {
          const stepNumber = index + 1;
          const isActive = stepNumber === currentStep;
          const isCompleted = stepNumber < currentStep;

          return (
            <div key={label} className="group space-y-2">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "inline-flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold transition-all duration-300",
                    isActive && "border-primary bg-primary text-primary-foreground shadow-sm",
                    isCompleted && "border-primary/30 bg-primary/10 text-primary",
                    !isActive && !isCompleted && "border-border bg-background text-muted-foreground"
                  )}
                >
                  {stepNumber}
                </span>
                <p
                  className={cn(
                    "text-sm font-medium transition-all duration-300",
                    isActive ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  {label}
                </p>
              </div>
              <div className="h-1 rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-300",
                    isCompleted || isActive ? "w-full bg-primary/80" : "w-0 bg-primary/80"
                  )}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

