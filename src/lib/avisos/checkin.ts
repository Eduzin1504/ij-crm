/**
 * Lembrete de check-in (GAB-95, spec §4.10/§4.11): só no app, tipo CHECKIN_ATRASADO.
 * O cron roda a cada 10 min (`cron/manutencao.ts`) e cobra a semana que acabou de passar.
 *
 * - Uma vez por semana e por Projeto: `lembrete_checkin` (projeto, semana) é a marca. Falhou ao
 *   emitir, tira a marca e a próxima rodada tenta de novo.
 * - Só para o GP do projeto (ou o responsável, sem GP válido). Sem ninguém ativo que escreve, ninguém é lembrado.
 * - Sem spam em quem não tem acompanhamento: card já em Execução no deploy (sem `execucao_desde`) só é cobrado
 *   depois de ter entrega ou check-in. A semana em que o acompanhamento começa não é cobrada.
 */
import { podeEscrever } from "@/lib/auth/papeis";
import { db } from "@/lib/db";
import { registrarErro } from "@/lib/erros/registrar";
import { gpDoProjeto } from "@/lib/projetos/execucao-regras";
import { diaParaColuna, inicioDoAcompanhamento, semanaCobrada, semanaCobravel } from "@/lib/projetos/execucao-semana";
import { formatarDia } from "@/lib/projetos/formatar";
import { PIPELINE_PROJETOS } from "@/lib/projetos/terminal-regras";
import { faseDeExecucaoAberta } from "@/lib/projetos/trava-handoff";
import { emitirAvisos } from "./avisos";

export async function lembrarCheckinsAtrasados(agora = new Date()): Promise<{ lembretes: number; refs: string[] }> {
  const refs: string[] = [];
  const ex = await db.fase.findUnique({ where: { marco: "EXECUCAO" } });
  if (!ex) return { lembretes: 0, refs };
  const fases = await db.fase.findMany({ where: { pipelineId: ex.pipelineId }, include: { pipeline: { select: { chave: true } } } });
  const abertas = fases.filter((f) => f.pipeline.chave === PIPELINE_PROJETOS && faseDeExecucaoAberta(f, f.pipeline.chave, ex)).map((f) => f.id);
  if (abertas.length === 0) return { lembretes: 0, refs };

  const semana = semanaCobrada(agora);
  const coluna = diaParaColuna(semana);
  const cards = await db.projeto.findMany({
    where: { faseId: { in: abertas }, deletadoEm: null, absorvidoPorId: null, checkins: { none: { semana: coluna } }, lembretesCheckin: { none: { semana: coluna } } },
    select: {
      id: true,
      titulo: true,
      execucaoDesde: true,
      responsavelId: true,
      responsavel: { select: { id: true, ativo: true, papel: true } },
      handoff: { select: { gpProjeto: { select: { id: true, ativo: true, papel: true, area: true, cargos: true } } } },
      entregas: { where: { canceladaEm: null }, orderBy: { criadoEm: "asc" }, take: 1, select: { criadoEm: true } },
      checkins: { orderBy: { em: "asc" }, take: 1, select: { em: true } },
    },
  });

  let lembretes = 0;
  for (const c of cards) {
    const inicio = inicioDoAcompanhamento(c.execucaoDesde, [c.entregas[0]?.criadoEm, c.checkins[0]?.em]);
    if (!semanaCobravel(inicio, semana)) continue;
    const gp = c.handoff?.gpProjeto;
    const usuarioId = gpDoProjeto({ responsavelId: c.responsavelId, gpDesignado: gp });
    const destinatario = gp?.id === usuarioId ? gp : c.responsavel;
    if (!destinatario.ativo || !podeEscrever(destinatario.papel)) continue;
    const marca = await db.lembreteCheckin.createMany({ data: [{ projetoId: c.id, semana: coluna }], skipDuplicates: true });
    if (marca.count === 0) continue;
    const r = await emitirAvisos([{ usuarioId, tipo: "CHECKIN_ATRASADO", titulo: `Check-in: "${c.titulo}" ficou sem check-in na semana de ${formatarDia(semana)}.`, projetoId: c.id }]);
    if (r.ok) {
      lembretes++;
    } else {
      refs.push(r.ref);
      try {
        await db.lembreteCheckin.deleteMany({ where: { projetoId: c.id, semana: coluna } });
      } catch (e) {
        refs.push(registrarErro("avisos.checkin", e));
      }
    }
  }
  return { lembretes, refs };
}
