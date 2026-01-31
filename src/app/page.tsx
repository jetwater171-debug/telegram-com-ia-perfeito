import Link from "next/link";

export default function Home() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#f7f5f2] text-[#121417]">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-40 top-[-120px] h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle_at_center,_rgba(14,165,164,0.35),_transparent_65%)]" />
        <div className="absolute right-[-180px] top-[80px] h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle_at_center,_rgba(255,122,24,0.28),_transparent_65%)]" />
        <div className="absolute bottom-[-120px] left-1/2 h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle_at_center,_rgba(0,0,0,0.08),_transparent_60%)]" />
      </div>

      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-8">
        <div className="flex items-center gap-3 text-lg font-semibold tracking-tight">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-[#121417] text-white shadow-lg">
            LM
          </span>
          Lari Morais
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/admin"
            className="rounded-full border border-black/10 bg-white/70 px-5 py-2 text-sm font-semibold shadow-sm transition hover:border-black/20 hover:bg-white"
          >
            Abrir painel
          </Link>
          <Link
            href="/admin/settings"
            className="rounded-full bg-[#121417] px-5 py-2 text-sm font-semibold text-white shadow-lg transition hover:translate-y-[-1px]"
          >
            Configurar bot
          </Link>
        </div>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-6xl px-6 pb-20 pt-8">
        <section className="grid items-center gap-10 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-black/60 fade-in">
              Funil inteligente no Telegram
            </div>
            <h1 className="text-4xl font-semibold leading-tight text-[#121417] md:text-5xl rise-in">
              Bot com IA que conversa, qualifica e converte com naturalidade.
            </h1>
            <p className="max-w-xl text-lg text-black/70">
              Tudo integrado: capta o lead, entende o momento, aquece a conversa e entrega o pitch certo.
              Monitoramento ao vivo e reengajamento automatico para nao perder vendas.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/admin"
                className="rounded-full bg-[#0ea5a4] px-6 py-3 text-sm font-semibold text-white shadow-lg transition hover:translate-y-[-1px]"
              >
                Ir para o painel
              </Link>
              <Link
                href="/admin/settings"
                className="rounded-full border border-black/10 bg-white/70 px-6 py-3 text-sm font-semibold text-black/70 transition hover:border-black/20 hover:bg-white"
              >
                Ajustar configuracoes
              </Link>
            </div>
            <div className="flex flex-wrap gap-6 pt-6 text-sm text-black/60">
              <div>
                <p className="text-2xl font-semibold text-black">2x</p>
                Conversas mais longas
              </div>
              <div>
                <p className="text-2xl font-semibold text-black">+37%</p>
                Reengajamento ativo
              </div>
              <div>
                <p className="text-2xl font-semibold text-black">24/7</p>
                Operacao automatica
              </div>
            </div>
          </div>

          <div className="relative rounded-[32px] border border-white/70 bg-white/70 p-6 shadow-2xl backdrop-blur rise-in">
            <div className="absolute -top-6 right-6 rounded-full bg-[#121417] px-4 py-2 text-xs font-semibold uppercase tracking-[0.15em] text-white">
              fluxo
            </div>
            <div className="space-y-5">
              <div className="rounded-2xl border border-black/10 bg-white px-4 py-3 shadow-sm">
                <p className="text-xs uppercase tracking-[0.2em] text-black/40">Entrada</p>
                <p className="mt-2 text-sm font-medium">Lead iniciou conversa no Telegram</p>
              </div>
              <div className="rounded-2xl border border-black/10 bg-white px-4 py-3 shadow-sm">
                <p className="text-xs uppercase tracking-[0.2em] text-black/40">IA</p>
                <p className="mt-2 text-sm font-medium">Classificacao + mensagens alinhadas ao momento</p>
              </div>
              <div className="rounded-2xl border border-black/10 bg-white px-4 py-3 shadow-sm">
                <p className="text-xs uppercase tracking-[0.2em] text-black/40">Conversao</p>
                <p className="mt-2 text-sm font-medium">Preview certo e oferta no timing perfeito</p>
              </div>
              <div className="rounded-2xl border border-black/10 bg-white px-4 py-3 shadow-sm">
                <p className="text-xs uppercase tracking-[0.2em] text-black/40">Retencao</p>
                <p className="mt-2 text-sm font-medium">Reengajamento automatico para recuperar leads</p>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-20 grid gap-6 md:grid-cols-3">
          {[
            {
              title: "Conversas mais humanas",
              text: "Resposta rapida, tom natural e linguagem que acompanha o lead em cada fase.",
            },
            {
              title: "Painel em tempo real",
              text: "Acompanhe cada conversa, stats e status com atualizacoes instantaneas.",
            },
            {
              title: "Pagamentos sem friccao",
              text: "Pix gerado automaticamente no momento certo para maximizar conversao.",
            },
          ].map((item) => (
            <div
              key={item.title}
              className="rounded-3xl border border-black/10 bg-white/70 p-6 shadow-lg transition hover:-translate-y-1"
            >
              <h3 className="text-lg font-semibold">{item.title}</h3>
              <p className="mt-3 text-sm text-black/60">{item.text}</p>
            </div>
          ))}
        </section>

        <section className="mt-20 rounded-[36px] border border-black/10 bg-[#121417] px-8 py-10 text-white shadow-2xl">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-white/50">Pronto para rodar</p>
              <h2 className="mt-3 text-2xl font-semibold md:text-3xl">
                Ajuste o token e coloque a operacao no ar.
              </h2>
            </div>
            <Link
              href="/admin/settings"
              className="inline-flex items-center justify-center rounded-full bg-white px-6 py-3 text-sm font-semibold text-[#121417] shadow-lg transition hover:translate-y-[-1px]"
            >
              Configurar agora
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
