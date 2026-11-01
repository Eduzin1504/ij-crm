import Link from "next/link";
import { cn } from "cn";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ErroCarregamento } from "@/components/erro-carregamento";
import { PageHeader } from "@/components/shell/page-header";
import { SecaoAcompanhamento, SecaoConversao, SecaoEngajamento, SecaoSatisfacao } from "@/components/painel/secoes";
import { exigirUsuario } from "@/lib/auth/atual";
import { comTratamento, ehInesperado } from "@/lib/erros/registrar";
import { carregarPainel } from "@/lib/painel/servico";
import { resolverPeriodo, type TipoPeriodo } from "@/lib/ranking/periodo";
import { FiltroVendedor } from "./filtro-vendedor";

export const metadata = { title: "Painel de vendas" };

type Busca = { periodo?: string | string[]; ref?: string | string[]; vendedor?: string | string[] };

const um = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

const ABA = "rounded-md px-3 py-1 font-mono text-xs uppercase tracking-eyebrow transition-colors";
const SETA = "inline-flex size-8 items-center justify-center rounded-lg border border-border text-fg-soft hover:bg-surface-hover hover:text-foreground";

/**
 * Painel de vendas (GAB-94, spec fase 2 §4.14): conversão, engajamento,
 * acompanhamento e satisfação. Visível a todos (§4.12: sem visão restrita).
 * Os mesmos números saem pelo MCP (`consultar_painel_vendas`).
 */
export default async function PainelPage({ searchParams }: { searchParams: Promise<Busca> }) {
  await exigirUsuario();
  const busca = await searchParams;
  const tipo: TipoPeriodo = um(busca.periodo) === "semana" ? "semana" : "mes";
  const agora = new Date();
  const periodo = resolverPeriodo(tipo, um(busca.ref), agora);
  // Vendedor do link que não existe (mais): `carregarPainel` ignora o filtro e mostra o time.
  const p = await comTratamento("pagina.painel", () => carregarPainel({ periodo, vendedorId: um(busca.vendedor) ?? null }, agora));
  if (ehInesperado(p)) return <ErroCarregamento codigo={p.ref} />;
  const filtro = p.vendedor?.id ?? null;

  const href = (t: TipoPeriodo, ref?: string) => {
    const q = new URLSearchParams({ periodo: t });
    if (ref) q.set("ref", ref);
    if (filtro) q.set("vendedor", filtro);
    return `/painel?${q.toString()}`;
  };
  const periodoAtual: Record<string, string> = { periodo: tipo, ...(periodo.atual ? {} : { ref: periodo.primeiroDia }) };

  const navegacao = (
    <div className="flex flex-wrap items-center gap-2">
      <FiltroVendedor atualId={filtro} opcoes={p.vendedores.map((v) => ({ id: v.id, nome: v.nome }))} periodo={periodoAtual} />
      <nav aria-label="Período" className="flex rounded-lg border border-border bg-surface p-0.5">
        {(["semana", "mes"] as const).map((t) => (
          <Link key={t} href={href(t)} aria-current={t === tipo ? "page" : undefined} className={cn(ABA, t === tipo ? "bg-surface-strong text-foreground" : "text-fg-mute hover:text-foreground")}>
            {t === "semana" ? "Semana" : "Mês"}
          </Link>
        ))}
      </nav>
      <Link href={href(tipo, periodo.anterior)} className={SETA} aria-label={tipo === "semana" ? "Semana anterior" : "Mês anterior"}>
        <ChevronLeft className="size-4" />
      </Link>
      {periodo.proximo ? (
        <Link href={href(tipo, periodo.proximo)} className={SETA} aria-label={tipo === "semana" ? "Próxima semana" : "Próximo mês"}>
          <ChevronRight className="size-4" />
        </Link>
      ) : (
        <span aria-hidden className={cn(SETA, "pointer-events-none opacity-40")}>
          <ChevronRight className="size-4" />
        </span>
      )}
      {!periodo.atual ? (
        <Link href={href(tipo)} className="font-mono text-xs text-fg-mute hover:text-foreground hover:underline">
          {tipo === "semana" ? "semana atual" : "mês atual"}
        </Link>
      ) : null}
    </div>
  );

  return (
    <>
      <PageHeader
        eyebrow={`${tipo === "semana" ? "Semana" : "Mês"}: ${periodo.rotulo}${p.vendedor ? ` · ${p.vendedor.nome}` : ""}`}
        title="Painel de vendas"
        description="Conversão, engajamento do time, acompanhamento dos leads e satisfação do contato. Também pelo Claude (MCP): “como estamos convertendo este mês?”."
        actions={navegacao}
      />
      <div className="space-y-12">
        {p.conversao ? <SecaoConversao c={p.conversao} /> : null}
        {p.engajamento ? <SecaoEngajamento e={p.engajamento} /> : null}
        {p.acompanhamento ? <SecaoAcompanhamento a={p.acompanhamento} /> : null}
        {p.satisfacao ? <SecaoSatisfacao s={p.satisfacao} /> : null}
        <p className="text-xs text-fg-faint">Período em dias de São Paulo. Acompanhamento é a situação de agora; os demais indicadores são do período escolhido.</p>
      </div>
    </>
  );
}
