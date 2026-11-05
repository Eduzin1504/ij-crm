"use client";

import { Node, mergeAttributes, type Editor } from "@tiptap/core";
import { NodeSelection, Plugin, PluginKey, TextSelection, type EditorState } from "@tiptap/pm/state";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { ArrowDown, ArrowUp, GripVertical, MessageSquarePlus, X } from "lucide-react";
import { ancoraDoBloco } from "@/lib/propostas/ancora";
import { documentoDoEditor, normalizarDocumento, TIPOS_BLOCO_DADOS, type Documento, type TipoBlocoDados } from "@/lib/propostas/documento";
import { BlocoDadosView, useFolha } from "./bloco-dados-view";

export type BlocosNoEditor = Record<TipoBlocoDados, boolean>;

/** Quais blocos estão na folha agora. */
export function blocosNoEditor(editor: Pick<Editor, "state">): BlocosNoEditor {
  const presentes: BlocosNoEditor = { cronograma: false, investimento: false };
  editor.state.doc.forEach((n) => {
    if (n.type.name === "blocoDados") presentes[n.attrs.tipo as TipoBlocoDados] = true;
  });
  return presentes;
}

/** Põe o bloco logo depois do bloco de texto do cursor, ou o tira da folha (os dados ficam no cartão). */
export function alternarBloco(editor: Editor, tipo: TipoBlocoDados) {
  const { state, view } = editor;
  let achado: number | null = null;
  state.doc.forEach((n, pos) => {
    if (n.type.name === "blocoDados" && n.attrs.tipo === tipo) achado = pos;
  });
  if (achado !== null) {
    view.dispatch(state.tr.delete(achado, achado + 1));
  } else {
    const { $from } = state.selection;
    const pos = $from.depth > 0 ? $from.after(1) : state.selection.from;
    view.dispatch(state.tr.insert(pos, state.schema.nodes.blocoDados.create({ tipo })));
  }
  view.focus();
}

/** Troca de lugar com o vizinho de cima ou de baixo (sem depender de arrastar: teclado e toque). */
function moverBloco(editor: Editor, pos: number, direcao: -1 | 1) {
  const { state, view } = editor;
  const no = state.doc.nodeAt(pos);
  if (!no) return;
  const $pos = state.doc.resolve(pos);
  const indice = $pos.index(0);
  const vizinho = state.doc.maybeChild(indice + direcao);
  if (!vizinho) return;
  const destino = direcao === -1 ? pos - vizinho.nodeSize : pos + no.nodeSize + vizinho.nodeSize;
  const tr = state.tr.delete(pos, pos + no.nodeSize);
  view.dispatch(tr.insert(tr.mapping.map(destino), no));
}

const CLASSE_CONTROLE = "inline-flex size-6 items-center justify-center rounded-md text-fg-soft hover:bg-surface-hover hover:text-foreground";

function ControleBotao({ rotulo, onClick, children }: { rotulo: string; onClick?: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={rotulo} title={rotulo} onMouseDown={(e) => e.preventDefault()} onClick={onClick} className={CLASSE_CONTROLE}>
      {children}
    </button>
  );
}

function BlocoDadosNo({ node, editor, getPos }: NodeViewProps) {
  const folha = useFolha();
  const tipo = node.attrs.tipo as TipoBlocoDados;
  const posicao = () => {
    const p = getPos();
    return typeof p === "number" ? p : null;
  };
  const mover = (d: -1 | 1) => {
    const p = posicao();
    if (p !== null) moverBloco(editor, p, d);
  };
  const comentar = () => {
    // Texto plano canônico: o mesmo que o servidor usa para achar a âncora.
    const atual = normalizarDocumento(documentoDoEditor(editor.getJSON() as Documento));
    const a = ancoraDoBloco(atual, tipo);
    if (a) folha?.comentar?.(a);
  };
  return (
    <NodeViewWrapper as="div" contentEditable={false} data-bloco-dados={tipo}>
      <BlocoDadosView
        tipo={tipo}
        dados={folha?.dados ?? { valor: null, prazoDias: null, escopoResumo: null, entregas: [] }}
        controles={
          <span className="bloco-dados-controles">
            {/* Não é <button>: o Firefox não arrasta botão. Sem mouse, as setas fazem o mesmo. */}
            <span data-drag-handle draggable aria-label="Arrastar o bloco" title="Arrastar o bloco" className={`${CLASSE_CONTROLE} cursor-grab`}>
              <GripVertical className="size-3.5" />
            </span>
            <ControleBotao rotulo="Subir o bloco" onClick={() => mover(-1)}>
              <ArrowUp className="size-3.5" />
            </ControleBotao>
            <ControleBotao rotulo="Descer o bloco" onClick={() => mover(1)}>
              <ArrowDown className="size-3.5" />
            </ControleBotao>
            {folha?.comentar ? (
              <ControleBotao rotulo="Comentar o bloco" onClick={comentar}>
                <MessageSquarePlus className="size-3.5" />
              </ControleBotao>
            ) : null}
            <ControleBotao
              rotulo="Tirar da folha (os dados continuam no cartão)"
              onClick={() => {
                const p = posicao();
                if (p !== null) editor.view.dispatch(editor.state.tr.delete(p, p + node.nodeSize));
              }}
            >
              <X className="size-3.5" />
            </ControleBotao>
          </span>
        }
      />
    </NodeViewWrapper>
  );
}

const chaveUmDeCada = new PluginKey("blocoDadosUmDeCada");

/** Com um bloco selecionado: transação que abre um parágrafo vazio depois dele, com o cursor dentro. null = não há bloco selecionado. */
function paragrafoDepoisDoBloco(state: EditorState) {
  const sel = state.selection;
  if (!(sel instanceof NodeSelection) || sel.node.type.name !== "blocoDados") return null;
  const tr = state.tr.insert(sel.to, state.schema.nodes.paragraph.create());
  return tr.setSelection(TextSelection.create(tr.doc, sel.to + 1));
}

/**
 * Bloco móvel como nó do ProseMirror: átomo arrastável, com grupo próprio para só
 * existir no nível de cima (nunca dentro de lista). Guarda só o `tipo`; atributos do
 * ProseMirror têm protótipo nulo, e quem manda para a server action é `jsonDoEditor`.
 */
export const BlocoDadosNode = Node.create({
  name: "blocoDados",
  group: "blocoDoc",
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      tipo: {
        default: TIPOS_BLOCO_DADOS[0],
        parseHTML: (el: HTMLElement) => el.getAttribute("data-bloco-dados"),
        renderHTML: (attrs: { tipo: string }) => ({ "data-bloco-dados": attrs.tipo }),
      },
    };
  },
  parseHTML() {
    // Colado de fora com tipo desconhecido não vira nó: o servidor recusaria o documento inteiro e travaria o autosave.
    return [{ tag: "div[data-bloco-dados]", getAttrs: (el: HTMLElement) => ((TIPOS_BLOCO_DADOS as readonly string[]).includes(el.getAttribute("data-bloco-dados") ?? "") ? null : false) }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes)];
  },
  addNodeView() {
    return ReactNodeViewRenderer(BlocoDadosNo);
  },
  addProseMirrorPlugins() {
    return [
      // Um de cada, mesmo colando ou duplicando: o segundo some na hora, não só ao salvar.
      new Plugin({
        key: chaveUmDeCada,
        props: {
          // Digitar ou colar com o bloco selecionado escreve num parágrafo próprio logo depois dele, sem apagá-lo.
          handleTextInput(view, _de, _ate, texto) {
            const tr = paragrafoDepoisDoBloco(view.state);
            if (!tr) return false;
            view.dispatch(tr.insertText(texto).scrollIntoView());
            return true;
          },
          handlePaste(view, _evento, trecho) {
            const tr = paragrafoDepoisDoBloco(view.state);
            if (!tr) return false;
            view.dispatch(tr.replaceSelection(trecho).scrollIntoView());
            return true;
          },
        },
        appendTransaction(trs, _antes, estado) {
          if (!trs.some((t) => t.docChanged)) return null;
          const vistos = new Set<string>();
          const repetidos: number[] = [];
          estado.doc.forEach((n, pos) => {
            if (n.type.name !== "blocoDados") return;
            if (vistos.has(n.attrs.tipo as string)) repetidos.push(pos);
            vistos.add(n.attrs.tipo as string);
          });
          if (repetidos.length === 0) return null;
          const tr = estado.tr;
          for (const pos of repetidos.reverse()) tr.delete(pos, pos + 1);
          return tr;
        },
      }),
    ];
  },
});
