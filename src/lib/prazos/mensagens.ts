/** Texto de cada erro de prazo: o mesmo no Calendário/Minha Semana e no conector MCP (GAB-83). */
import type { ErroPrazo, ResultadoPrazo } from "./prazos";

export const MENSAGEM_ERRO_PRAZO: Record<Exclude<ErroPrazo, "INVALIDO">, string> = {
  PRAZO_NAO_ENCONTRADO: "Prazo não encontrado (pode ter sido excluído). Recarregue a página.",
  SEM_PERMISSAO: "Só o responsável pelo prazo ou a gestão podem mexer nele.",
  RESPONSAVEL_INVALIDO: "Responsável inválido ou inativo.",
  CARD_NAO_ENCONTRADO: "Card não encontrado (pode ter sido excluído). Recarregue a página.",
};

/** Falha de um `ResultadoPrazo` → texto (INVALIDO traz a mensagem da validação). */
export function mensagemFalhaPrazo(r: Extract<ResultadoPrazo, { ok: false }>): string {
  return r.erro === "INVALIDO" ? (r.mensagem ?? "Dados inválidos.") : MENSAGEM_ERRO_PRAZO[r.erro];
}
