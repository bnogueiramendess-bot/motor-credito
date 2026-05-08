"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [logoError, setLogoError] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });

    if (!response.ok) {
      const data = await response.json();
      setError(data.detail ?? "Falha no login.");
      setIsSubmitting(false);
      return;
    }

    router.push("/clientes/dashboard");
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#121e70] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_15%_110%,rgba(29,200,173,0.18)_0%,transparent_55%),radial-gradient(ellipse_60%_70%_at_90%_-10%,rgba(29,200,173,0.12)_0%,transparent_50%),linear-gradient(160deg,#121e70_0%,#0f1a66_48%,#0a134c_100%)]" />
      <div className="grid-mask pointer-events-none absolute inset-0" />
      <div className="orb orb-1 pointer-events-none absolute -left-20 -top-24 h-[420px] w-[420px] rounded-full bg-[#1dc8ad]" />
      <div className="orb orb-2 pointer-events-none absolute -bottom-20 -right-16 h-[320px] w-[320px] rounded-full bg-[#1f2f8f]" />

      <div className="relative z-10 grid min-h-screen grid-cols-1 items-start px-4 py-8 md:px-8 lg:grid-cols-[minmax(520px,1.35fr)_1px_minmax(420px,460px)_minmax(40px,0.2fr)] lg:items-center lg:gap-8 lg:px-8 lg:py-4 xl:grid-cols-[minmax(520px,1.35fr)_1px_minmax(460px,500px)_minmax(48px,0.2fr)] xl:gap-10 xl:px-10 xl:py-8">
        <section className="institutional-panel hidden max-w-[440px] animate-[slideLeft_0.9s_cubic-bezier(0.22,1,0.36,1)_0.2s_forwards] self-center opacity-0 lg:block">
          <p className="institutional-title max-w-[430px] text-[clamp(2rem,3.15vw,3.1rem)] font-extrabold leading-[1.08] tracking-[-0.028em] text-white">
            <span className="block">Gestão de</span>
            <span className="block whitespace-nowrap">Carteira de Clientes</span>
          </p>
          <p className="institutional-subtitle mt-5 max-w-[350px] bg-gradient-to-r from-[#8fead8] via-[#b6fff0] to-[#e9f7ff] bg-clip-text text-[clamp(1.1rem,1.5vw,1.35rem)] font-semibold leading-tight tracking-[-0.01em] text-transparent">
            Relações que adicionam valor
          </p>
          <p className="mt-7 max-w-[345px] text-[1rem] leading-8 text-[#d8e4ff] [text-shadow:0_2px_10px_rgba(5,14,56,0.22)]">
            Ambiente interno para apoiar o acompanhamento da carteira de clientes com segurança e consistência operacional.
          </p>
        </section>

        <div className="mx-auto hidden h-[320px] w-px bg-gradient-to-b from-transparent via-[#2dc99e]/30 to-transparent lg:block" />

        <section className="w-full animate-[riseUp_0.8s_cubic-bezier(0.22,1,0.36,1)_0.1s_forwards] opacity-0 lg:col-start-3 lg:max-w-[440px] lg:justify-self-end xl:max-w-[500px]">
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

            <h1 className="mb-1 text-lg font-semibold tracking-[-0.01em] text-[#f2f4f8] sm:text-xl">Bem-vindo de volta</h1>
            <p className="mb-5 text-sm text-white/45 lg:mb-6 xl:mb-8">Acesse o painel de gestão da carteira de clientes.</p>

            <form onSubmit={handleSubmit} className="space-y-3 xl:space-y-4" noValidate>
              <div>
                <label htmlFor="email" className="mb-2 block text-xs font-medium uppercase tracking-[0.05em] text-white/60">
                  E-mail corporativo
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/30">
                    <MailIcon />
                  </span>
                  <input
                    id="email"
                    className="w-full rounded-[10px] border border-white/15 bg-white/5 py-2.5 pl-11 pr-4 text-sm text-white placeholder:text-white/25 focus:border-[#2dc99e] focus:bg-[#2dc99e]/10 focus:outline-none focus:ring-4 focus:ring-[#2dc99e]/20 xl:py-3"
                    type="email"
                    placeholder="seu@indorama.com"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div>
                <label htmlFor="password" className="mb-2 block text-xs font-medium uppercase tracking-[0.05em] text-white/60">
                  Senha
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/30">
                    <LockIcon />
                  </span>
                  <input
                    id="password"
                    className="w-full rounded-[10px] border border-white/15 bg-white/5 py-2.5 pl-11 pr-12 text-sm text-white placeholder:text-white/25 focus:border-[#2dc99e] focus:bg-[#2dc99e]/10 focus:outline-none focus:ring-4 focus:ring-[#2dc99e]/20 xl:py-3"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••••••"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <button
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-white/40 transition hover:text-[#2dc99e] focus:outline-none focus:ring-2 focus:ring-[#2dc99e]/40"
                    type="button"
                    aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                    title={showPassword ? "Ocultar senha" : "Mostrar senha"}
                    onClick={() => setShowPassword((current) => !current)}
                  >
                    {showPassword ? <EyeClosedIcon /> : <EyeOpenIcon />}
                  </button>
                </div>
              </div>

              <div className="flex justify-end">
                <a href="#" className="text-xs text-[#2dc99e] opacity-90 transition hover:opacity-100 hover:underline">
                  Esqueci minha senha
                </a>
              </div>

              {error ? <p className="text-sm text-rose-300">{error}</p> : null}

              <button
                className="btn-enter relative w-full overflow-hidden rounded-[10px] border-0 bg-gradient-to-br from-[#2dc99e] to-[#1fa37f] px-6 py-2.5 text-sm font-semibold tracking-[0.01em] text-[#091545] shadow-[0_4px_24px_rgba(45,201,158,0.35)] transition hover:-translate-y-px hover:shadow-[0_8px_32px_rgba(45,201,158,0.45)] disabled:cursor-not-allowed disabled:opacity-75 xl:py-3"
                type="submit"
                disabled={isSubmitting}
              >
                {isSubmitting ? "Entrando..." : "Entrar na plataforma"}
              </button>
            </form>

            <div className="mt-5 flex items-center justify-center gap-2 border-t border-white/10 pt-5 xl:mt-6 xl:pt-6">
              <span className="text-[#2dc99e]/90">
                <LockIconSmall />
              </span>
              <span className="text-[0.72rem] tracking-[0.03em] text-white/35">Conexão segura · Criptografia SSL</span>
            </div>
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

        .institutional-panel {
          position: relative;
          padding: 1rem 1.1rem 1rem 0;
          overflow: visible;
        }

        .institutional-panel::before {
          content: "";
          position: absolute;
          inset: -22% -18% -24% -20%;
          background: radial-gradient(ellipse at 32% 40%, rgba(6, 15, 58, 0.44), transparent 74%);
          filter: blur(18px);
          pointer-events: none;
          z-index: -1;
        }

        .institutional-panel::after {
          content: "";
          position: absolute;
          inset: -10% 24% 32% -16%;
          background: radial-gradient(ellipse at left center, rgba(79, 222, 199, 0.12), transparent 70%);
          filter: blur(22px);
          pointer-events: none;
          z-index: -1;
        }

        .institutional-title {
          text-shadow: 0 8px 24px rgba(7, 15, 60, 0.42);
        }

        .institutional-subtitle {
          position: relative;
        }

        .institutional-subtitle::after {
          content: "";
          position: absolute;
          left: -2%;
          right: 36%;
          bottom: -18%;
          height: 90%;
          background: radial-gradient(ellipse at left center, rgba(84, 238, 211, 0.12), transparent 75%);
          filter: blur(14px);
          pointer-events: none;
          z-index: -1;
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

        @keyframes slideLeft {
          from {
            opacity: 0;
            transform: translateX(-30px);
          }

          to {
            opacity: 1;
            transform: translateX(0);
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

        @keyframes fadeIn {
          to {
            opacity: 1;
          }
        }
      `}</style>
    </main>
  );
}

function MailIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="2" y="4" width="20" height="16" rx="3" />
      <polyline points="2,4 12,13 22,4" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function LockIconSmall() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function EyeOpenIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeClosedIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}


