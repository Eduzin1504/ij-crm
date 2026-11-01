import { redirect } from "next/navigation";
import { usuarioAtual } from "@/lib/auth/atual";
import { podeEscrever, ROTULO_PAPEL } from "@/lib/auth/papeis";
import { comTratamento, ehInesperado } from "@/lib/erros/registrar";
import { CAMPOS_PEDIDO, validarPedidoAutorizacao } from "@/lib/mcp/oauth";
import { Consentimento } from "./consentimento";

export const metadata = { title: "Conectar o Claude" };

/**
 * Tela de autorização do conector MCP (GAB-83): o Claude abre esta URL no
 * navegador. Sem sessão → login, que volta para cá (`?voltar=`). Mostra o
 * nome do cliente e, em destaque, o host para onde o código vai (spec MCP:
 * deixar claro o redirect, sobretudo quando é localhost).
 */
export default async function AutorizarPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const bruto = await searchParams;
  const q = Object.fromEntries(CAMPOS_PEDIDO.map((c) => [c, typeof bruto[c] === "string" ? bruto[c] : undefined])) as Record<string, string | undefined>;
  const v = await comTratamento("pagina.oauth.autorizar", () => validarPedidoAutorizacao(q));
  if (ehInesperado(v)) {
    return <Aviso titulo="Não foi possível abrir a autorização">Erro no servidor (ref: {v.ref}). Tente de novo; se persistir, informe a ref.</Aviso>;
  }
  if (!v.ok && v.redirecionar) redirect(v.url);
  if (!v.ok) return <Aviso titulo="Pedido de conexão inválido">{v.descricao}</Aviso>;

  const eu = await usuarioAtual();
  if (!eu) {
    const qs = new URLSearchParams(Object.entries(q).flatMap(([k, val]) => (val === undefined ? [] : [[k, val]])));
    redirect(`/login?voltar=${encodeURIComponent(`/oauth/autorizar?${qs}`)}`);
  }
  const destino = new URL(v.pedido.redirectUri);
  const local = destino.hostname === "localhost" || destino.hostname === "127.0.0.1" || destino.hostname === "[::1]";
  const campos = Object.fromEntries(Object.entries(q).flatMap(([k, val]) => (val === undefined ? [] : [[k, val]])));
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Conectar ao CRM</h1>
      <p className="mt-1 mb-6 text-sm text-fg-mute">
        <b className="font-medium text-foreground">{v.pedido.clienteNome}</b> quer acessar o ij-crm como você.
      </p>
      <dl className="mb-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="eyebrow">conta</dt>
        <dd className="text-fg-soft">
          {eu.nome} · {ROTULO_PAPEL[eu.papel]}
        </dd>
        <dt className="eyebrow">volta para</dt>
        <dd className="font-mono break-all text-fg-soft">{destino.host}</dd>
      </dl>
      <ul className="mb-6 list-disc space-y-1 pl-5 text-sm text-fg-soft">
        <li>O Claude poderá {podeEscrever(eu.papel) ? "ler e alterar" : "ler"} projetos com as mesmas permissões que você tem na tela.</li>
        <li>O que ele gravar aparece na Timeline com o seu nome, marcado “via MCP”.</li>
        <li>Você vê e revoga esta conexão no seu perfil, quando quiser.</li>
      </ul>
      {local ? (
        <p role="note" className="mb-4 rounded-lg border border-border bg-surface p-3 text-sm text-fg-soft">
          O código vai para um programa no seu computador (<span className="font-mono">{destino.host}</span>), como o Claude Code. Só autorize se foi você
          que pediu a conexão agora.
        </p>
      ) : null}
      <Consentimento campos={campos} />
    </>
  );
}

function Aviso({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{titulo}</h1>
      <p role="alert" className="mt-3 text-sm text-fg-soft">
        {children}
      </p>
    </>
  );
}
