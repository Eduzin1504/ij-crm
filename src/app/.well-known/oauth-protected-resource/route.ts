import { metadadosRecurso, respostaMetadados } from "@/lib/mcp/metadados";

/** RFC 9728 na raiz (fallback dos clientes que não leem o `WWW-Authenticate`). */
export function GET() {
  return respostaMetadados(metadadosRecurso());
}
