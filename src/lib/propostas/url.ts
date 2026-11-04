/** Rota do PDF da proposta (GAB-89): a tela e o MCP montam o link igual. `versao` fixa a versão final que o link baixa. */
export function urlPdfDaProposta(base: string, projetoId: string, versao?: number): string {
  return `${base}/api/projetos/${encodeURIComponent(projetoId)}/proposta/pdf${versao ? `?versao=${versao}` : ""}`;
}

/** Prévia do rascunho atual (GAB-100, "Ver PDF"), aberta no navegador. */
export function urlPreviaDaProposta(base: string, projetoId: string): string {
  return `${base}/api/projetos/${projetoId}/proposta/pdf?rascunho=1`;
}
