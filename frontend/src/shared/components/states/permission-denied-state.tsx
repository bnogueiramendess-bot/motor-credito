type PermissionDeniedStateProps = {
  title?: string;
  description?: string;
};

export function PermissionDeniedState({
  title = "Acesso restrito",
  description = "Você não possui permissão para acessar este conteúdo."
}: PermissionDeniedStateProps) {
  return (
    <section className="rounded-2xl border border-[#dbe3ef] bg-white px-6 py-10 text-center shadow-sm">
      <p className="text-[22px] font-semibold text-[#0f172a]">{title}</p>
      <p className="mt-2 text-sm text-[#5b6b7f]">{description}</p>
    </section>
  );
}
