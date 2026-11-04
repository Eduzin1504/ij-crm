/**
 * Handoff → avisos (GAB-93, spec fase 2 §4.11): tipo HANDOFF, app + WhatsApp
 * privado. Rodam depois do commit e nunca lançam: a ação já foi gravada.
 *
 * - Ganho (o card chegou ao Handoff): os GPs de projetos, que designam o GP.
 * - GP designado: a pessoa designada.
 * Quem agiu não avisa a si mesmo, como no resto dos avisos.
 */
import { ehGpDoLado } from "@/lib/auth/areas";
import { db } from "@/lib/db";
import { registrarErro } from "@/lib/erros/registrar";
import { emitirAvisos } from "./avisos";

export async function avisarHandoff(projetoId: string, porId: string): Promise<void> {
  try {
    const [projeto, pessoas] = await Promise.all([
      db.projeto.findUnique({ where: { id: projetoId }, select: { titulo: true } }),
      db.usuario.findMany({ where: { ativo: true, cargos: { has: "GP" } }, select: { id: true, papel: true, area: true, cargos: true } }),
    ]);
    if (!projeto) return;
    const gps = pessoas.filter((p) => ehGpDoLado(p, "PROJETOS"));
    // Ninguém para designar o GP: o card ficaria parado sem ninguém saber.
    if (gps.length === 0) console.warn(`[avisos] handoff do projeto ${projetoId}: nenhum GP de projetos ativo para avisar`);
    const titulo = `Proposta aceita / handoff: "${projeto.titulo}" chegou ao Handoff. Designe o GP do projeto.`;
    await emitirAvisos(gps.filter((p) => p.id !== porId).map((p) => ({ usuarioId: p.id, tipo: "HANDOFF" as const, titulo, projetoId })));
  } catch (e) {
    registrarErro("avisos.handoff", e);
  }
}

export async function avisarGpDesignado(projetoId: string, gpId: string, porId: string): Promise<void> {
  if (gpId === porId) return;
  try {
    const projeto = await db.projeto.findUnique({ where: { id: projetoId }, select: { titulo: true } });
    if (!projeto) return;
    await emitirAvisos([{ usuarioId: gpId, tipo: "HANDOFF", titulo: `Handoff: você é o GP do projeto "${projeto.titulo}" e o responsável na execução.`, projetoId }]);
  } catch (e) {
    registrarErro("avisos.handoff.gp", e);
  }
}
