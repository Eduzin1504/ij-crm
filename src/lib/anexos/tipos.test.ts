import { describe, expect, it } from "vitest";
import { docxDeParagrafos, JPEG, pdfDeTexto, PNG, WEBP } from "@/test/fixtures/anexos";
import { ANEXO_MAX_BYTES, cabecalhoDownload, decodificarTexto, formatarTamanho, identificarTipo, MENSAGEM_ERRO_ANEXO, sanitizarNome } from "./tipos";

const enc = new TextEncoder();

describe("identificarTipo: magic bytes + extensão", () => {
  it("aceita PDF, .docx, .md, .txt e imagens pelo conteúdo", () => {
    expect(identificarTipo(pdfDeTexto(["oi"]), "proposta.pdf")).toEqual({ ok: true, tipo: "PDF", mime: "application/pdf" });
    expect(identificarTipo(docxDeParagrafos(["a"]), "Escopo.DOCX")).toMatchObject({ ok: true, tipo: "DOCX" });
    expect(identificarTipo(enc.encode("# Título\n"), "notas.md")).toEqual({ ok: true, tipo: "MARKDOWN", mime: "text/markdown; charset=utf-8" });
    expect(identificarTipo(enc.encode("olá"), "notas.markdown")).toMatchObject({ ok: true, tipo: "MARKDOWN" });
    expect(identificarTipo(enc.encode("olá"), "a.txt")).toEqual({ ok: true, tipo: "TEXTO", mime: "text/plain; charset=utf-8" });
    expect(identificarTipo(PNG, "foto.png")).toEqual({ ok: true, tipo: "PNG", mime: "image/png" });
    expect(identificarTipo(JPEG, "foto.jpg")).toMatchObject({ ok: true, tipo: "JPEG" });
    expect(identificarTipo(JPEG, "foto.jpeg")).toMatchObject({ ok: true, tipo: "JPEG" });
    expect(identificarTipo(WEBP, "foto.webp")).toMatchObject({ ok: true, tipo: "WEBP" });
  });

  it("vazio e acima do limite", () => {
    expect(identificarTipo(new Uint8Array(), "a.pdf")).toEqual({ ok: false, erro: "VAZIO" });
    const grande = new Uint8Array(ANEXO_MAX_BYTES + 1);
    grande.set(enc.encode("%PDF-1.4"));
    expect(identificarTipo(grande, "a.pdf")).toEqual({ ok: false, erro: "GRANDE_DEMAIS" });
  });

  it("extensão fora da lista → TIPO_INVALIDO (nada de .exe, .html, .doc, .svg)", () => {
    for (const nome of ["a.exe", "a.html", "a.doc", "a.svg", "sem-extensao", "a.pdf.exe"]) {
      expect(identificarTipo(enc.encode("qualquer"), nome)).toEqual({ ok: false, erro: "TIPO_INVALIDO" });
    }
  });

  it("conteúdo não confere com a extensão: o MIME/extensão do cliente não bastam", () => {
    // HTML renomeado para .pdf/.png
    expect(identificarTipo(enc.encode("<html><script>alert(1)</script>"), "proposta.pdf")).toEqual({ ok: false, erro: "TIPO_INVALIDO" });
    expect(identificarTipo(enc.encode("<html>"), "foto.png")).toEqual({ ok: false, erro: "TIPO_INVALIDO" });
    // PDF renomeado para .png / .txt
    expect(identificarTipo(pdfDeTexto(["x"]), "foto.png")).toEqual({ ok: false, erro: "EXTENSAO_NAO_CONFERE" });
    expect(identificarTipo(pdfDeTexto(["x"]), "a.txt")).toEqual({ ok: false, erro: "EXTENSAO_NAO_CONFERE" });
    // PNG renomeado para .docx; zip qualquer só é checado na extração
    expect(identificarTipo(PNG, "a.docx")).toEqual({ ok: false, erro: "EXTENSAO_NAO_CONFERE" });
  });

  it(".txt/.md precisam ser texto de verdade (binário com NUL é recusado)", () => {
    expect(identificarTipo(new Uint8Array([0x41, 0x00, 0x42]), "a.txt")).toEqual({ ok: false, erro: "TIPO_INVALIDO" });
    // Latin-1 (Windows-1252) é aceito: arquivos antigos do Bloco de Notas.
    expect(identificarTipo(new Uint8Array([0x63, 0x61, 0x66, 0xe9]), "a.txt")).toMatchObject({ ok: true, tipo: "TEXTO" });
  });

  it("toda falha tem mensagem em português", () => {
    for (const m of Object.values(MENSAGEM_ERRO_ANEXO)) expect(m.length).toBeGreaterThan(10);
  });
});

describe("decodificarTexto", () => {
  it("UTF-8 (com e sem BOM) e Windows-1252; normaliza quebras de linha", () => {
    expect(decodificarTexto(new Uint8Array([0xef, 0xbb, 0xbf, ...enc.encode("olá\r\nmundo")]))).toBe("olá\nmundo");
    expect(decodificarTexto(new Uint8Array([0x63, 0x61, 0x66, 0xe9]))).toBe("café");
    expect(decodificarTexto(new Uint8Array([0x41, 0x00]))).toBeNull();
  });
});

describe("sanitizarNome", () => {
  it("tira caminho (path traversal), controles e caracteres proibidos", () => {
    expect(sanitizarNome("../../etc/passwd.txt")).toBe("passwd.txt");
    expect(sanitizarNome("C:\\Users\\x\\proposta final.pdf")).toBe("proposta final.pdf");
    expect(sanitizarNome('a"b<c>d|e?*:.pdf')).toBe("a_b_c_d_e___.pdf");
    expect(sanitizarNome("a\u0000b\u202ec\nd.pdf")).toBe("abcd.pdf");
    expect(sanitizarNome("   ..  ")).toBe("anexo");
    expect(sanitizarNome(".env")).toBe("env");
  });

  it("limita o tamanho preservando a extensão", () => {
    const n = sanitizarNome(`${"a".repeat(400)}.pdf`);
    expect(n.length).toBeLessThanOrEqual(150);
    expect(n.endsWith(".pdf")).toBe(true);
  });
});

describe("cabecalhoDownload", () => {
  it("attachment com fallback ASCII e filename* UTF-8", () => {
    expect(cabecalhoDownload("Proposta Ação.pdf")).toBe(`attachment; filename="Proposta Acao.pdf"; filename*=UTF-8''Proposta%20A%C3%A7%C3%A3o.pdf`);
    // Aspas/barras nunca chegam aqui (sanitizarNome), mas o cabeçalho se protege sozinho.
    expect(cabecalhoDownload('a"b\\c.pdf')).toBe(`attachment; filename="a_b_c.pdf"; filename*=UTF-8''a%22b%5Cc.pdf`);
  });
});

describe("formatarTamanho", () => {
  it("B, KB e MB com vírgula", () => {
    expect(formatarTamanho(900)).toBe("900 B");
    expect(formatarTamanho(1536)).toBe("1,5 KB");
    expect(formatarTamanho(340 * 1024)).toBe("340 KB");
    expect(formatarTamanho(1.25 * 1024 * 1024)).toBe("1,3 MB");
  });
});
