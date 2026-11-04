/**
 * O PDF do contrato assinado como anexo marcado (GAB-93): a identificação do
 * item do checklist de handoff é a coluna `anexo.contrato_assinado`, nunca o
 * nome do arquivo. Só estas duas portas marcam, e sempre por decisão explícita
 * de quem age. Usadas pelo fluxo de contrato assinado (`contrato-assinado.ts`)
 * e pelo checklist (`handoff.ts`), inclusive para quem chegou a Ganho sem o botão.
 *
 * Toda troca acontece sob o lock da linha do card, com a fase relida: o PDF leva
 * tempo para ser lido, e nesse meio tempo o card pode ter entrado em Execução,
 * quando o contrato não muda mais. Dois envios ao mesmo tempo se enfileiram e o
 * último fica; o índice único parcial garante um só no banco.
 */
import { createHash } from "node:crypto";
import type { Papel, Prisma } from "@prisma/client";
import { anexarArquivo, type AnexoCriado } from "@/lib/anexos/anexos";
import { EXTENSOES_ACEITAS, identificarTipo, sanitizarNome, type ErroAnexo } from "@/lib/anexos/tipos";
import { db } from "@/lib/db";
import { PIPELINE_PROJETOS } from "./terminal-regras";
import { faseDeHandoff, faseExecucao } from "./trava-handoff";

class ContratoEncerrado extends Error {}

/** Em Vendas ou na coluna Handoff o contrato ainda pode mudar; depois, não. Pressupõe a linha do card travada. */
async function exigirContratoAberto(tx: Prisma.TransactionClient, projetoId: string): Promise<void> {
  const card = await tx.projeto.findUniqueOrThrow({ where: { id: projetoId }, select: { fase: true, pipeline: { select: { chave: true } } } });
  if (card.pipeline.chave === PIPELINE_PROJETOS && !faseDeHandoff(card.fase, card.pipeline.chave, await faseExecucao(tx))) throw new ContratoEncerrado();
}

/** Nome sem extensão de arquivo (ou com ponto no meio, "Contrato v1.2") ganha `.pdf`; extensão aceita fica, para o tipo ser conferido. */
function nomeDoContrato(original: string): string {
  const nome = sanitizarNome(original);
  return EXTENSOES_ACEITAS.some((e) => nome.toLowerCase().endsWith(e)) ? nome : sanitizarNome(`${nome}.pdf`);
}

/** Marca o anexo como O contrato do Projeto (desmarca outro). Pressupõe que ele é um PDF vivo desse Projeto. */
export async function definirAnexoDoContrato(tx: Prisma.TransactionClient, projetoId: string, anexoId: string): Promise<void> {
  await tx.anexo.updateMany({ where: { projetoId, contratoAssinado: true, id: { not: anexoId } }, data: { contratoAssinado: false } });
  await tx.anexo.update({ where: { id: anexoId }, data: { contratoAssinado: true } });
}

/**
 * Anexa o PDF marcado. Arquivo já anexado (`DUPLICADO`) não é erro: o que já
 * está lá passa a ser o contrato (`anexo: null`, nada novo foi criado).
 */
export async function anexarPdfDoContrato(
  projetoId: string,
  arquivo: { nome: string; bytes: Uint8Array },
  por: { id: string; papel: Papel },
): Promise<{ ok: true; anexo: AnexoCriado | null } | { ok: false; erro: ErroAnexo | "CONTRATO_NAO_E_PDF" | "HANDOFF_ENCERRADO" }> {
  const nome = nomeDoContrato(arquivo.nome);
  const tipo = identificarTipo(arquivo.bytes, nome);
  if (!tipo.ok) return tipo;
  if (tipo.tipo !== "PDF") return { ok: false, erro: "CONTRATO_NAO_E_PDF" };
  try {
    const r = await anexarArquivo(projetoId, { nome, bytes: arquivo.bytes }, por, { contratoAssinado: true, conferir: (tx) => exigirContratoAberto(tx, projetoId) });
    if (r.ok) return { ok: true, anexo: r.anexo };
    if (r.erro !== "DUPLICADO") return r;
    await marcarJaAnexado(projetoId, arquivo.bytes, por.id);
    return { ok: true, anexo: null };
  } catch (e) {
    if (e instanceof ContratoEncerrado) return { ok: false, erro: "HANDOFF_ENCERRADO" };
    throw e;
  }
}

async function marcarJaAnexado(projetoId: string, bytes: Uint8Array, porId: string): Promise<void> {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM oportunidade WHERE id = ${projetoId} FOR UPDATE`;
    await exigirContratoAberto(tx, projetoId);
    const ja = await tx.anexo.findFirst({ where: { projetoId, sha256, deletadoEm: null }, select: { id: true, nome: true, contratoAssinado: true } });
    if (!ja || ja.contratoAssinado) return;
    await definirAnexoDoContrato(tx, projetoId, ja.id);
    await tx.timeline.create({ data: { projetoId, tipo: "HANDOFF", payload: { evento: "contrato_definido", anexoId: ja.id, nome: ja.nome }, usuarioId: porId } });
  });
}
