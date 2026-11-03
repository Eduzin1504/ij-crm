"use server";

import { exigirUsuario } from "@/lib/auth/atual";
import { contarNaoLidos, marcarLidos } from "@/lib/avisos/avisos";
import { comTratamento } from "@/lib/erros/registrar";

/**
 * Marca como lidos os avisos `ids` (ou todos) do usuário da SESSÃO (GAB-88).
 * Qualquer papel: é o próprio sino, não escreve no CRM. Ids de outra pessoa
 * não têm efeito (o where inclui o usuário).
 */
export async function marcarAvisosLidosAction(ids?: string[]) {
  return comTratamento("sino.marcarLidos", async () => {
    const eu = await exigirUsuario();
    const lista = Array.isArray(ids) ? ids.filter((i): i is string => typeof i === "string" && i.length > 0 && i.length <= 64).slice(0, 200) : undefined;
    await marcarLidos(eu.id, lista);
    return { ok: true as const, naoLidos: await contarNaoLidos(eu.id) };
  });
}
