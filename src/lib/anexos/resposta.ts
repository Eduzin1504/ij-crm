/**
 * Cabeçalhos das respostas que servem bytes de anexo (GAB-84). O conteúdo é do
 * usuário: `nosniff` + CSP `sandbox` garantem que nunca roda como HTML/script,
 * mesmo aberto direto na aba; cache só privado (o navegador do usuário logado).
 */
export { ehIdDeAnexo } from "./armazenamento";
import { mensagemInesperada, registrarErro } from "@/lib/erros/registrar";
import { CSP_ANEXO } from "@/lib/rotas/seguranca";

export const SEGURANCA_ANEXO = {
  "x-content-type-options": "nosniff",
  // Igual à do next.config (que sobrescreve esta): src/lib/rotas/seguranca.ts.
  "content-security-policy": CSP_ANEXO,
  "cross-origin-resource-policy": "same-origin",
  "cache-control": "private, no-store",
};

export function respostaTexto(status: number, texto: string, extra: Record<string, string> = {}): Response {
  return new Response(texto, { status, headers: { ...SEGURANCA_ANEXO, "content-type": "text/plain; charset=utf-8", ...extra } });
}

export const semSessao = () => respostaTexto(401, "Sessão expirada. Entre de novo.");
export const naoEncontrado = () => respostaTexto(404, "Anexo não encontrado (pode ter sido excluído).");

/** 500 com a ref no corpo (o usuário vê na aba) e no header; a causa vai para o log com a mesma ref. */
export function erroInesperado(contexto: string, e: unknown): Response {
  const ref = registrarErro(contexto, e);
  return respostaTexto(500, mensagemInesperada(ref), { "x-erro-ref": ref });
}
