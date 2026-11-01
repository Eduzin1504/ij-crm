/**
 * Prompt + schema da extração, versão 3 (GAB-85; spec fase 2 §4.14, Q23 "os
 * leads gostaram do contato?"). Muda em relação à v2.1:
 * - o schema ganha `sentimento`: como o LEAD reagiu ao contato que a mensagem
 *   relata (POSITIVO | NEUTRO | NEGATIVO | null), extraído na MESMA chamada
 *   da extração (sem chamada extra à LLM);
 * - o prompt de sistema é o da v2.1, intacto, com UMA regra a mais no fim
 *   (`REGRA_SENTIMENTO`).
 *
 * A mensagem do usuário (contexto) é a da v2.1, sem mudança.
 *
 * Tolerância: no JSON schema (vai para a API, structured outputs estrito) o
 * campo é obrigatório como todos os outros; no zod ele é opcional e qualquer
 * valor fora do enum vira `null` — resposta sem sentimento (provedor que
 * ignorou o schema, mock, fixtures antigas) nunca derruba a extração.
 *
 * O sentimento derivado é gravado FORA do JSON da LLM (colunas
 * `timeline.sentimento` e `mensagem_bruta.sentimento`): a purga de 90 dias
 * (`whatsapp/retencao.ts`) apaga o JSON, não o dado agregável do painel.
 *
 * VERSIONADO: os textos da v1/v2 são congelados. Mudar o texto ou o schema =
 * `extracao.v4.ts` + bump de `VERSAO_EXTRACAO`.
 */
import { z } from "zod";
import { JSON_SCHEMA_EXTRACAO as SCHEMA_V2, PROMPT_SISTEMA as PROMPT_V2, esquemaExtracao as esquemaV2 } from "./extracao.v2";

export { INTENCOES, ORIGENS, montarMensagemUsuario, MAX_CHARS_ENTRADA_HISTORICO, MAX_CHARS_HISTORICO, MAX_CHARS_RESUMO_ANTERIOR } from "./extracao.v2";
export type {
  ContatoCandidato,
  ContextoExtracao,
  EmpresaCandidata,
  EntradaHistorico,
  FaseContexto,
  ProjetoCandidato,
  SituacaoHistorico,
} from "./extracao.v2";

export const VERSAO_EXTRACAO = "extracao.v3";

/** Espelha o enum `Sentimento` do Prisma (conferido em `projetos/avaliacao.test.ts`). */
export const SENTIMENTOS = ["POSITIVO", "NEUTRO", "NEGATIVO"] as const;
export type SentimentoLead = (typeof SENTIMENTOS)[number];

export const esquemaExtracao = esquemaV2.extend({
  // Opcional e tolerante: ausente ou inválido → null (nunca SAIDA_INVALIDA por causa dele).
  sentimento: z.enum(SENTIMENTOS).nullable().default(null).catch(null),
});

export type Extracao = z.infer<typeof esquemaExtracao>;

const nulo = { type: "null" } as const;

export const JSON_SCHEMA_EXTRACAO = {
  ...SCHEMA_V2,
  required: [...SCHEMA_V2.required, "sentimento"],
  properties: {
    ...SCHEMA_V2.properties,
    sentimento: {
      anyOf: [{ type: "string", enum: [...SENTIMENTOS] }, nulo],
      description:
        "Como o LEAD (cliente) reagiu ao contato que a mensagem relata: POSITIVO, NEUTRO ou NEGATIVO. null em IGNORAR ou quando a mensagem não relata contato com o lead.",
    },
  },
} as const;

export const REGRA_SENTIMENTO =
  '- sentimento: como o LEAD (o cliente, não o vendedor) reagiu ao contato que a mensagem relata. POSITIVO = gostou, se animou, elogiou, pediu proposta ou reunião, aceitou ("curtiu muito", "quer fechar"); NEGATIVO = achou caro, perdeu o interesse, reclamou, recusou, não responde mais; NEUTRO = houve contato, mas sem sinal claro de agrado ou desagrado. null em IGNORAR ou quando a mensagem não relata contato com o lead (só um dado solto, uma correção, uma tarefa interna). Não adivinhe: na dúvida entre NEUTRO e outro, NEUTRO.';

export const PROMPT_SISTEMA = `${PROMPT_V2}\n${REGRA_SENTIMENTO}`;
