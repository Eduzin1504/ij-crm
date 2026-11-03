/**
 * Seleção do leitor na visualização da proposta → âncora (GAB-91). A
 * `DocumentoView` com `destaques` põe cada pedaço de texto num elemento
 * `[data-o]` com o seu offset no texto plano; aqui os dois pontos da seleção
 * viram offsets e a âncora sai do mesmo texto plano do editor/servidor.
 */
import { criarAncora, type Ancora } from "@/lib/propostas/ancora";

function primeiroComOffset(no: Node): Element | null {
  if (!(no instanceof Element)) return null;
  return no.matches("[data-o]") ? no : no.querySelector("[data-o]");
}

function ultimoComOffset(no: Node): Element | null {
  if (!(no instanceof Element)) return null;
  const todos = no.querySelectorAll("[data-o]");
  return todos.length ? todos[todos.length - 1] : no.matches("[data-o]") ? no : null;
}

const base = (el: Element) => Number(el.getAttribute("data-o"));

/** Offset no texto plano de um ponto (nó, offset) da seleção; null = fora do texto. */
export function offsetDoPonto(no: Node, offset: number, raiz: Element, fim: boolean): number | null {
  if (!raiz.contains(no)) return null;
  const dentro = (no instanceof Element ? no : no.parentElement)?.closest("[data-o]");
  if (dentro && raiz.contains(dentro)) {
    // Ponto dentro de um pedaço: texto do pedaço antes do ponto.
    const r = document.createRange();
    r.setStart(dentro, 0);
    r.setEnd(no, offset);
    return base(dentro) + r.toString().length;
  }
  // Ponto entre elementos (bordas de bloco): encosta no pedaço vizinho.
  const filhos = no.childNodes;
  if (!fim) {
    for (let k = offset; k < filhos.length; k++) {
      const el = primeiroComOffset(filhos[k]);
      if (el) return base(el);
    }
  } else {
    for (let k = Math.min(offset, filhos.length) - 1; k >= 0; k--) {
      const el = ultimoComOffset(filhos[k]);
      if (el) return base(el) + (el.textContent ?? "").length;
    }
  }
  return null;
}

/** Âncora da seleção atual dentro de `raiz` (null = nada selecionado ou fora do texto). */
export function ancoraDaSelecaoDom(raiz: Element, textoPlano: string, sel: Selection | null = window.getSelection()): Ancora | null {
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const r = sel.getRangeAt(0);
  const a = offsetDoPonto(r.startContainer, r.startOffset, raiz, false);
  const b = offsetDoPonto(r.endContainer, r.endOffset, raiz, true);
  if (a === null || b === null) return null;
  return criarAncora(textoPlano, a, b);
}
