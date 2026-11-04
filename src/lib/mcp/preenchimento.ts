/**
 * Ferramenta MCP do preenchimento da proposta a partir de anexo (GAB-90).
 * Fica num arquivo próprio para não disputar `ferramentas.ts` com as outras
 * fatias da proposta; entra em `FERRAMENTAS` como as demais e passa pela
 * mesma porta (`executarFerramenta`: VISUALIZADOR recusado, "via MCP").
 *
 * Chama a MESMA camada da tela: `sugerirDeAnexo` (caneta: só o dono, com o pingue-pongue em
 * curso, conferida antes do LLM) e, para gravar, `salvarRascunho`
 * (permissão + revisão otimista). Sem `aplicar`, só devolve a sugestão —
 * gravar depois com `editar_proposta` não chama o LLM de novo.
 */
import { z } from "zod";
import { estruturadoParaEntrada, ESTRUTURADO_VAZIO } from "@/lib/propostas/estruturado";
import { sugerirDeAnexo } from "@/lib/propostas/preenchimento";
import { mensagemDaFalha, obterPropostaDoProjeto, salvarRascunho } from "@/lib/propostas/propostas";
import { mensagemConflito } from "@/lib/propostas/regras";
import { mesclarSugestao, ROTULO_CAMPO_SUGESTAO, type CamposSugeridos } from "@/lib/propostas/sugestao";
import type { Ferramenta, Resposta } from "./ferramentas";
import { propostaVisivel } from "./guardas";
import { urlBase } from "./url";

const id = z.string().min(1).max(64);

/** Campos no formato de `editar_proposta` (null = a sugestão não preenche). */
function camposMcp(c: CamposSugeridos) {
  return {
    valor: c.valor,
    prazo_dias: c.prazoDias,
    escopo_resumo: c.escopoResumo,
    entregas: c.entregas?.map((e) => ({ titulo: e.titulo, dia: e.dia, ...(e.duracao ? { duracao: e.duracao } : {}), ...(e.valor ? { valor: e.valor } : {}) })) ?? null,
  };
}

const entrada = {
  projeto_id: id.describe("id do projeto (de buscar_projetos)"),
  anexo_id: id.describe("id do anexo do projeto (de listar_anexos)"),
  aplicar: z.boolean().optional().describe("true grava a sugestão no rascunho (exige revisao); padrão: só sugere"),
  revisao: z.number().int().min(0).optional().describe("revisão lida em ler_proposta (obrigatória com aplicar)"),
};

export const preencherPropostaDeAnexo: Ferramenta = {
  nome: "preencher_proposta_de_anexo",
  titulo: "Preencher proposta a partir de anexo",
  descricao:
    "Usa um anexo do projeto (PDF, Word, Markdown, texto ou imagem; escaneado é lido pela IA) como base da proposta: devolve o texto em Markdown e a parte estruturada (valor, prazo_dias, escopo_resumo, entregas) que o arquivo sustenta. Campo incerto ou ausente NÃO é preenchido: vem null e listado em `revisar` (com o que foi lido) — confira com o usuário. Custa uma chamada de IA por uso. Padrão: só sugere, nada é gravado; para gravar, use editar_proposta com o markdown e os campos (sem nova chamada de IA), ou chame com aplicar=true e a revisao de ler_proposta (substitui o texto do rascunho; dados não preenchidos ficam como estão). Só quem está com a caneta (pingue-pongue em curso), como editar_proposta.",
  escrita: true,
  guarda: (a, eu) => propostaVisivel(a as { projeto_id: string }, eu),
  entrada,
  executar: async (bruto, eu): Promise<Resposta> => {
    const a = bruto as z.infer<z.ZodObject<typeof entrada>>;
    if (a.aplicar && a.revisao === undefined) return { ok: false, erro: "Para aplicar, informe a revisao lida em ler_proposta." };
    if (a.aplicar) {
      // Revisão velha falha ANTES de gastar com a IA (o `salvarRascunho` ainda confere de novo ao gravar).
      const atual = await obterPropostaDoProjeto(a.projeto_id);
      const p = atual?.proposta;
      if (p && p.revisao !== a.revisao) {
        return { ok: false, erro: `${mensagemConflito({ revisao: p.revisao, por: p.rascunhoPor?.nome ?? null, viaMcp: p.rascunhoViaMcp })} Use ler_proposta. Nada foi lido nem gravado.` };
      }
    }
    const r = await sugerirDeAnexo(a.projeto_id, a.anexo_id, eu);
    if (!r.ok) return { ok: false, erro: r.ref ? `${r.mensagem} (ref: ${r.ref})` : r.mensagem };
    const s = r.sugestao;
    const sugestao = {
      origem: s.origem === "arquivo" ? "lido pela IA (escaneado/imagem)" : "texto extraído do arquivo",
      anexo: s.anexo,
      markdown: s.markdown,
      campos: camposMcp(s.campos),
      revisar: s.revisar.map((i) => ({ campo: ROTULO_CAMPO_SUGESTAO[i.campo], motivo: i.motivo, lido: i.lido, trecho: i.trecho })),
    };
    const url = `${urlBase()}/projetos/${a.projeto_id}/proposta`;
    if (!a.aplicar) return { ok: true, dados: { aplicado: false, ...sugestao, url } };

    const atual = await obterPropostaDoProjeto(a.projeto_id);
    const base = estruturadoParaEntrada(atual?.proposta?.estruturado ?? ESTRUTURADO_VAZIO);
    const g = await salvarRascunho(a.projeto_id, { revisao: a.revisao!, conteudo: { markdown: s.markdown }, estruturado: mesclarSugestao(base, s.campos) }, eu);
    if (!g.ok) {
      const msg = mensagemDaFalha(g);
      return { ok: false, erro: g.erro === "CONFLITO" ? `${msg} Use ler_proposta. Nada foi gravado; a sugestão abaixo pode ir por editar_proposta.\n${JSON.stringify(sugestao)}` : msg };
    }
    return { ok: true, dados: { aplicado: true, revisao: g.revisao, ...sugestao, url } };
  },
};
