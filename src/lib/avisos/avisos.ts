/**
 * Camada única de avisos (GAB-88, spec fase 2 §4.11). Todo aviso nasce em
 * `emitirAvisos`: caneta (./caneta.ts) hoje; comentários, envio e handoff nos
 * próximos tickets chamam a mesma função.
 *
 * - **Sino no app**: sempre (uma linha em `aviso` por pessoa). O sino consulta
 *   por polling (`contarNaoLidos`: uma query no índice usuario_id + lido_em).
 * - **WhatsApp privado**: só os tipos de `vaiPorWhatsapp` ("é sua vez",
 *   "aceita/handoff"). Decide na hora e grava em `aviso.whatsapp`:
 *   preferência desligada → DESLIGADO; sem telefone → SEM_TELEFONE (só app, sem
 *   erro); safe mode (`NOTIFICATIONS_ENABLED`≠true) → SAFE_MODE e o log diz o
 *   que seria enviado, com a ref; senão PENDENTE e o envio roda em segundo
 *   plano (a Evolution pode levar até 60 s: quem agiu não espera), terminando
 *   em ENVIADO ou FALHOU (log com a ref, a mesma gravada no aviso). PENDENTE
 *   com mais de 5 min (processo caiu no meio) vira FALHOU quando o sino lista.
 *   O envio vai com `projetoId: null`: aviso privado não é mensagem do card.
 * - Nunca lança: erro inesperado vira log com ref e `{ ok: false, ref }`. A
 *   ação que gerou o aviso já foi gravada e não é desfeita.
 */
import type { EnvioAviso, TipoAviso } from "@prisma/client";
import { notificacoesAtivas } from "@/lib/config/env";
import { db } from "@/lib/db";
import { registrarErro } from "@/lib/erros/registrar";
import { urlBase } from "@/lib/mcp/url";
import { lerPreferencias, whatsappAvisosLigado } from "@/lib/preferencias/preferencias";
import { enviarWhatsApp, ErroPosEnvio } from "@/lib/whatsapp/enviar";
import { mascararJid } from "@/lib/whatsapp/mascarar";
import { hrefAviso, jidPrivado, textoWhatsapp, vaiPorWhatsapp } from "./regras";

export type NovoAviso = { usuarioId: string; tipo: TipoAviso; titulo: string; projetoId?: string | null };

export type AvisoDoSino = {
  id: string;
  tipo: TipoAviso;
  titulo: string;
  href: string | null;
  lido: boolean;
  criadoEm: Date;
  /** Ref do log quando o WhatsApp deste aviso falhou (o sino mostra). */
  whatsappFalhouRef: string | null;
};

export const LISTA_PADRAO = 20;
/** PENDENTE mais velho que isto = o processo caiu no meio do envio (o timeout da Evolution é 60 s). */
export const PENDENTE_MAX_MS = 5 * 60_000;
export const LISTA_MAX = 50;

const novaRef = () => crypto.randomUUID().replace(/-/g, "").slice(0, 8);

/** Envios reais em andamento (segundo plano). Testes e scripts esperam com `aguardarWhatsappPendente`. */
const pendentes = new Set<Promise<void>>();

export async function aguardarWhatsappPendente(): Promise<void> {
  await Promise.allSettled([...pendentes]);
}

function urlAbsoluta(href: string | null): string | null {
  if (!href) return null;
  try {
    return `${urlBase()}${href}`;
  } catch {
    return null; // APP_URL ausente em produção: manda sem link em vez de não avisar
  }
}

const chave = (a: { usuarioId: string; tipo: TipoAviso; projetoId?: string | null }) => `${a.usuarioId}|${a.tipo}|${a.projetoId ?? ""}`;

/** Emite avisos (um por pessoa/tipo/projeto). Nunca lança. */
export async function emitirAvisos(novos: NovoAviso[]): Promise<{ ok: true } | { ok: false; ref: string }> {
  try {
    const unicos = [...new Map(novos.map((n) => [chave(n), n])).values()];
    if (unicos.length === 0) return { ok: true };
    const pessoas = await db.usuario.findMany({
      where: { id: { in: [...new Set(unicos.map((n) => n.usuarioId))] }, ativo: true },
      select: { id: true, telefoneWhatsapp: true, preferencias: true },
    });
    const porId = new Map(pessoas.map((p) => [p.id, p]));
    const ativos = unicos.filter((n) => porId.has(n.usuarioId));
    if (ativos.length === 0) return { ok: true };

    const ligado = notificacoesAtivas();
    const planos = ativos.map((n) => {
      const p = porId.get(n.usuarioId)!;
      const href = hrefAviso({ tipo: n.tipo, projetoId: n.projetoId ?? null });
      let whatsapp: EnvioAviso | null = null;
      let whatsappRef: string | null = null;
      let jid: string | null = null;
      const texto = textoWhatsapp(n.titulo, urlAbsoluta(href));
      if (vaiPorWhatsapp(n.tipo)) {
        if (!whatsappAvisosLigado(lerPreferencias(p.preferencias))) whatsapp = "DESLIGADO";
        else if (!p.telefoneWhatsapp) whatsapp = "SEM_TELEFONE";
        else {
          jid = jidPrivado(p.telefoneWhatsapp);
          if (ligado) whatsapp = "PENDENTE";
          else {
            whatsapp = "SAFE_MODE";
            whatsappRef = novaRef();
            console.info(`[avisos] ref=${whatsappRef} SAFE MODE: WhatsApp NÃO enviado para ${mascararJid(jid)} (${n.tipo}). Seria: ${JSON.stringify(texto)}`);
          }
        }
      }
      return { n, whatsapp, whatsappRef, jid, texto };
    });

    const criados = await db.aviso.createManyAndReturn({
      data: planos.map((p) => ({ usuarioId: p.n.usuarioId, tipo: p.n.tipo, titulo: p.n.titulo, projetoId: p.n.projetoId ?? null, whatsapp: p.whatsapp, whatsappRef: p.whatsappRef })),
      select: { id: true, usuarioId: true, tipo: true, projetoId: true },
    });
    // Casa por chave (única no lote), não pela ordem do RETURNING.
    const idPorChave = new Map(criados.map((c) => [chave(c), c.id]));

    for (const p of planos) {
      const avisoId = idPorChave.get(chave(p.n));
      if (p.whatsapp !== "PENDENTE" || !p.jid || !avisoId) continue;
      // projetoId null: aviso privado não é mensagem do card (Lixeira/contagens de `mensagem_enviada`).
      const envio = enviarEmSegundoPlano(avisoId, p.jid, p.texto);
      pendentes.add(envio);
      void envio.finally(() => pendentes.delete(envio));
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, ref: registrarErro("avisos.emitir", e) };
  }
}

/** Envia e grava o resultado no aviso. Nunca rejeita. */
async function enviarEmSegundoPlano(avisoId: string, jid: string, texto: string): Promise<void> {
  let resultado: { whatsapp: EnvioAviso; whatsappRef: string | null };
  try {
    const r = await enviarWhatsApp({ para: jid, texto, projetoId: null });
    if (r.enviada) resultado = { whatsapp: "ENVIADO", whatsappRef: null };
    else {
      // Safe mode ligado entre a decisão e o envio: o sender só logou.
      const ref = novaRef();
      console.info(`[avisos] ref=${ref} SAFE MODE: WhatsApp NÃO enviado para ${mascararJid(jid)}. Seria: ${JSON.stringify(texto)}`);
      resultado = { whatsapp: "SAFE_MODE", whatsappRef: ref };
    }
  } catch (e) {
    if (e instanceof ErroPosEnvio) {
      // A Evolution entregou; só o registro local falhou.
      console.warn(`[avisos] WhatsApp entregue para ${mascararJid(jid)} mas não registrado (${e.message})`);
      resultado = { whatsapp: "ENVIADO", whatsappRef: null };
    } else {
      resultado = { whatsapp: "FALHOU", whatsappRef: registrarErro("avisos.whatsapp", e) };
    }
  }
  try {
    await db.aviso.update({ where: { id: avisoId }, data: resultado });
  } catch (e) {
    registrarErro("avisos.whatsapp.gravar", e);
  }
}

// ---------------------------------------------------------------- sino (sempre do próprio usuário)

/** O que o polling do sino consulta: uma contagem no índice (usuario_id, lido_em). */
export function contarNaoLidos(usuarioId: string): Promise<number> {
  return db.aviso.count({ where: { usuarioId, lidoEm: null } });
}

/**
 * PENDENTE preso (o container reiniciou no meio do envio, o segundo plano
 * morreu junto) vira FALHOU com ref no log. Roda na leitura do sino: barato
 * (índice usuario_id) e só acha linha quando houve queda.
 */
async function encerrarPendentesPresos(usuarioId: string): Promise<void> {
  const presos = await db.aviso.findMany({
    where: { usuarioId, whatsapp: "PENDENTE", criadoEm: { lt: new Date(Date.now() - PENDENTE_MAX_MS) } },
    select: { id: true },
  });
  for (const a of presos) {
    const ref = registrarErro("avisos.whatsapp", new Error(`envio do aviso ${a.id} interrompido: PENDENTE há mais de ${PENDENTE_MAX_MS / 60_000} min (processo reiniciou?)`));
    await db.aviso.updateMany({ where: { id: a.id, whatsapp: "PENDENTE" }, data: { whatsapp: "FALHOU", whatsappRef: ref } });
  }
}

export async function listarAvisos(usuarioId: string, opcoes: { soNaoLidos?: boolean; limite?: number } = {}): Promise<AvisoDoSino[]> {
  await encerrarPendentesPresos(usuarioId);
  const limite = Math.min(Math.max(1, Math.trunc(opcoes.limite ?? LISTA_PADRAO)), LISTA_MAX);
  const avisos = await db.aviso.findMany({
    where: { usuarioId, ...(opcoes.soNaoLidos ? { lidoEm: null } : {}) },
    orderBy: [{ criadoEm: "desc" }, { id: "desc" }],
    take: limite,
    select: { id: true, tipo: true, titulo: true, projetoId: true, lidoEm: true, criadoEm: true, whatsapp: true, whatsappRef: true },
  });
  return avisos.map((a) => ({
    id: a.id,
    tipo: a.tipo,
    titulo: a.titulo,
    href: hrefAviso(a),
    lido: a.lidoEm !== null,
    criadoEm: a.criadoEm,
    whatsappFalhouRef: a.whatsapp === "FALHOU" ? a.whatsappRef : null,
  }));
}

/** Marca como lidos (os `ids`, ou todos). Só avisos do próprio usuário; devolve quantos mudaram. */
export async function marcarLidos(usuarioId: string, ids?: readonly string[]): Promise<number> {
  if (ids && ids.length === 0) return 0;
  const r = await db.aviso.updateMany({
    where: { usuarioId, lidoEm: null, ...(ids ? { id: { in: [...ids] } } : {}) },
    data: { lidoEm: new Date() },
  });
  return r.count;
}
