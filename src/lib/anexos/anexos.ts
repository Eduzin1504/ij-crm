/**
 * Anexos do Projeto (GAB-84, spec fase 2 §4.7): upload com texto extraído e
 * leitura. Excluir/restaurar/apagar de vez ficam com a lixeira
 * (src/lib/lixeira/anexos.ts), como os cards.
 *
 * Upload, em ordem: permissão (VISUALIZADOR não anexa) → tipo pelos bytes
 * (./tipos.ts) → extração de texto (./extrair.ts, pode recusar arquivo
 * corrompido) → card vivo e não duplicado → grava o arquivo (./armazenamento.ts)
 * → linha + Timeline numa transação. Se a transação falhar, o arquivo é
 * removido: nunca sobra linha sem arquivo nem arquivo sem linha (exceto um
 * crash do processo entre as duas etapas, que deixa só um arquivo órfão).
 *
 * Leitura: qualquer usuário logado (inclusive VISUALIZADOR); só anexo vivo de
 * card vivo — card na lixeira esconde os anexos junto.
 */
import { createHash } from "node:crypto";
import { Prisma, type Papel } from "@prisma/client";
import { podeEscrever } from "@/lib/auth/papeis";
import { db } from "@/lib/db";
import { registrarErro } from "@/lib/erros/registrar";
import { gravarArquivo, novoIdAnexo, removerArquivo } from "./armazenamento";
import { extrairTexto } from "./extrair";
import { identificarTipo, sanitizarNome, type ErroAnexo } from "./tipos";

type Ator = { id: string; papel: Papel };

export type ResultadoAnexo<T = object> = ({ ok: true } & T) | { ok: false; erro: ErroAnexo };

export type AnexoCriado = { id: string; nome: string; semTexto: boolean };

export async function anexarArquivo(projetoId: string, arquivo: { nome: string; bytes: Uint8Array }, por: Ator): Promise<ResultadoAnexo<{ anexo: AnexoCriado }>> {
  if (!podeEscrever(por.papel)) return { ok: false, erro: "SEM_PERMISSAO" };
  const nome = sanitizarNome(arquivo.nome);
  const id = identificarTipo(arquivo.bytes, nome);
  if (!id.ok) return id;
  const anexoId = novoIdAnexo();
  const extracao = await extrairTexto(id.tipo, arquivo.bytes);
  if (!extracao.ok) return extracao;
  // Extração abortada (PDF que estourou tempo/memória no processo filho): o anexo
  // entra "sem texto" e a causa fica no log, com ref. Só o começo do id: o id
  // inteiro (32 hex) seria redigido como token; `WHERE id LIKE '<prefixo>%'` acha.
  if (extracao.falha) registrarErro("anexos.extrairTexto", new Error(`anexo ${anexoId.slice(0, 12)} (${id.tipo}) ficou sem texto: ${extracao.falha}`));
  const sha256 = createHash("sha256").update(arquivo.bytes).digest("hex");

  const card = await db.projeto.findFirst({ where: { id: projetoId, deletadoEm: null }, select: { id: true } });
  if (!card) return { ok: false, erro: "CARD_NAO_ENCONTRADO" };
  if (await db.anexo.findFirst({ where: { projetoId, sha256, deletadoEm: null }, select: { id: true } })) return { ok: false, erro: "DUPLICADO" };

  const semTexto = extracao.texto === null;
  await gravarArquivo(anexoId, arquivo.bytes);
  try {
    const criado = await db.$transaction(async (tx) => {
      // Relido dentro da transação, com a linha travada (FOR SHARE): o card pode ter ido
      // para a lixeira enquanto o PDF era lido, e "apagar de vez" (FOR UPDATE) espera este upload.
      const vivo = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM oportunidade WHERE id = ${projetoId} AND deletado_em IS NULL FOR SHARE`;
      if (vivo.length === 0) return null;
      const agora = new Date();
      await tx.anexo.create({
        data: { id: anexoId, projetoId, nome, tipo: id.tipo, mime: id.mime, tamanho: arquivo.bytes.length, sha256, texto: extracao.texto, semTexto, autorId: por.id, criadoEm: agora },
      });
      await tx.timeline.create({ data: { projetoId, tipo: "ANEXO", payload: { evento: "adicionado", anexoId, nome, semTexto }, usuarioId: por.id, em: agora } });
      return true;
    });
    if (!criado) {
      await removerArquivo(anexoId);
      return { ok: false, erro: "CARD_NAO_ENCONTRADO" };
    }
  } catch (e) {
    await removerArquivo(anexoId).catch(() => {});
    // Índice único parcial (oportunidade_id, sha256) dos vivos: dois uploads iguais ao mesmo tempo.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { ok: false, erro: "DUPLICADO" };
    throw e;
  }
  return { ok: true, anexo: { id: anexoId, nome, semTexto } };
}

/** Lista do detalhe do Projeto (mais recente primeiro). Sem o texto: só quantos caracteres ele tem. */
export async function listarAnexos(projetoId: string) {
  const linhas = await db.$queryRaw<{ id: string; caracteres: number | null }[]>`
    SELECT id, char_length(texto)::int AS caracteres FROM anexo WHERE oportunidade_id = ${projetoId} AND deletado_em IS NULL`;
  const caracteres = new Map(linhas.map((l) => [l.id, l.caracteres ?? 0]));
  const anexos = await db.anexo.findMany({
    where: { projetoId, deletadoEm: null, projeto: { deletadoEm: null } },
    orderBy: [{ criadoEm: "desc" }, { id: "asc" }],
    select: { id: true, nome: true, tipo: true, mime: true, tamanho: true, semTexto: true, criadoEm: true, autor: { select: { id: true, nome: true } } },
  });
  return anexos.map((a) => ({ ...a, caracteres: caracteres.get(a.id) ?? 0 }));
}

export type AnexoDoProjeto = Awaited<ReturnType<typeof listarAnexos>>[number];

const VIVO = { deletadoEm: null, projeto: { deletadoEm: null } } as const;

/** Metadados para servir o arquivo (rota de download). `null` = 404. */
export async function obterAnexoParaDownload(id: string) {
  return db.anexo.findFirst({ where: { id, ...VIVO }, select: { id: true, nome: true, mime: true, tamanho: true, projetoId: true } });
}

/** Texto extraído (rota de texto, MCP). `texto: null` com `semTexto` = escaneado/imagem, aguardando OCR. */
export async function lerTextoDoAnexo(id: string) {
  return db.anexo.findFirst({ where: { id, ...VIVO }, select: { id: true, nome: true, tipo: true, semTexto: true, texto: true, projetoId: true } });
}
