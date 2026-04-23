"use client";

type ProcessingOverlayProps = {
  open: boolean;
  message: string;
};

export function ProcessingOverlay({ open, message }: ProcessingOverlayProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4 backdrop-blur-[2px]">
      <div className="w-full max-w-md rounded-xl border border-white/30 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
        <p className="text-lg font-semibold text-foreground">Processando análise</p>
        <p className="mt-2 text-sm text-muted-foreground transition-all duration-300">{message}</p>
      </div>
    </div>
  );
}

