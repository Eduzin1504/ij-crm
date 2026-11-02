/**
 * Lixeira de anexos do Projeto (GAB-84), no mesmo molde da de cards (./cards.ts):
 *
 * - `excluirAnexo` (quem escreve): soft-delete — `deletado_em`/`deletado_por_id`
 *   + Timeline `ANEXO` (`evento: "excluido"`). O arquivo fica no disco.
 * - `restaurarAnexo` (gestor+): volta para a lista do Projeto.
 * - `apagarAnexoDefinitivo` (admin, só o que está na lixeira, confirmação
 *   digitando o nome): DELETE da linha e remoção do arquivo do disco; a
 *   Timeline do Projeto ganha `evento: "apagado"`.
 *
 * Apagar o card de vez leva os anexos (FK CASCADE); os arquivos são removidos
 * por `removerArquivosDeAnexos` depois do commit (./cards.ts).
 */
import { Prisma, type Papel } from "@prisma/client";
import { podeEscrever } from "@/lib/auth/papeis";
import { db } from "@/lib/db";
import { removerArquivo } from "@/lib/anexos/armazenamento";
import { registrarErro } from "@/lib/erros/registrar";
import { confirmacaoConfere, podeApagarDeVez, podeRestaurar } from "./regras";
import type { ResultadoLixeira } from "./cards";

type Ator = { id: string; papel: Papel };

export async function excluirAnexo(id: string, por: Ator): Promise<ResultadoLixeira> {
  if (!podeEscrever(por.papel)) return { ok: false, erro: "SEM_PERMISSAO" };
  return db.$transaction(async (tx) => {
    const agora = new Date();
    // Condicional na própria escrita: duas exclusões simultâneas não geram duas entradas.
    const r = await tx.anexo.updateMany({ where: { id, deletadoEm: null, projeto: { deletadoEm: null } }, data: { deletadoEm: agora, deletadoPorId: por.id } });
    if (r.count === 0) return { ok: false, erro: "ANEXO_NAO_ENCONTRADO" } as const;
    const a = await tx.anexo.findUniqueOrThrow({ where: { id }, select: { projetoId: true, nome: true } });
    await tx.timeline.create({ data: { projetoId: a.projetoId, tipo: "ANEXO", payload: { evento: "excluido", anexoId: id, nome: a.nome }, usuarioId: por.id, em: agora } });
    return { ok: true } as const;
  });
}

export async function restaurarAnexo(id: string, por: Ator): Promise<ResultadoLixeira> {
  if (!podeRestaurar(por.papel)) return { ok: false, erro: "SEM_PERMISSAO" };
  try {
    return await restaurarNaTransacao(id, por);
  } catch (e) {
    // Índice único parcial dos vivos: o mesmo arquivo foi anexado de novo depois da exclusão.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { ok: false, erro: "ANEXO_DUPLICADO" };
    throw e;
  }
}

function restaurarNaTransacao(id: string, por: Ator): Promise<ResultadoLixeira> {
  return db.$transaction(async (tx) => {
    // Anexo de card que está na lixeira não volta sozinho: volta com o card.
    const a = await tx.anexo.findFirst({ where: { id, projeto: { deletadoEm: null } }, select: { projetoId: true, nome: true, deletadoEm: true } });
    if (!a) return { ok: false, erro: "ANEXO_NAO_ENCONTRADO" } as const;
    const r = await tx.anexo.updateMany({ where: { id, deletadoEm: { not: null } }, data: { deletadoEm: null, deletadoPorId: null } });
    if (r.count === 0) return { ok: false, erro: "NAO_ESTA_NA_LIXEIRA" } as const;
    await tx.timeline.create({ data: { projetoId: a.projetoId, tipo: "ANEXO", payload: { evento: "restaurado", anexoId: id, nome: a.nome }, usuarioId: por.id } });
    return { ok: true } as const;
  });
}

export async function apagarAnexoDefinitivo(id: string, por: Ator, confirmacao: string): Promise<ResultadoLixeira> {
  if (!podeApagarDeVez(por.papel)) return { ok: false, erro: "SEM_PERMISSAO" };
  const r = await db.$transaction(async (tx) => {
    const travado = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM anexo WHERE id = ${id} FOR UPDATE`;
    if (travado.length === 0) return { ok: false, erro: "ANEXO_NAO_ENCONTRADO" } as const;
    const a = await tx.anexo.findUniqueOrThrow({ where: { id }, select: { projetoId: true, nome: true, deletadoEm: true } });
    if (!a.deletadoEm) return { ok: false, erro: "NAO_ESTA_NA_LIXEIRA" } as const;
    if (!confirmacaoConfere(confirmacao, a.nome)) return { ok: false, erro: "CONFIRMACAO_NAO_CONFERE" } as const;
    await tx.anexo.delete({ where: { id } });
    await tx.timeline.create({ data: { projetoId: a.projetoId, tipo: "ANEXO", payload: { evento: "apagado", anexoId: id, nome: a.nome }, usuarioId: por.id } });
    return { ok: true } as const;
  });
  // Depois do commit: se o DELETE voltasse atrás, o arquivo ainda seria necessário.
  if (r.ok) await removerArquivosDeAnexos([id]);
  return r;
}

/**
 * Remove do disco os arquivos de anexos já apagados do banco. Falha aqui não
 * desfaz nada (a linha já foi): só deixa um arquivo órfão, logado com ref.
 */
export async function removerArquivosDeAnexos(ids: string[]): Promise<void> {
  for (const id of ids) {
    try {
      await removerArquivo(id);
    } catch (e) {
      registrarErro("lixeira.anexos.removerArquivo", e);
    }
  }
}
