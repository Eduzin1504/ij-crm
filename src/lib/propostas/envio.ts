/**
 * Envio ao cliente e resposta (GAB-89, spec fase 2 §4.3/§4.4). Regras PURAS —
 * a tela, as server actions e o MCP seguem estas; o serviço (`propostas.ts`)
 * aplica as mesmas DENTRO da transação, com o usuário relido do banco.
 *
 * - Pronta para envio → vendas baixa o PDF (versão final + parte estruturada)
 *   e marca como ENVIADA. O sistema não manda e-mail.
 * - Enviada → vendas registra a resposta: ACEITA (o Projeto vai para Montando
 *   contrato), RECUSADA (motivo; o Projeto vai para Perdido) ou REVISÃO PEDIDA
 *   (a caneta volta para vendas e o pingue-pongue reabre).
 * - Revisão: se a parte estruturada (escopo, prazo, valor, entregas) mudou
 *   desde a versão enviada, a proposta TEM de passar por projetos (Devolver);
 *   senão vendas conclui a revisão direto (volta a Pronta para envio).
 *
 * Quem age: vendas — o dono da caneta (lado vendas) ou o GP de vendas, em nome
 * do lado (como no pingue-pongue). Gestão sem lado não age. O PDF é leitura:
 * todo mundo que vê a proposta baixa (transparência, §4.12).
 *
 * Sem banco e sem import de valor do Prisma: roda no cliente também.
 */
import type { StatusProposta } from "@prisma/client";
import { ehGpDoLado } from "@/lib/auth/areas";
import { estaComACaneta, ladoDaCaneta, podeAtuarNaCaneta, type EstadoCaneta, type Pessoa } from "./caneta";
import type { ErroProposta } from "./regras";

export const ACOES_ENVIO = ["enviar", "responder", "concluirRevisao"] as const;
export type AcaoEnvio = (typeof ACOES_ENVIO)[number];

export const RESPOSTAS_CLIENTE = ["ACEITA", "RECUSADA", "REVISAO_PEDIDA"] as const;
export type RespostaCliente = (typeof RESPOSTAS_CLIENTE)[number];

export const ROTULO_RESPOSTA: Record<RespostaCliente, string> = {
  ACEITA: "Aceita",
  RECUSADA: "Recusada",
  REVISAO_PEDIDA: "Revisão pedida",
};

/** O que o cliente pediu na revisão (opcional, vai para a Timeline). */
export const PEDIDO_REVISAO_MAX = 1000;

/** Status em que há uma versão final para o PDF: a pronta ou a que foi enviada. */
export const STATUS_COM_PDF: readonly StatusProposta[] = ["PRONTA_PARA_ENVIO", "ENVIADA", "ACEITA", "RECUSADA", "REVISAO_PEDIDA"];

/** Age pelo lado de vendas no envio: o dono da caneta (vendas) ou o GP de vendas. */
export function podeAgirPorVendas(p: Pessoa, e: EstadoCaneta): boolean {
  if (!podeAtuarNaCaneta(p)) return false;
  if (ehGpDoLado(p, "VENDAS")) return true;
  return ladoDaCaneta(e) === "VENDAS" && estaComACaneta(p, e);
}

/** Por que `p` não pode fazer `acao` agora (null = pode). */
export function recusaDoEnvio(acao: AcaoEnvio, p: Pessoa, e: EstadoCaneta): ErroProposta | null {
  switch (acao) {
    case "enviar":
      if (e.status !== "PRONTA_PARA_ENVIO") return "ENVIAR_SO_PRONTA";
      return podeAgirPorVendas(p, e) ? null : "ENVIO_SO_VENDAS";
    case "responder":
      if (e.status !== "ENVIADA") return "RESPONDER_SO_ENVIADA";
      return podeAgirPorVendas(p, e) ? null : "ENVIO_SO_VENDAS";
    case "concluirRevisao":
      if (e.status !== "REVISAO_PEDIDA") return "CONCLUIR_REVISAO_SO_PEDIDA";
      // Como editar: só o dono da caneta (o GP de vendas pega antes, se preciso).
      return estaComACaneta(p, e) && ladoDaCaneta(e) === "VENDAS" ? null : "SEM_CANETA";
  }
}

export function acoesDeEnvio(p: Pessoa, e: EstadoCaneta): AcaoEnvio[] {
  return ACOES_ENVIO.filter((a) => recusaDoEnvio(a, p, e) === null);
}

/**
 * Versão do PDF: pronta → a última versão (é nela que houve consenso); depois
 * do envio → a enviada. Antes de pronta não há PDF (null).
 */
export function versaoDoPdf(e: { status: StatusProposta; versaoEnviada: number | null }, ultimaVersao: number | null): number | null {
  if (!STATUS_COM_PDF.includes(e.status)) return null;
  if (e.status === "PRONTA_PARA_ENVIO") return ultimaVersao;
  return e.versaoEnviada ?? ultimaVersao;
}
