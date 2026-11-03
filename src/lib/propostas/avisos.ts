/**
 * Ponto de extensão dos avisos da caneta (GAB-87 → GAB-88). O serviço da
 * proposta chama `avisarCaneta` DEPOIS de a transação gravar (nunca dentro: um
 * aviso que falha não desfaz a passagem). O GAB-88 (sino no app + WhatsApp
 * "é sua vez", respeitando `NOTIFICATIONS_ENABLED`) registra o seu ouvinte no
 * fim deste arquivo (`src/lib/avisos/caneta.ts`) — o serviço não muda.
 */
import type { Area, StatusProposta } from "@prisma/client";
import { avisosDaCaneta } from "@/lib/avisos/caneta";
import { registrarErro } from "@/lib/erros/registrar";

export type EventoCaneta = {
  projetoId: string;
  propostaId: string;
  acao:
    | "passou"
    | "devolveu"
    | "concordou"
    | "pegou"
    | "reabriu"
    | "inviavel"
    // GAB-89: envio e resposta do cliente. "aceita" = o aviso "proposta aceita" (§4.11).
    | "enviou"
    | "aceita"
    | "recusada"
    | "revisao_pedida"
    | "revisao_concluida";
  porId: string;
  /** Quem está com a caneta agora (null = ninguém): o "é sua vez". */
  paraId: string | null;
  lado: Area | null;
  status: StatusProposta;
  /** Versão envolvida (devolver/concordar). */
  numero?: number;
  /** Quem estava com a caneta antes (pegar): o GAB-88 avisa essa pessoa. */
  deId?: string | null;
};

type Ouvinte = (e: EventoCaneta) => void | Promise<void>;

const ouvintes = new Set<Ouvinte>();

/** Registra um ouvinte; devolve a função que o remove. */
export function aoMudarCaneta(fn: Ouvinte): () => void {
  ouvintes.add(fn);
  return () => ouvintes.delete(fn);
}

/** Chamado pelo serviço depois do commit. Falha de ouvinte vira log (com ref), nunca erro para quem agiu. */
export async function avisarCaneta(e: EventoCaneta): Promise<void> {
  for (const fn of ouvintes) {
    try {
      await fn(e);
    } catch (erro) {
      registrarErro("proposta.avisoCaneta", erro);
    }
  }
}

// GAB-88: sino no app + WhatsApp privado (src/lib/avisos/caneta.ts).
aoMudarCaneta(avisosDaCaneta);
