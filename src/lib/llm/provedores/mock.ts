/**
 * Provedor `mock` (`LLM_PROVEDOR=mock`): sem rede, sem custo. Para dev local
 * sem chave e para os testes.
 *
 * Padrão: se o texto da mensagem é igual ao de uma fixture
 * (`fixtures/extracao.ts`), devolve a saída dela; senão devolve "não
 * identifiquei nada" com confiança 0 (vira `PENDENTE_REVISAO`). Testes trocam
 * a resposta com `definirRespostaMock`.
 *
 * Classificação (`pedido.nome === "classificacao"`, GAB-39): stub
 * determinístico — texto igual a uma fixture de `fixtures/classificacao.ts`
 * devolve a saída dela; senão `{ relevante: false, confianca: 0 }` (dev sem
 * chave descarta o que não conhece). Testes trocam com `definirClassificacaoMock`.
 *
 * Resumo da janela de 12 h (`pedido.nome === "resumo"`, GAB-49): resposta
 * fixa curta; testes trocam com `definirResumoMock` (recebe texto vazio).
 *
 * Proposta a partir de arquivo (`pedido.nome === "proposta_arquivo"`, GAB-90):
 * padrão = nenhum campo identificado (confiança 0) e, quando vai arquivo, um
 * texto fixo; testes trocam com `definirPropostaArquivoMock` (recebe o texto
 * do documento — vazio quando vai só o arquivo — e o pedido, com `arquivo`).
 */
import { FIXTURES_CLASSIFICACAO } from "../fixtures/classificacao";
import { FIXTURES_EXTRACAO, saida } from "../fixtures/extracao";
import type { PedidoExtracao, ProvedorLlm, RespostaProvedor } from "../tipos";

export const MODELO_MOCK = "mock-extracao";

/** Recebe o texto ORIGINAL da mensagem (não o prompt montado) e o pedido completo. */
export type RespostaMock = (texto: string, pedido: PedidoExtracao) => unknown | Promise<unknown>;

const g = globalThis as unknown as { __ijRespostaMock?: RespostaMock | null; __ijClassificacaoMock?: RespostaMock | null; __ijResumoMock?: RespostaMock | null; __ijPropostaArquivoMock?: RespostaMock | null };

/** Troca a resposta do mock (null volta ao padrão). Lançar dentro dela simula falha do provedor. */
export function definirRespostaMock(fn: RespostaMock | null) {
  g.__ijRespostaMock = fn;
}

/** Idem, só para as chamadas do classificador. */
export function definirClassificacaoMock(fn: RespostaMock | null) {
  g.__ijClassificacaoMock = fn;
}

/** Idem, só para o resumo da janela (GAB-49). */
export function definirResumoMock(fn: RespostaMock | null) {
  g.__ijResumoMock = fn;
}

/** Idem, só para a leitura de proposta a partir de arquivo (GAB-90). */
export function definirPropostaArquivoMock(fn: RespostaMock | null) {
  g.__ijPropostaArquivoMock = fn;
}

const nada = { valor: null, confianca: 0, trecho: null };
const propostaArquivoPadrao: RespostaMock = (_texto, pedido) => ({
  ...(pedido.arquivo ? { markdown: "## Proposta\n\nmock: texto lido do arquivo" } : {}),
  valor_total: nada,
  prazo_dias: nada,
  escopo_resumo: nada,
  entregas: { itens: [], confianca: 0 },
});

const resumoPadrao: RespostaMock = () => ({ resumo: "mock: resumo da janela anterior" });

function classificacaoPadrao(texto: string): unknown {
  return FIXTURES_CLASSIFICACAO.find((x) => x.texto === texto)?.saida ?? { relevante: false, confianca: 0 };
}

function respostaPadrao(texto: string): unknown {
  const f = FIXTURES_EXTRACAO.find((x) => x.texto === texto);
  return f ? f.saida : saida({ confianca: 0, resumo: "mock: mensagem sem fixture" });
}

/** Extrai o texto entre <mensagem> e </mensagem> (ou <documento>, GAB-90) do prompt montado. */
function textoDoPedido(pedido: PedidoExtracao): string {
  const m = /<(mensagem|documento)>\n([\s\S]*)\n<\/\1>/.exec(pedido.usuario);
  return m ? m[2] : "";
}

export function criarProvedorMock(): ProvedorLlm {
  return {
    nome: "mock",
    async extrair(pedido): Promise<RespostaProvedor> {
      const inicio = performance.now();
      const texto = textoDoPedido(pedido);
      const fn =
        pedido.nome === "classificacao"
          ? (g.__ijClassificacaoMock ?? classificacaoPadrao)
          : pedido.nome === "resumo"
            ? (g.__ijResumoMock ?? resumoPadrao)
            : pedido.nome === "proposta_arquivo"
              ? (g.__ijPropostaArquivoMock ?? propostaArquivoPadrao)
              : (g.__ijRespostaMock ?? respostaPadrao);
      const bruto = await fn(texto, pedido);
      return {
        bruto: structuredClone(bruto),
        uso: { provedor: "mock", modelo: MODELO_MOCK, tokensEntrada: 0, tokensSaida: 0, ms: Math.round(performance.now() - inicio) },
      };
    },
  };
}
