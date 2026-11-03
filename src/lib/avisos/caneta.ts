/**
 * Caneta da proposta → avisos (GAB-88). Ouvinte registrado em
 * `src/lib/propostas/avisos.ts`: roda depois do commit da passagem.
 *
 * - Quem RECEBE a caneta de outra pessoa (passar, devolver, concordar):
 *   "é sua vez" (app + WhatsApp privado).
 * - GP pegou a caneta: quem estava com ela fica sabendo, só no app
 *   [escolha do agente: não é "sua vez", então não vai ao WhatsApp].
 * - Mudança de status (devolver, concordar, reabrir, inviável; GAB-89: enviada,
 *   recusada, revisão pedida/concluída): só no app, para quem já atuou na
 *   proposta (criou ou teve a caneta), menos quem agiu e quem já recebeu "é
 *   sua vez" no mesmo evento.
 * - GAB-89: cliente aceitou → PROPOSTA_ACEITA (app + WhatsApp privado) para
 *   quem atuou na proposta e o responsável pelo Projeto, menos quem registrou.
 */
import type { TipoAviso } from "@prisma/client";
import { db } from "@/lib/db";
import type { EventoCaneta } from "@/lib/propostas/avisos";
import { ROTULO_STATUS_PROPOSTA } from "@/lib/propostas/regras";
import { emitirAvisos, type NovoAviso } from "./avisos";

const MUDAM_STATUS: ReadonlySet<EventoCaneta["acao"]> = new Set([
  "devolveu",
  "concordou",
  "reabriu",
  "inviavel",
  "enviou",
  "aceita",
  "recusada",
  "revisao_pedida",
  "revisao_concluida",
]);

function tituloSuaVez(e: EventoCaneta, por: string, projeto: string): string {
  if (e.acao === "passou") return `${por} passou para você a caneta da proposta de "${projeto}"`;
  if (e.acao === "devolveu") return `${por} devolveu para você a proposta de "${projeto}"${e.numero ? ` (v${e.numero})` : ""}`;
  if (e.acao === "concordou") return `${por} concordou com a proposta de "${projeto}": pronta para envio, com você`;
  return `É sua vez na proposta de "${projeto}"`;
}

export async function avisosDaCaneta(e: EventoCaneta): Promise<void> {
  const [projeto, por, proposta] = await Promise.all([
    db.projeto.findUnique({ where: { id: e.projetoId }, select: { titulo: true, responsavelId: true } }),
    db.usuario.findUnique({ where: { id: e.porId }, select: { nome: true } }),
    MUDAM_STATUS.has(e.acao)
      ? db.proposta.findUnique({ where: { id: e.propostaId }, select: { criadoPorId: true, periodosCaneta: { select: { usuarioId: true } } } })
      : null,
  ]);
  if (!projeto || !por) return;
  const novo = (usuarioId: string, tipo: TipoAviso, titulo: string): NovoAviso => ({ usuarioId, tipo, titulo, projetoId: e.projetoId });
  const lista: NovoAviso[] = [];

  if (e.paraId && e.paraId !== e.porId) lista.push(novo(e.paraId, "SUA_VEZ", tituloSuaVez(e, por.nome, projeto.titulo)));
  if (e.acao === "pegou" && e.deId && e.deId !== e.porId) {
    lista.push(novo(e.deId, "CANETA_PEGA", `${por.nome} (GP) pegou a caneta da proposta de "${projeto.titulo}", que estava com você`));
  }
  if (proposta) {
    const ja = new Set([e.porId, ...lista.map((a) => a.usuarioId)]);
    const atuaram = new Set([proposta.criadoPorId, ...proposta.periodosCaneta.map((p) => p.usuarioId)]);
    if (e.acao === "aceita") {
      atuaram.add(projeto.responsavelId);
      const titulo = `O cliente aceitou a proposta de "${projeto.titulo}"${e.numero ? ` (v${e.numero})` : ""}: projeto em Montando contrato (${por.nome})`;
      for (const id of atuaram) if (!ja.has(id)) lista.push(novo(id, "PROPOSTA_ACEITA", titulo));
    } else {
      const titulo = `Proposta de "${projeto.titulo}" agora está ${ROTULO_STATUS_PROPOSTA[e.status]} (${por.nome})`;
      for (const id of atuaram) if (!ja.has(id)) lista.push(novo(id, "STATUS_PROPOSTA", titulo));
    }
  }
  await emitirAvisos(lista);
}
