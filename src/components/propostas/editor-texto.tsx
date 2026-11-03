"use client";

import { useImperativeHandle, type Ref } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import Bold from "@tiptap/extension-bold";
import Document from "@tiptap/extension-document";
import Heading from "@tiptap/extension-heading";
import HorizontalRule from "@tiptap/extension-horizontal-rule";
import Italic from "@tiptap/extension-italic";
import { BulletList, ListItem, ListKeymap, OrderedList } from "@tiptap/extension-list";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { Placeholder, UndoRedo } from "@tiptap/extensions";
import { Bold as IconeNegrito, Heading1, Heading2, Heading3, Italic as IconeItalico, List, ListOrdered, Minus, Redo2, Undo2 } from "lucide-react";
import { cn } from "cn";
import type { Documento } from "@/lib/propostas/documento";

/**
 * Editor rich text da proposta (Tiptap). Carrega SÓ as extensões do
 * subconjunto que o Markdown representa (`lib/propostas/documento.ts`): sem
 * link, imagem, código, tabela nem quebra de linha simples. Colar HTML de fora
 * passa pelo esquema do ProseMirror: o que não é do subconjunto vira texto.
 */
export const EXTENSOES = [
  Document,
  Paragraph,
  Text,
  Heading.configure({ levels: [1, 2, 3] }),
  Bold,
  Italic,
  BulletList,
  OrderedList,
  ListItem,
  ListKeymap,
  HorizontalRule,
  UndoRedo,
  Placeholder.configure({ placeholder: "Escreva a proposta…" }),
];

export type ControleEditor = {
  documento: () => Documento;
  substituir: (d: Documento) => void;
};

function Botao({ ativo, rotulo, onClick, children, desativado }: { ativo?: boolean; rotulo: string; onClick: () => void; children: React.ReactNode; desativado?: boolean }) {
  return (
    <button
      type="button"
      aria-label={rotulo}
      title={rotulo}
      aria-pressed={ativo}
      disabled={desativado}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-md text-fg-mute transition-colors hover:bg-surface-hover hover:text-foreground disabled:opacity-40",
        ativo && "bg-surface-hover text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Barra({ editor }: { editor: Editor }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      h1: e.isActive("heading", { level: 1 }),
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
      negrito: e.isActive("bold"),
      italico: e.isActive("italic"),
      marcadores: e.isActive("bulletList"),
      numerada: e.isActive("orderedList"),
      desfazer: e.can().undo(),
      refazer: e.can().redo(),
    }),
  });
  const c = () => editor.chain().focus();
  return (
    <div role="toolbar" aria-label="Formatação" className="flex flex-wrap items-center gap-0.5 border-b border-border px-2 py-1">
      <Botao rotulo="Título 1" ativo={s.h1} onClick={() => c().toggleHeading({ level: 1 }).run()}>
        <Heading1 className="size-4" />
      </Botao>
      <Botao rotulo="Título 2" ativo={s.h2} onClick={() => c().toggleHeading({ level: 2 }).run()}>
        <Heading2 className="size-4" />
      </Botao>
      <Botao rotulo="Título 3" ativo={s.h3} onClick={() => c().toggleHeading({ level: 3 }).run()}>
        <Heading3 className="size-4" />
      </Botao>
      <span aria-hidden className="mx-1 h-4 w-px bg-border" />
      <Botao rotulo="Negrito (Ctrl+B)" ativo={s.negrito} onClick={() => c().toggleBold().run()}>
        <IconeNegrito className="size-4" />
      </Botao>
      <Botao rotulo="Itálico (Ctrl+I)" ativo={s.italico} onClick={() => c().toggleItalic().run()}>
        <IconeItalico className="size-4" />
      </Botao>
      <span aria-hidden className="mx-1 h-4 w-px bg-border" />
      <Botao rotulo="Lista com marcadores" ativo={s.marcadores} onClick={() => c().toggleBulletList().run()}>
        <List className="size-4" />
      </Botao>
      <Botao rotulo="Lista numerada" ativo={s.numerada} onClick={() => c().toggleOrderedList().run()}>
        <ListOrdered className="size-4" />
      </Botao>
      <Botao rotulo="Linha horizontal" onClick={() => c().setHorizontalRule().run()}>
        <Minus className="size-4" />
      </Botao>
      <span className="flex-1" />
      <Botao rotulo="Desfazer (Ctrl+Z)" desativado={!s.desfazer} onClick={() => c().undo().run()}>
        <Undo2 className="size-4" />
      </Botao>
      <Botao rotulo="Refazer (Ctrl+Shift+Z)" desativado={!s.refazer} onClick={() => c().redo().run()}>
        <Redo2 className="size-4" />
      </Botao>
    </div>
  );
}

export default function EditorTexto({
  inicial,
  aoMudar,
  controle,
}: {
  inicial: Documento;
  aoMudar: (d: Documento) => void;
  controle?: Ref<ControleEditor>;
}) {
  const editor = useEditor({
    extensions: EXTENSOES,
    content: inicial,
    // Renderiza só no cliente (Next SSR): evita divergência de hidratação.
    immediatelyRender: false,
    editorProps: { attributes: { class: "proposta-texto px-4 py-3", "aria-label": "Texto da proposta", "aria-multiline": "true", role: "textbox" } },
    onUpdate: ({ editor: e }) => aoMudar(e.getJSON() as Documento),
  });

  useImperativeHandle(
    controle,
    () => ({
      documento: () => (editor?.getJSON() as Documento | undefined) ?? inicial,
      // emitUpdate: false — carregar o do servidor não é edição (não dispara autosave).
      substituir: (d) => editor?.commands.setContent(d, { emitUpdate: false }),
    }),
    [editor, inicial],
  );

  if (!editor) return <div className="proposta-texto min-h-72 px-4 py-3 text-fg-faint">Carregando editor…</div>;
  return (
    <div className="rounded-lg border border-input bg-input/20 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
      <Barra editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}
