/**
 * "Contrato assinado" (GAB-99, spec fase 2 §4.2/§4.9): a porta única da tela e
 * do MCP. Leva o Projeto a Ganho pelo `moverCard` (trava, data, valor e Handoff
 * moram lá) e anexa o PDF assinado, opcional, pelo sistema de anexos.
 *
 * Ordem: confere tudo que dá sem gravar → anexa → move. Anexo ruim não deixa o
 * card ganho sem o PDF, e a extração de texto do PDF não roda com o quadro
 * travado. Se o movimento falhar depois de anexar (corrida), o PDF fica no
 * Projeto: tentar de novo funciona, porque arquivo já anexado (`DUPLICADO`)
 * não é erro aqui; o PDF também pode ter sido anexado antes, pelo bloco Anexos.
 * GAB-93: o anexo sai marcado como O contrato assinado (item do checklist de
 * handoff), mesmo o que já estava lá, porque quem marca está dizendo que é ele.
 *
 * O destino é sempre o marco Ganho, mesmo que a Gestão tenha criado outra fase
 * de ganho no quadro: todas levam ao Handoff.
 */
import type { Papel } from "@prisma/client";
import type { AnexoCriado } from "@/lib/anexos/anexos";
import { MENSAGEM_ERRO_ANEXO, type ErroAnexo } from "@/lib/anexos/tipos";
import { podeEscrever } from "@/lib/auth/papeis";
import { db } from "@/lib/db";
import { anexarPdfDoContrato } from "./contrato-anexo";
import { MENSAGEM_ERRO_PROJETO, type ErroProjeto } from "./erros";
import { moverCard } from "./projetos";
import { interpretarGanho, lerDinheiro, PIPELINE_VENDAS, valorParaCampo } from "./terminal-regras";
import { travaDoContrato } from "./trava-contrato";

export type ErroContratoAssinado = ErroProjeto | ErroAnexo | "CONTRATO_NAO_E_PDF" | "PROJETO_FORA_DE_VENDAS" | "FASE_GANHO_INDISPONIVEL";

export const MENSAGEM_ERRO_CONTRATO: Record<ErroContratoAssinado, string> = {
  ...MENSAGEM_ERRO_ANEXO,
  ...MENSAGEM_ERRO_PROJETO,
  CONTRATO_NAO_E_PDF: "O contrato assinado precisa ser um PDF.",
  PROJETO_FORA_DE_VENDAS: "Esse projeto não está mais no quadro de Vendas: o contrato já foi marcado como assinado, ou o projeto nunca passou por Vendas.",
  FASE_GANHO_INDISPONIVEL: "O quadro de Vendas está sem o marco Ganho ativo. Peça à gestão/admin para conferir as fases.",
};

export type DadosContratoAssinado = {
  /** Como no diálogo ("12.500,00"; vazio = sem valor). `undefined` mantém o valor já guardado no Projeto. */
  valorFechado?: string;
  arquivo?: { nome: string; bytes: Uint8Array } | null;
};

/** `valorFechado`: como ficou no Projeto ("12500.00"; null = ganho sem valor). */
export type ResultadoContratoAssinado = { ok: true; mudou: boolean; anexo: AnexoCriado | null; valorFechado: string | null } | { ok: false; erro: ErroContratoAssinado };

export async function marcarContratoAssinado(projetoId: string, dados: DadosContratoAssinado, por: { id: string; papel: Papel }): Promise<ResultadoContratoAssinado> {
  if (!podeEscrever(por.papel)) return { ok: false, erro: "SEM_PERMISSAO" };
  if (dados.valorFechado !== undefined) {
    const v = interpretarGanho({ valorFechado: dados.valorFechado });
    if (!v.ok) return { ok: false, erro: v.erro };
  }

  const previa = await db.$transaction(async (tx) => {
    const card = await tx.projeto.findFirst({
      where: { id: projetoId, deletadoEm: null },
      select: { valorFechado: true, fase: true, pipeline: { select: { chave: true } } },
    });
    if (!card) return { erro: "CARD_NAO_ENCONTRADO" as const };
    if (card.pipeline.chave !== PIPELINE_VENDAS) return { erro: "PROJETO_FORA_DE_VENDAS" as const };
    const ganho = await tx.fase.findUnique({ where: { marco: "GANHO" } });
    if (!ganho || ganho.arquivadaEm || ganho.pipelineId !== card.fase.pipelineId) return { erro: "FASE_GANHO_INDISPONIVEL" as const };
    const trava = await travaDoContrato(tx, { projetoId, origem: card.fase, destino: ganho });
    if (trava) return { erro: trava.erro };
    return { ganhoId: ganho.id, valorAtual: valorParaCampo(card.valorFechado?.toFixed(2) ?? null) };
  });
  if (previa.erro) return { ok: false, erro: previa.erro };

  let anexo: AnexoCriado | null = null;
  if (dados.arquivo) {
    const r = await anexarPdfDoContrato(projetoId, dados.arquivo, por);
    if (!r.ok) return r;
    anexo = r.anexo;
  }

  const valorFechado = dados.valorFechado ?? previa.valorAtual;
  const movido = await moverCard(projetoId, previa.ganhoId, por, { dadosTerminal: { valorFechado } });
  if (!movido.ok) return movido;
  const lido = lerDinheiro(valorFechado);
  return { ok: true, mudou: movido.mudou, anexo, valorFechado: lido.ok ? lido.valor : null };
}
