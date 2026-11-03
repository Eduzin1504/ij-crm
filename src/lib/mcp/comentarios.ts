/**
 * Ferramentas MCP de comentários na proposta (GAB-91). Só traduzem argumentos
 * e chamam `lib/propostas/comentarios` — a mesma camada da tela, com as mesmas
 * permissões: qualquer usuário ativo comenta, responde, resolve e reabre (o
 * serviço confere o "ativo"). Por isso `escrita: false` (VISUALIZADOR também
 * comenta, como na tela) e `muda: true` nas que gravam (sem `readOnlyHint`).
 */
import { z } from "zod";
import {
  COMENTARIO_MAX,
  comentar,
  listarComentarios,
  MENSAGEM_ERRO_COMENTARIO,
  reabrirComentario,
  resolverComentario,
  responderComentario,
  type ComentarioLido,
  type ErroComentario,
} from "@/lib/propostas/comentarios";
import { TRECHO_MAX } from "@/lib/propostas/ancora";
import type { Ferramenta, Resposta } from "./ferramentas";
import { urlBase } from "./url";

type Forma = z.ZodRawShape;
const ferramenta = <F extends Forma>(f: Ferramenta<F>) => f as unknown as Ferramenta;
const id = z.string().min(1).max(64);
const texto = z.string().min(1).max(COMENTARIO_MAX);
const ok = (dados: unknown): Resposta => ({ ok: true, dados });
const falha = (r: { ok: false; erro: ErroComentario }): Resposta => ({ ok: false, erro: MENSAGEM_ERRO_COMENTARIO[r.erro] });
const urlProposta = (pid: string) => `${urlBase()}/projetos/${pid}/proposta`;

const item = (c: ComentarioLido) => ({ id: c.id, autor: c.autor.nome, texto: c.texto, em: c.criadoEm.toISOString(), ...(c.viaMcp ? { viaMcp: true } : {}) });

const listar = ferramenta({
  nome: "listar_comentarios_proposta",
  titulo: "Listar comentários da proposta",
  descricao:
    "Comentários da proposta do projeto, em threads (mais antigos primeiro): autor, texto, trecho citado (null = comentário geral), `trecho_alterado` (o trecho não está mais no texto atual), respostas e se está resolvido. Por padrão só os abertos; `incluir_resolvidos: true` traz todos.",
  escrita: false,
  entrada: { projeto_id: id, incluir_resolvidos: z.boolean().optional() },
  executar: async (a) => {
    const l = await listarComentarios(a.projeto_id);
    if (!l) return { ok: false, erro: "Projeto não encontrado ou sem proposta." };
    const threads = a.incluir_resolvidos ? l.threads : l.threads.filter((t) => !t.resolvido);
    return ok({
      total: l.threads.length,
      abertos: l.threads.filter((t) => !t.resolvido).length,
      comentarios: threads.map((t) => ({
        ...item(t),
        trecho: t.ancora?.trecho ?? null,
        ...(t.ancora ? { trecho_alterado: t.trechoAlterado } : {}),
        resolvido: t.resolvido ? { por: t.resolvido.por, em: t.resolvido.em.toISOString() } : null,
        respostas: t.respostas.map(item),
      })),
      url: urlProposta(a.projeto_id),
    });
  },
});

const comentarMcp = ferramenta({
  nome: "comentar_proposta",
  titulo: "Comentar na proposta",
  descricao: `Comenta na proposta do projeto (qualquer etapa; não precisa da caneta e não edita o texto). Sem \`trecho\`: comentário geral. Com \`trecho\`: preso a esse trecho do texto ATUAL — cite o texto exato como aparece (até ${TRECHO_MAX} caracteres, sem a marcação Markdown como ** ou #); se aparecer mais de uma vez, vale a primeira. O dono da caneta é avisado no app. Texto puro, até ${COMENTARIO_MAX} caracteres.`,
  escrita: false,
  muda: true,
  entrada: { projeto_id: id, texto, trecho: z.string().min(1).max(TRECHO_MAX).optional() },
  executar: async (a, eu) => {
    const r = await comentar(a.projeto_id, { texto: a.texto, trecho: a.trecho ?? null }, eu);
    return r.ok ? ok({ id: r.comentario.id, url: urlProposta(a.projeto_id) }) : falha(r);
  },
});

const responderMcp = ferramenta({
  nome: "responder_comentario_proposta",
  titulo: "Responder comentário da proposta",
  descricao: `Responde na thread do comentário \`comentario_id\` (de listar_comentarios_proposta; responder a uma resposta entra na mesma thread). Texto puro, até ${COMENTARIO_MAX} caracteres.`,
  escrita: false,
  muda: true,
  entrada: { comentario_id: id, texto },
  executar: async (a, eu) => {
    const r = await responderComentario(a.comentario_id, a.texto, eu);
    return r.ok ? ok({ id: r.comentario.id }) : falha(r);
  },
});

const resolverMcp = ferramenta({
  nome: "resolver_comentario_proposta",
  titulo: "Resolver comentário da proposta",
  descricao: "Marca a thread do comentário como resolvida (fica registrado na Timeline do projeto, com você como autor).",
  escrita: false,
  muda: true,
  entrada: { comentario_id: id },
  executar: async (a, eu) => {
    const r = await resolverComentario(a.comentario_id, eu);
    return r.ok ? ok({ resolvido: true }) : falha(r);
  },
});

const reabrirMcp = ferramenta({
  nome: "reabrir_comentario_proposta",
  titulo: "Reabrir comentário da proposta",
  descricao: "Reabre uma thread de comentário resolvida (fica registrado na Timeline do projeto).",
  escrita: false,
  muda: true,
  entrada: { comentario_id: id },
  executar: async (a, eu) => {
    const r = await reabrirComentario(a.comentario_id, eu);
    return r.ok ? ok({ resolvido: false }) : falha(r);
  },
});

export const FERRAMENTAS_COMENTARIOS: readonly Ferramenta[] = [listar, comentarMcp, responderMcp, resolverMcp, reabrirMcp];
