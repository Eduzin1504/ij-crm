/**
 * Trechos comentados no editor (GAB-91): só DECORAÇÃO do ProseMirror — nada
 * entra no documento (o JSON/Markdown segue o subconjunto de
 * `lib/propostas/documento.ts`). A cada mudança do texto a âncora é
 * reencontrada (`localizarAncora`): editou o trecho → o destaque some e o
 * painel mostra "trecho alterado".
 *
 * O texto plano do editor é o mesmo de `textoPlano(documento)` (blocos de
 * texto não vazios separados por `\n`), então a âncora criada aqui vale na
 * visualização e no servidor, e vice-versa.
 */
import { Extension } from "@tiptap/core";
import type { Node as NoPM } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { criarAncora, localizarAncora, type Ancora } from "@/lib/propostas/ancora";

export type DestaqueEditor = { id: string; ancora: Ancora };
export type EntradaDestaques = { destaques: DestaqueEditor[]; ativo: string | null };
type Estado = EntradaDestaques & { set: DecorationSet };

/** `plano`: início do bloco no texto plano; `pos`: posição do 1º caractere no documento PM. */
export type SegmentoPM = { plano: number; pos: number; tamanho: number };

export const chaveDestaques = new PluginKey<Estado>("destaquesComentarios");

export function planoDoEditor(doc: NoPM): { texto: string; segmentos: SegmentoPM[] } {
  let texto = "";
  const segmentos: SegmentoPM[] = [];
  doc.descendants((no, pos) => {
    if (!no.isTextblock) return true;
    const t = no.textContent;
    if (t) {
      if (texto) texto += "\n";
      segmentos.push({ plano: texto.length, pos: pos + 1, tamanho: t.length });
      texto += t;
    }
    return false;
  });
  return { texto, segmentos };
}

/** Posição do documento → offset no texto plano (fora de bloco: encosta no vizinho). */
function planoDaPos(segs: SegmentoPM[], pos: number, fim: boolean): number {
  if (!fim) {
    const s = segs.find((x) => x.pos + x.tamanho >= pos);
    if (!s) return segs.length ? segs[segs.length - 1].plano + segs[segs.length - 1].tamanho : 0;
    return pos <= s.pos ? s.plano : s.plano + (pos - s.pos);
  }
  const s = [...segs].reverse().find((x) => x.pos <= pos);
  if (!s) return 0;
  return pos >= s.pos + s.tamanho ? s.plano + s.tamanho : s.plano + (pos - s.pos);
}

/** Âncora da seleção atual do editor (null = nada selecionado, só espaço ou longa demais). */
export function ancoraDaSelecao(state: EditorState): Ancora | null {
  const { from, to, empty } = state.selection;
  if (empty) return null;
  const { texto, segmentos } = planoDoEditor(state.doc);
  return criarAncora(texto, planoDaPos(segmentos, from, false), planoDaPos(segmentos, to, true));
}

function decorar(doc: NoPM, e: EntradaDestaques): DecorationSet {
  if (e.destaques.length === 0) return DecorationSet.empty;
  const { texto, segmentos } = planoDoEditor(doc);
  const decos: Decoration[] = [];
  for (const d of e.destaques) {
    const f = localizarAncora(texto, d.ancora);
    if (!f) continue;
    const classe = d.id === e.ativo ? "comentario-destaque comentario-destaque-ativo" : "comentario-destaque";
    // Um pedaço por bloco: decoração inline não atravessa a fronteira de parágrafo.
    for (const s of segmentos) {
      const a = Math.max(f.inicio, s.plano);
      const b = Math.min(f.fim, s.plano + s.tamanho);
      if (a < b) decos.push(Decoration.inline(s.pos + (a - s.plano), s.pos + (b - s.plano), { class: classe, "data-comentario": d.id }));
    }
  }
  return DecorationSet.create(doc, decos);
}

/** Extensão do Tiptap: recebe os destaques por `tr.setMeta(chaveDestaques, entrada)`. */
export const DestaquesComentarios = Extension.create({
  name: "destaquesComentarios",
  addProseMirrorPlugins() {
    return [
      new Plugin<Estado>({
        key: chaveDestaques,
        state: {
          init: () => ({ destaques: [], ativo: null, set: DecorationSet.empty }),
          apply(tr, atual) {
            const nova = tr.getMeta(chaveDestaques) as EntradaDestaques | undefined;
            if (nova) return { ...nova, set: decorar(tr.doc, nova) };
            if (tr.docChanged) return { ...atual, set: decorar(tr.doc, atual) };
            return atual;
          },
        },
        props: { decorations: (state) => chaveDestaques.getState(state)?.set },
      }),
    ];
  },
});
