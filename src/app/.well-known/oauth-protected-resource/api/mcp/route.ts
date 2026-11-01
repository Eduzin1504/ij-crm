import { metadadosRecurso, respostaMetadados } from "@/lib/mcp/metadados";

/** RFC 9728 com inserção do caminho do endpoint (`/api/mcp`): é o que o 401 aponta. */
export function GET() {
  return respostaMetadados(metadadosRecurso());
}
