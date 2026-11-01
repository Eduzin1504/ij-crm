// @vitest-environment node
import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { docxDeParagrafos, JPEG, pdfDeTexto, PNG, zipQualquer } from "@/test/fixtures/anexos";
import { extrairTexto, TEXTO_MAX } from "./extrair";

const enc = new TextEncoder();

describe("extrairTexto", () => {
  it("PDF digital: texto de todas as páginas, separadas por linha em branco", async () => {
    const r = await extrairTexto("PDF", pdfDeTexto(["Proposta comercial para a padaria", "Cronograma de entregas em tres fases"]));
    expect(r).toEqual({ ok: true, texto: "Proposta comercial para a padaria\n\nCronograma de entregas em tres fases" });
  });

  it("PDF sem camada de texto (escaneado) → sem texto", async () => {
    expect(await extrairTexto("PDF", pdfDeTexto(["", ""]))).toEqual({ ok: true, texto: null });
  });

  it("PDF que o pdf.js não abre → CORROMPIDO", async () => {
    expect(await extrairTexto("PDF", enc.encode("%PDF-1.4\nlixo sem estrutura nenhuma"))).toEqual({ ok: false, erro: "CORROMPIDO" });
  });

  it(".docx: parágrafos em linhas, entidades XML decodificadas", async () => {
    const r = await extrairTexto("DOCX", docxDeParagrafos(["Escopo & prazo", "Fase <1>: diagnóstico", "Ação"]));
    expect(r).toEqual({ ok: true, texto: "Escopo & prazo\nFase <1>: diagnóstico\nAção" });
  });

  it(".docx: tab e quebra de linha; sem texto → null", async () => {
    const doc =
      '<w:document xmlns:w="x"><w:body><w:p><w:r><w:t>a</w:t><w:tab/><w:t>b</w:t><w:br/><w:t>c&#233;&#x21;</w:t></w:r></w:p></w:body></w:document>';
    const zip = zipSync({ "[Content_Types].xml": strToU8("<Types/>"), "word/document.xml": strToU8(doc) });
    expect(await extrairTexto("DOCX", zip)).toEqual({ ok: true, texto: "a\tb\ncé!" });
    expect(await extrairTexto("DOCX", docxDeParagrafos([]))).toEqual({ ok: true, texto: null });
  });

  it("zip que não é .docx → TIPO_INVALIDO; zip quebrado → CORROMPIDO", async () => {
    expect(await extrairTexto("DOCX", zipQualquer())).toEqual({ ok: false, erro: "TIPO_INVALIDO" });
    expect(await extrairTexto("DOCX", new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]))).toEqual({ ok: false, erro: "CORROMPIDO" });
  });

  it("zip bomb: document.xml declarado grande demais nem é descompactado", async () => {
    // 60 MB de zeros comprimem para ~60 KB: descompactar estouraria a memória do app.
    const bomba = zipSync({ "[Content_Types].xml": strToU8("<Types/>"), "word/document.xml": new Uint8Array(60 * 1024 * 1024) });
    expect(await extrairTexto("DOCX", bomba)).toEqual({ ok: false, erro: "CORROMPIDO" });
  });

  it(".txt/.md: texto decodificado; só espaços → null", async () => {
    expect(await extrairTexto("MARKDOWN", enc.encode("# Título\r\n\r\nCorpo"))).toEqual({ ok: true, texto: "# Título\n\nCorpo" });
    expect(await extrairTexto("TEXTO", enc.encode("  \n "))).toEqual({ ok: true, texto: null });
  });

  it("imagens: sem texto (OCR é outro ticket)", async () => {
    expect(await extrairTexto("PNG", PNG)).toEqual({ ok: true, texto: null });
    expect(await extrairTexto("JPEG", JPEG)).toEqual({ ok: true, texto: null });
  });

  it("texto enorme é cortado em TEXTO_MAX", async () => {
    const r = await extrairTexto("TEXTO", enc.encode("a".repeat(TEXTO_MAX + 10)));
    expect(r.ok && r.texto?.length).toBe(TEXTO_MAX);
  });
});
