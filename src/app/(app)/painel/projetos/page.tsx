import { ErroCarregamento } from "@/components/erro-carregamento";
import { SecaoAlertas, SecaoCaneta, SecaoEncerrados, SecaoExecucao } from "@/components/painel/secoes-projetos";
import { PageHeader } from "@/components/shell/page-header";
import { exigirUsuario } from "@/lib/auth/atual";
import { comTratamento, ehInesperado } from "@/lib/erros/registrar";
import { VISIBILIDADE_PAINEL_PROJETOS } from "@/lib/painel/definicoes";
import { carregarCanetaPara, carregarExecucaoProjetos, pessoaDoFiltro } from "@/lib/painel/projetos-servico";
import { resolverPeriodo, type TipoPeriodo } from "@/lib/ranking/periodo";
import { AbasPainel } from "../abas";
import { FiltroVendedor } from "../filtro-vendedor";
import { NavegacaoPeriodo } from "../navegacao-periodo";

export const metadata = { title: "Painel de projetos" };

type Busca = { periodo?: string | string[]; ref?: string | string[]; gp?: string | string[] };

const um = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/**
 * Painel de projetos (GAB-96, spec fase 2 §4.14): aba do Painel, aberta a todos, como o cronograma.
 * O tempo com a caneta vem das propostas e tem regra própria (`carregarCanetaPara`).
 * Os mesmos números saem pelo MCP (`mcp/painel-projetos.ts`).
 */
export default async function PainelProjetosPage({ searchParams }: { searchParams: Promise<Busca> }) {
  const ator = await exigirUsuario();
  const busca = await searchParams;
  const tipo: TipoPeriodo = um(busca.periodo) === "semana" ? "semana" : "mes";
  const agora = new Date();
  const periodo = resolverPeriodo(tipo, um(busca.ref), agora);
  const v = await comTratamento("pagina.painel.projetos", async () => {
    // GP do link que não existe: mostra a visão sem filtro em vez de erro, como o painel de vendas.
    const pedido = um(busca.gp);
    const gp = pedido ? await pessoaDoFiltro(pedido) : null;
    const filtro = { periodo, gpId: gp?.id ?? null };
    const [execucao, caneta] = await Promise.all([carregarExecucaoProjetos(filtro, agora), carregarCanetaPara(ator, filtro, agora)]);
    return { gp, execucao, caneta };
  });
  if (ehInesperado(v)) return <ErroCarregamento codigo={v.ref} />;
  const { gp, execucao, caneta } = v;

  const periodoAtual: Record<string, string> = { periodo: tipo, ...(periodo.atual ? {} : { ref: periodo.primeiroDia }) };
  // GPs com projeto, quem tem linha na caneta e quem veio pelo link: sem o filtro aplicado, para dar para trocar.
  const opcoes = [...new Map([...execucao.gps, ...(caneta?.caneta.pessoas ?? []), ...(gp ? [gp] : [])].map((o) => [o.id, o])).values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  return (
    <>
      <PageHeader
        eyebrow={`${tipo === "semana" ? "Semana" : "Mês"}: ${periodo.rotulo}${gp ? ` · ${gp.nome}` : ""}`}
        title="Painel de projetos"
        description="Previsto × feito, atraso, check-in e com quem a caneta está parada. Também pelo Claude (MCP): “quais projetos estão atrasados?”."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <AbasPainel atual="projetos" periodo={periodoAtual} />
            <FiltroVendedor parametro="gp" rotulo="gp ou pessoa" atualId={gp?.id ?? null} opcoes={opcoes.map((o) => ({ id: o.id, nome: o.nome }))} periodo={periodoAtual} />
            <NavegacaoPeriodo caminho="/painel/projetos" tipo={tipo} periodo={periodo} parametros={gp ? { gp: gp.id } : {}} />
          </div>
        }
      />
      <div className="space-y-12">
        <SecaoExecucao e={execucao} />
        <SecaoAlertas a={execucao.alertas} />
        {caneta ? <SecaoCaneta c={caneta.caneta} visao={caneta.visao} /> : null}
        <SecaoEncerrados e={execucao.encerrados} />
        <p className="text-xs text-fg-faint">Dias de São Paulo. Só previstas, feitas, encerrados e o tempo com a caneta no período dependem do período escolhido; o resto é a situação de agora. {VISIBILIDADE_PAINEL_PROJETOS}</p>
      </div>
    </>
  );
}
