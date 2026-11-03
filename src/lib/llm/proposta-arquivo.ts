/**
 * Leitura de proposta a partir de arquivo (GAB-90) — uma chamada ao mesmo
 * provedor da extração (`provedorConfigurado`; produção: GPT-6.1 Sol com
 * visão, `store: false`). Mesmo timeout/retentativa/tradução de erro dos
 * provedores (`provedores/comum.ts`), com timeout maior por tentativa.
 *
 * Custo por arquivo: cada chamada vira uma linha em `log_llm`
 * (`operacao=proposta_arquivo`, tokens de entrada/saída/raciocínio) com
 * `ref = <ref da chamada>:<12 primeiros hex do anexo>` — a mesma ref que a
 * tela/MCP mostram em caso de falha e que o log do servidor traz. NUNCA o texto.
 *
 * Lança `ErroLlm`; quem decide o que mostrar é `propostas/preenchimento.ts`.
 */
import { registrarLogLlm } from "@/lib/logs/tecnicos";
import { provedorConfigurado } from "./extracao";
import {
  JSON_SCHEMA_PROPOSTA_ARQUIVO,
  JSON_SCHEMA_PROPOSTA_TEXTO,
  MAX_TOKENS_PROPOSTA_ARQUIVO,
  MAX_TOKENS_PROPOSTA_TEXTO,
  PROMPT_SISTEMA_PROPOSTA_ARQUIVO,
  PROMPT_SISTEMA_PROPOSTA_TEXTO,
  TIMEOUT_PROPOSTA_ARQUIVO_MS,
  TIMEOUT_PROPOSTA_TEXTO_MS,
  VERSAO_PROPOSTA_ARQUIVO,
  esquemaPropostaArquivo,
  esquemaPropostaTexto,
  montarMensagemProposta,
  type LeituraProposta,
} from "./prompts/proposta-arquivo.v1";
import { ErroLlm, type ArquivoLlm, type ProvedorLlm, type UsoLlm } from "./tipos";

export type EntradaLeitura = { modo: "texto"; nomeArquivo: string; texto: string } | { modo: "arquivo"; nomeArquivo: string; arquivo: ArquivoLlm };

export type ResultadoLeitura = { leitura: LeituraProposta; uso: UsoLlm; versao: string };

const codigo = (e: unknown) => (e instanceof ErroLlm ? e.codigo : "INESPERADO");

async function log(uso: UsoLlm | undefined, ref: string, modo: string, resultado: string, status: string) {
  const base = `[llm] proposta_arquivo ref=${ref} modo=${modo} versao=${VERSAO_PROPOSTA_ARQUIVO}`;
  if (!uso) console.info(`${base} ${resultado}`);
  else
    console.info(
      `${base} provedor=${uso.provedor} modelo=${uso.modelo} ms=${uso.ms} tokens_in=${uso.tokensEntrada} tokens_out=${uso.tokensSaida}${uso.tokensRaciocinio === undefined ? "" : ` tokens_reasoning=${uso.tokensRaciocinio}`} ${resultado}`,
    );
  await registrarLogLlm({ operacao: "proposta_arquivo", uso, status, ref });
}

/** `ref` vai para o log do servidor e para `log_llm` (identificador curto; nunca texto). */
export async function lerPropostaDeArquivo(entrada: EntradaLeitura, opts: { ref: string; provedor?: ProvedorLlm }): Promise<ResultadoLeitura> {
  const { ref } = opts;
  let provedor: ProvedorLlm;
  try {
    provedor = opts.provedor ?? provedorConfigurado();
  } catch (e) {
    await log(undefined, ref, entrada.modo, `erro=${codigo(e)}`, codigo(e));
    throw e;
  }
  const arquivo = entrada.modo === "arquivo";
  let resposta;
  try {
    resposta = await provedor.extrair({
      nome: "proposta_arquivo",
      sistema: arquivo ? PROMPT_SISTEMA_PROPOSTA_ARQUIVO : PROMPT_SISTEMA_PROPOSTA_TEXTO,
      usuario: montarMensagemProposta(entrada.modo === "texto" ? entrada : { modo: "arquivo", nomeArquivo: entrada.nomeArquivo }),
      schema: (arquivo ? JSON_SCHEMA_PROPOSTA_ARQUIVO : JSON_SCHEMA_PROPOSTA_TEXTO) as unknown as Record<string, unknown>,
      maxTokens: arquivo ? MAX_TOKENS_PROPOSTA_ARQUIVO : MAX_TOKENS_PROPOSTA_TEXTO,
      timeoutMs: arquivo ? TIMEOUT_PROPOSTA_ARQUIVO_MS : TIMEOUT_PROPOSTA_TEXTO_MS,
      ...(entrada.modo === "arquivo" ? { arquivo: entrada.arquivo } : {}),
    });
  } catch (e) {
    await log(e instanceof ErroLlm ? e.uso : undefined, ref, entrada.modo, `erro=${codigo(e)}`, codigo(e));
    throw e;
  }
  const r = (arquivo ? esquemaPropostaArquivo : esquemaPropostaTexto).safeParse(resposta.bruto);
  if (!r.success) {
    // Só os caminhos dos campos (nunca valores) vão para o detalhe/log.
    const campos = [...new Set(r.error.issues.map((i) => i.path.join(".") || "(raiz)"))].slice(0, 5);
    await log(resposta.uso, ref, entrada.modo, `erro=SAIDA_INVALIDA campos=${campos.join(",")}`, "SAIDA_INVALIDA");
    throw new ErroLlm("SAIDA_INVALIDA", { uso: resposta.uso, detalhe: { campos } });
  }
  await log(resposta.uso, ref, entrada.modo, "ok", "ok");
  return { leitura: r.data, uso: resposta.uso, versao: VERSAO_PROPOSTA_ARQUIVO };
}
