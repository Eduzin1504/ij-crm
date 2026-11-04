/**
 * Área dona do card no servidor (GAB-98, spec áreas §4.4): o ponto único que as
 * actions, as rotas e o MCP chamam antes de mover ou editar um card. Fica FORA de
 * `moverCard`/`editarCard`/`aplicarPatch` de propósito: a automação do WhatsApp
 * (#crm) usa esses núcleos e não é restringida por área neste passo (§4.7).
 *
 * Card que não existe não é recusa: quem chamou segue e o serviço responde
 * CARD_NAO_ENCONTRADO, com a mensagem de sempre.
 */
import { podeCriarCardNoQuadro, podeEditarCard, type PessoaComId } from "@/lib/auth/visibilidade";
import type { PessoaComLado } from "@/lib/auth/areas";
import { db } from "@/lib/db";
import { MENSAGEM_ERRO_PROJETO } from "./erros";

const MENSAGEM_CRIAR = "Este quadro é de outra área: aqui você acompanha, mas só quem é da área cria card.";

/** `string` = o texto da recusa (o mesmo na tela e no MCP); `null` = pode. */
export async function recusaDeEdicaoNoCard(cardId: string, p: PessoaComId): Promise<string | null> {
  const card = await db.projeto.findFirst({ where: { id: cardId, deletadoEm: null }, select: { responsavelId: true, pipeline: { select: { chave: true } } } });
  if (!card || podeEditarCard(p, { responsavelId: card.responsavelId, quadro: card.pipeline.chave })) return null;
  return MENSAGEM_ERRO_PROJETO.FORA_DA_AREA;
}

/** Tirar anexo do card: quem o anexou (de fora também) ou quem edita o card. */
export async function recusaDeExcluirAnexo(anexoId: string, p: PessoaComId): Promise<string | null> {
  const anexo = await db.anexo.findFirst({ where: { id: anexoId, deletadoEm: null }, select: { autorId: true, projetoId: true } });
  if (!anexo || anexo.autorId === p.id) return null;
  return recusaDeEdicaoNoCard(anexo.projetoId, p);
}

/** Card novo no quadro, pelo id do pipeline (tela) ou já pela chave (MCP). */
export async function recusaDeCriarNoQuadro(quadro: { pipelineId: string } | { chave: string }, p: PessoaComLado): Promise<string | null> {
  const chave = "chave" in quadro ? quadro.chave : (await db.pipeline.findUnique({ where: { id: quadro.pipelineId }, select: { chave: true } }))?.chave;
  return !chave || podeCriarCardNoQuadro(p, chave) ? null : MENSAGEM_CRIAR;
}
