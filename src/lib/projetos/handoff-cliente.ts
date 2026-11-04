/**
 * Envia o PDF assinado pelo checklist de handoff, pelo navegador (GAB-93). Vai
 * pela rota, como o upload de anexo. A resposta tem o formato de `RespostaAcao`:
 * passe por `executarAcao`, que trata a falha de conexão e a ref.
 */
import type { RespostaAcao } from "@/lib/erros/cliente";

export async function enviarContratoDoHandoff(cardId: string, arquivo: File): Promise<RespostaAcao> {
  const res = await fetch(`/api/projetos/${encodeURIComponent(cardId)}/handoff/contrato`, {
    method: "POST",
    body: arquivo,
    headers: { "Content-Type": "application/octet-stream", "X-Nome-Arquivo": encodeURIComponent(arquivo.name) },
  });
  try {
    return (await res.json()) as RespostaAcao;
  } catch {
    return { erro: `Resposta inesperada do servidor (HTTP ${res.status}). Tente de novo.` };
  }
}
