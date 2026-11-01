import { atenderMcp } from "@/lib/mcp/servidor";

// Conector MCP (GAB-83). Autenticação por Bearer do OAuth, não pelo cookie: rota pública no proxy.
export const dynamic = "force-dynamic";

export const POST = (req: Request) => atenderMcp(req);
export const GET = (req: Request) => atenderMcp(req);
export const DELETE = (req: Request) => atenderMcp(req);
