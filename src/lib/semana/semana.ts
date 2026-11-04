/**
 * Minha Semana (GAB-33), leitura: cards do vendedor em pipelines abertos e a
 * escolha de QUAL vendedor ver. Permissão do filtro é decidida aqui, no
 * servidor: vendedor sempre vê a própria semana, mesmo que mande `?vendedor=`.
 */
import { veOutrasAgendas, type PessoaComId } from "@/lib/auth/visibilidade";
import { pessoasComAgendaVisivel } from "@/lib/calendario/calendario";
import { db } from "@/lib/db";
import { SELECAO_NOME_EXIBIDO, nomeExibido } from "@/lib/entidades/vinculo";
import { agruparSemana, type Semana } from "./agrupar";

export async function listarCardsDoVendedor(responsavelId: string) {
  const cards = await db.projeto.findMany({
    // Aberto = vivo e fora de fase terminal (ganho/perdido), em qualquer quadro.
    where: { responsavelId, deletadoEm: null, fase: { isTerminal: false } },
    select: {
      id: true,
      titulo: true,
      proximaAcao: true,
      proximaAcaoEm: true,
      faseDesde: true,
      revisar: true,
      pipeline: { select: { chave: true, nome: true } },
      fase: { select: { nome: true, limiteDiasAlerta: true } },
      // Empresa mesclada aparece com o nome da principal (GAB-36).
      empresa: { select: SELECAO_NOME_EXIBIDO },
    },
  });
  return cards.map((c) => ({ ...c, empresa: c.empresa ? { nome: nomeExibido(c.empresa) } : null }));
}

export type CardSemana = Awaited<ReturnType<typeof listarCardsDoVendedor>>[number];

export async function carregarSemana(responsavelId: string, agora: Date): Promise<Semana<CardSemana>> {
  return agruparSemana(await listarCardsDoVendedor(responsavelId), agora);
}

export type Vendedor = { id: string; nome: string };

export type EscolhaVendedor = {
  alvo: Vendedor;
  /** Gestor/admin: mostra o seletor. */
  podeTrocar: boolean;
  /** Quem o ator pode ver (vazio para quem não pode trocar). */
  opcoes: Vendedor[];
};

/**
 * `pedido` vem da URL (não confiável). Só a gestão troca, com a mesma regra de quem
 * vê quem do Calendário (GAB-98, `pessoasComAgendaVisivel`): gestor com área, o mesmo
 * lado; gestor sem área e admin, todos. Qualquer outra coisa cai na própria semana,
 * sem erro. VISUALIZADOR não chega aqui: a rota barra (`exigirItem("semana")`).
 */
export async function resolverVendedor(ator: PessoaComId, pedido: string | undefined): Promise<EscolhaVendedor> {
  const podeTrocar = veOutrasAgendas(ator);
  const opcoes = await pessoasComAgendaVisivel(ator);
  const proprio = await db.usuario.findUniqueOrThrow({ where: { id: ator.id }, select: { id: true, nome: true } });
  const escolhido = pedido ? opcoes.find((o) => o.id === pedido) : undefined;
  return { alvo: escolhido ?? proprio, podeTrocar, opcoes };
}
