import { ErroCarregamento } from "@/components/erro-carregamento";
import { PageHeader } from "@/components/shell/page-header";
import { SecaoAcompanhamento, SecaoConversao, SecaoEngajamento, SecaoSatisfacao } from "@/components/painel/secoes";
import { exigirUsuario } from "@/lib/auth/atual";
import { comTratamento, ehInesperado } from "@/lib/erros/registrar";
import { VISIBILIDADE_PAINEL } from "@/lib/painel/definicoes";
import { carregarPainelPara } from "@/lib/painel/servico";
import { resolverPeriodo, type TipoPeriodo } from "@/lib/ranking/periodo";
import { AbasPainel } from "./abas";
import { FiltroVendedor } from "./filtro-vendedor";
import { NavegacaoPeriodo } from "./navegacao-periodo";

export const metadata = { title: "Painel de vendas" };

type Busca = { periodo?: string | string[]; ref?: string | string[]; vendedor?: string | string[] };

const um = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/**
 * Painel de vendas (GAB-94, spec fase 2 §4.14): conversão, engajamento,
 * acompanhamento e satisfação. Visível a todos (§4.12: sem visão restrita).
 * Os mesmos números saem pelo MCP (`consultar_painel_vendas`).
 */
export default async function PainelPage({ searchParams }: { searchParams: Promise<Busca> }) {
  const ator = await exigirUsuario();
  const busca = await searchParams;
  const tipo: TipoPeriodo = um(busca.periodo) === "semana" ? "semana" : "mes";
  const agora = new Date();
  const periodo = resolverPeriodo(tipo, um(busca.ref), agora);
  // Visibilidade do ranking (`carregarPainelPara`). Vendedor do link que não existe ou que o ator
  // não pode ver (ranking oculto): mostra a visão sem filtro em vez de erro.
  const v = await comTratamento("pagina.painel", async () => {
    const r = await carregarPainelPara(ator, { periodo, vendedorId: um(busca.vendedor) ?? null }, agora);
    if (r.ok) return r;
    const semFiltro = await carregarPainelPara(ator, { periodo, vendedorId: null }, agora);
    // Sem filtro não há recusa possível; se houver, vira erro com ref no log.
    if (!semFiltro.ok) throw new Error(`painel sem filtro recusado: ${semFiltro.erro}`);
    return semFiltro;
  });
  if (ehInesperado(v)) return <ErroCarregamento codigo={v.ref} />;
  const p = v.painel;
  const filtro = p.vendedor?.id ?? null;

  const periodoAtual: Record<string, string> = { periodo: tipo, ...(periodo.atual ? {} : { ref: periodo.primeiroDia }) };
  const parametros: Record<string, string> = filtro ? { vendedor: filtro } : {};

  const navegacao = (
    <div className="flex flex-wrap items-center gap-2">
      <AbasPainel atual="vendas" periodo={periodoAtual} />
      {v.modo === "completo" ? <FiltroVendedor atualId={filtro} opcoes={p.vendedores.map((x) => ({ id: x.id, nome: x.nome }))} periodo={periodoAtual} /> : null}
      <NavegacaoPeriodo caminho="/painel" tipo={tipo} periodo={periodo} parametros={parametros} />
    </div>
  );

  return (
    <>
      <PageHeader
        eyebrow={`${tipo === "semana" ? "Semana" : "Mês"}: ${periodo.rotulo}${p.vendedor ? ` · ${p.vendedor.nome}` : ""}`}
        title="Painel de vendas"
        description={
          v.modo === "completo"
            ? "Conversão, engajamento do time, acompanhamento dos leads e satisfação do contato. Também pelo Claude (MCP): “como estamos convertendo este mês?”."
            : "O ranking está oculto pelo gestor: aqui ficam os totais do time e só as suas linhas. Também pelo Claude (MCP)."
        }
        actions={navegacao}
      />
      <div className="space-y-12">
        {p.conversao ? <SecaoConversao c={p.conversao} /> : null}
        {p.engajamento ? <SecaoEngajamento e={p.engajamento} /> : null}
        {p.acompanhamento ? <SecaoAcompanhamento a={p.acompanhamento} soMeus={v.modo === "proprio"} /> : null}
        {p.satisfacao ? <SecaoSatisfacao s={p.satisfacao} /> : null}
        <p className="text-xs text-fg-faint">Período em dias de São Paulo. Acompanhamento é a situação de agora; os demais indicadores são do período escolhido. {VISIBILIDADE_PAINEL}</p>
      </div>
    </>
  );
}
