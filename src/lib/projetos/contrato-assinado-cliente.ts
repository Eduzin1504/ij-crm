/**
 * Marcar contrato assinado COM o PDF, pelo navegador (GAB-99). Vai pela rota,
 * como o upload de anexo (src/lib/anexos/cliente.ts): limite próprio de corpo.
 * Sem PDF, o diálogo usa `moverCardAction`. A resposta tem o formato de
 * `RespostaAcao`: passe por `executarAcao`, que trata a falha de conexão e a ref.
 */
import type { RespostaAcao } from "@/lib/erros/cliente";
import type { DadosTerminal } from "./terminal-regras";

export async function enviarContratoAssinado(cardId: string, dados: DadosTerminal | undefined, arquivo: File): Promise<RespostaAcao> {
  const res = await fetch(`/api/projetos/${encodeURIComponent(cardId)}/contrato-assinado`, {
    method: "POST",
    body: arquivo,
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Nome-Arquivo": encodeURIComponent(arquivo.name),
      "X-Valor-Fechado": encodeURIComponent(dados?.valorFechado ?? ""),
    },
  });
  try {
    return (await res.json()) as RespostaAcao;
  } catch {
    return { erro: `Resposta inesperada do servidor (HTTP ${res.status}). Tente de novo.` };
  }
}
