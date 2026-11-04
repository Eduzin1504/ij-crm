/**
 * Guardas das ferramentas MCP (GAB-98): a mesma regra de área e de proposta da tela,
 * declarada em cada ferramenta (`guarda`) e aplicada numa porta só (`executarFerramenta`).
 * `string` = o texto da recusa, em português; `null` = pode.
 */
import { recusaDeEdicaoNoCard } from "@/lib/projetos/acesso-card";
import { MENSAGEM_SEM_ACESSO_PROPOSTA, podeVerPropostaDoProjeto } from "@/lib/propostas/acesso";
import type { UsuarioMcp } from "./oauth";

/** Mover e editar dados: área dona ou responsável. O id do card vem em `id`. */
export const cardEditavel = (a: { id: string }, eu: UsuarioMcp) => recusaDeEdicaoNoCard(a.id, eu);

/** Proposta do projeto `projeto_id`: quem está escalado, o GP e a gestão. */
export async function propostaVisivel(a: { projeto_id: string }, eu: UsuarioMcp): Promise<string | null> {
  return (await podeVerPropostaDoProjeto(eu, a.projeto_id)) ? null : MENSAGEM_SEM_ACESSO_PROPOSTA;
}
