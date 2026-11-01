import { metadadosServidorAutorizacao, respostaMetadados } from "@/lib/mcp/metadados";

/** RFC 8414: metadados do servidor de autorização (issuer = raiz do app). */
export function GET() {
  return respostaMetadados(metadadosServidorAutorizacao());
}
