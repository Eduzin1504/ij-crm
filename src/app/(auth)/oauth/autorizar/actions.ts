"use server";

import { redirect } from "next/navigation";
import { usuarioAtual } from "@/lib/auth/atual";
import { comTratamentoForm } from "@/lib/erros/registrar";
import { autorizar, CAMPOS_PEDIDO, negar, validarPedidoAutorizacao } from "@/lib/mcp/oauth";

export type EstadoAutorizacao = { erro?: string } | undefined;

/**
 * Consentimento do conector MCP (GAB-83). Revalida o pedido inteiro (a tela
 * pode ter ficado aberta; os campos vêm do navegador) e só então emite o
 * código para a pessoa DA SESSÃO. Qualquer papel conecta: o VISUALIZADOR
 * conecta e só lê, como na tela.
 */
export async function autorizarAction(_prev: EstadoAutorizacao, form: FormData): Promise<EstadoAutorizacao> {
  return comTratamentoForm("mcp.oauth.autorizar", async (): Promise<EstadoAutorizacao> => {
    const eu = await usuarioAtual();
    if (!eu) return { erro: "Sua sessão expirou. Recarregue a página e entre de novo." };
    const q = Object.fromEntries(CAMPOS_PEDIDO.map((c) => [c, typeof form.get(c) === "string" ? (form.get(c) as string) : undefined]));
    const v = await validarPedidoAutorizacao(q);
    if (!v.ok) {
      if (v.redirecionar) redirect(v.url);
      return { erro: v.descricao };
    }
    redirect(form.get("decisao") === "autorizar" ? await autorizar(v.pedido, eu.id) : negar(v.pedido));
  });
}
