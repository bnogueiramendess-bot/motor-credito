"use client";

import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type InvitePreviewResponse = {
  username: string;
};

export default function PrimeiroAcessoPage() {
  const search = useSearchParams();
  const router = useRouter();
  const token = search.get("token");

  const [username, setUsername] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [logoError, setLogoError] = useState(false);
  const loadedTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError("Este link de primeiro acesso é inválido ou expirou. Solicite um novo acesso ao administrador.");
      setIsLoadingPreview(false);
      return;
    }
    if (loadedTokenRef.current === token) {
      return;
    }
    loadedTokenRef.current = token;

    async function loadPreview() {
      try {
        setIsLoadingPreview(true);
        setError(null);
        const response = await fetch(`/api/auth/invite-preview?token=${encodeURIComponent(token)}`);
        const data = (await response.json()) as InvitePreviewResponse & { detail?: string };

        if (!response.ok) {
          setError(data.detail ?? "Este link de primeiro acesso é inválido ou expirou. Solicite um novo acesso ao administrador.");
          setIsLoadingPreview(false);
          return;
        }

        setUsername(data.username);
        setIsLoadingPreview(false);
      } catch {
        setError("Não foi possível carregar os dados de primeiro acesso. Tente novamente.");
        setIsLoadingPreview(false);
      }
    }

    void loadPreview();
  }, [token]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!token || !username) {
      setError("Este link de primeiro acesso é inválido ou expirou. Solicite um novo acesso ao administrador.");
      return;
    }

    if (password !== confirmPassword) {
      setError("As senhas informadas não coincidem.");
      return;
    }

    if (password.length < 8) {
      setError("A senha deve conter ao menos 8 caracteres.");
      return;
    }

    setIsSubmitting(true);
    const response = await fetch("/api/auth/accept-invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password })
    });

    if (!response.ok) {
      const data = (await response.json()) as { detail?: string };
      setError(data.detail ?? "Não foi possível cadastrar a senha.");
      setIsSubmitting(false);
      return;
    }

    setSuccessMessage("Senha cadastrada com sucesso. Redirecionando para o login...");
    setTimeout(() => {
      router.push("/login");
    }, 1500);
  }

  const isTokenInvalid = !isLoadingPreview && !username;

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#121e70] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_15%_110%,rgba(29,200,173,0.18)_0%,transparent_55%),radial-gradient(ellipse_60%_70%_at_90%_-10%,rgba(29,200,173,0.12)_0%,transparent_50%),linear-gradient(160deg,#121e70_0%,#0f1a66_48%,#0a134c_100%)]" />
      <div className="grid-mask pointer-events-none absolute inset-0" />
      <div className="orb orb-1 pointer-events-none absolute -left-20 -top-24 h-[420px] w-[420px] rounded-full bg-[#1dc8ad]" />
      <div className="orb orb-2 pointer-events-none absolute -bottom-20 -right-16 h-[320px] w-[320px] rounded-full bg-[#1f2f8f]" />

      <div className="relative z-10 flex min-h-screen items-center justify-center px-4 py-8 md:px-8">
        <section className="w-full max-w-[500px] animate-[riseUp_0.8s_cubic-bezier(0.22,1,0.36,1)_0.1s_forwards] opacity-0">
          <div className="rounded-3xl border border-white/12 bg-[rgba(16,27,92,0.58)] p-6 shadow-[0_0_0_1px_rgba(29,200,173,0.12),0_32px_80px_rgba(0,0,0,0.45),inset_0_2px_0_rgba(255,255,255,0.07)] backdrop-blur-[24px] backdrop-saturate-150 sm:p-7 xl:p-10">
            <div className="mb-5 flex justify-center lg:mb-6 xl:mb-8">
              {!logoError ? (
                <Image
                  src="/images/adfert-logo-sem-fundo-v3.PNG?v=20260507-1"
                  alt="Adfert - Part of Indorama Corporation"
                  width={420}
                  height={136}
                  className="h-auto w-[230px] sm:w-[250px] lg:w-[280px] xl:w-[340px]"
                  priority
                  onError={() => setLogoError(true)}
                />
              ) : (
                <div className="flex flex-col">
                  <span className="text-3xl font-bold tracking-tight">Adfert</span>
                  <span className="text-[0.68rem] uppercase tracking-[0.08em] text-[#2dc99e]">Part of Indorama Corporation</span>
                </div>
              )}
            </div>

            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-[#8fead8]">Primeiro Acesso</p>
            <h1 className="mb-1 text-lg font-semibold tracking-[-0.01em] text-[#f2f4f8] sm:text-xl">Seja bem-vindo.</h1>
            <p className="mb-5 text-sm text-white/45 lg:mb-6 xl:mb-8">
              Seu acesso foi criado. Defina sua senha para entrar na plataforma.
            </p>

            {isLoadingPreview ? (
              <p className="text-sm text-white/70">Carregando dados do convite...</p>
            ) : null}

            {isTokenInvalid ? (
              <p className="rounded-lg border border-rose-300/35 bg-rose-400/10 p-3 text-sm text-rose-200">
                Este link de primeiro acesso é inválido ou expirou. Solicite um novo acesso ao administrador.
              </p>
            ) : null}

            {!isLoadingPreview && username ? (
              <form onSubmit={handleSubmit} className="space-y-3 xl:space-y-4" noValidate>
                <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/85">
                  Seu usuário é: <span className="font-semibold text-white">{username}</span>
                </div>

                <div>
                  <label htmlFor="password" className="mb-2 block text-xs font-medium uppercase tracking-[0.05em] text-white/60">
                    Nova senha
                  </label>
                  <input
                    id="password"
                    className="w-full rounded-[10px] border border-white/15 bg-white/5 py-2.5 px-4 text-sm text-white placeholder:text-white/25 focus:border-[#2dc99e] focus:bg-[#2dc99e]/10 focus:outline-none focus:ring-4 focus:ring-[#2dc99e]/20 xl:py-3"
                    type="password"
                    placeholder="Digite sua nova senha"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>

                <div>
                  <label htmlFor="confirm-password" className="mb-2 block text-xs font-medium uppercase tracking-[0.05em] text-white/60">
                    Confirmar senha
                  </label>
                  <input
                    id="confirm-password"
                    className="w-full rounded-[10px] border border-white/15 bg-white/5 py-2.5 px-4 text-sm text-white placeholder:text-white/25 focus:border-[#2dc99e] focus:bg-[#2dc99e]/10 focus:outline-none focus:ring-4 focus:ring-[#2dc99e]/20 xl:py-3"
                    type="password"
                    placeholder="Repita sua nova senha"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                </div>

                {error ? <p className="text-sm text-rose-300">{error}</p> : null}
                {successMessage ? <p className="text-sm text-emerald-300">{successMessage}</p> : null}

                <button
                  className="btn-enter relative w-full overflow-hidden rounded-[10px] border-0 bg-gradient-to-br from-[#2dc99e] to-[#1fa37f] px-6 py-2.5 text-sm font-semibold tracking-[0.01em] text-[#091545] shadow-[0_4px_24px_rgba(45,201,158,0.35)] transition hover:-translate-y-px hover:shadow-[0_8px_32px_rgba(45,201,158,0.45)] disabled:cursor-not-allowed disabled:opacity-75 xl:py-3"
                  type="submit"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Cadastrando..." : "Cadastrar"}
                </button>

                <p className="text-xs text-white/45">
                  Após cadastrar sua senha, você será direcionado para a tela de login.
                </p>
              </form>
            ) : null}
          </div>
        </section>
      </div>

      <style jsx>{`
        .grid-mask {
          background-image: linear-gradient(rgba(29, 200, 173, 0.06) 1px, transparent 1px),
            linear-gradient(90deg, rgba(29, 200, 173, 0.06) 1px, transparent 1px);
          background-size: 48px 48px;
          mask-image: radial-gradient(ellipse 80% 80% at 50% 50%, black 40%, transparent 100%);
        }

        .orb {
          filter: blur(80px);
          opacity: 0.35;
          animation: drift 18s ease-in-out infinite alternate;
        }

        .orb-1 {
          animation-duration: 22s;
        }

        .orb-2 {
          animation-duration: 16s;
          animation-delay: -8s;
          opacity: 0.2;
        }

        .btn-enter::before {
          content: "";
          position: absolute;
          inset: 0;
          background: linear-gradient(135deg, rgba(255, 255, 255, 0.18), transparent);
          opacity: 0;
          transition: opacity 0.2s;
        }

        .btn-enter:hover::before {
          opacity: 1;
        }

        .btn-enter::after {
          content: "";
          position: absolute;
          top: 0;
          left: -100%;
          width: 60%;
          height: 100%;
          background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
          transform: skewX(-20deg);
          animation: shimmer 3.5s ease-in-out infinite 1.5s;
        }

        @keyframes drift {
          from {
            transform: translate(0, 0) scale(1);
          }
          to {
            transform: translate(30px, 40px) scale(1.08);
          }
        }

        @keyframes shimmer {
          0% {
            left: -100%;
          }
          40% {
            left: 150%;
          }
          100% {
            left: 150%;
          }
        }

        @keyframes riseUp {
          from {
            opacity: 0;
            transform: translateY(28px) scale(0.98);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
      `}</style>
    </main>
  );
}
