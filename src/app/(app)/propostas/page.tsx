import Link from "next/link";
import type { StatusProposta } from "@prisma/client";
import { PageHeader } from "@/components/shell/page-header";
import { StatusPropostaBadge } from "@/components/propostas/status-proposta";
import { Button } from "@/components/ui/button";
import { exigirUsuario } from "@/lib/auth/atual";
import { formatarDataHora, formatarDinheiro } from "@/lib/projetos/formatar";
import { listarResponsaveis } from "@/lib/projetos/projetos";
import { listarPropostas } from "@/lib/propostas/propostas";
import { ROTULO_STATUS_PROPOSTA, STATUS_PROPOSTA } from "@/lib/propostas/regras";

export const metadata = { title: "Propostas" };

type Busca = { status?: string | string[]; responsavel?: string | string[]; q?: string | string[] };
const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const campo =
  "h-8 rounded-lg border border-input bg-input/30 px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * Aba Propostas (GAB-86): todas as propostas, com status, valor e última
 * versão. Filtros por GET (link compartilhável): status, responsável, texto.
 * Todos leem (transparência); a edição é dentro de cada Projeto.
 */
export default async function PropostasPage({ searchParams }: { searchParams: Promise<Busca> }) {
  const eu = await exigirUsuario();
  const p = await searchParams;
  const statusBruto = um(p.status);
  const status = (STATUS_PROPOSTA as readonly string[]).includes(statusBruto) ? (statusBruto as StatusProposta) : undefined;
  const responsavelBruto = um(p.responsavel);
  const responsavelId = responsavelBruto === "eu" ? eu.id : responsavelBruto.slice(0, 64) || undefined;
  const texto = um(p.q).slice(0, 200);
  const [propostas, responsaveis] = await Promise.all([listarPropostas({ status, responsavelId, texto }), listarResponsaveis()]);
  const filtrando = Boolean(status || responsavelId || texto.trim());

  return (
    <>
      <PageHeader eyebrow="vendas · propostas" title="Propostas" description="Uma proposta por projeto. Abra o projeto para criar ou editar; aqui você acompanha o status de todas." />

      <form method="get" className="mb-4 flex flex-wrap items-end gap-2" role="search" aria-label="Filtrar propostas">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[11px] text-fg-mute uppercase">Status</span>
          <select name="status" defaultValue={status ?? ""} className={campo}>
            <option value="">Todos</option>
            {STATUS_PROPOSTA.map((s) => (
              <option key={s} value={s}>
                {ROTULO_STATUS_PROPOSTA[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[11px] text-fg-mute uppercase">Responsável</span>
          <select name="responsavel" defaultValue={responsavelBruto} className={campo}>
            <option value="">Todos</option>
            <option value="eu">Eu</option>
            {responsaveis.map((r) => (
              <option key={r.id} value={r.id}>
                {r.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-48 flex-1 flex-col gap-1">
          <span className="font-mono text-[11px] text-fg-mute uppercase">Busca</span>
          <input name="q" defaultValue={texto} placeholder="projeto ou empresa" className={campo} />
        </label>
        <Button type="submit" size="sm">
          Filtrar
        </Button>
        {filtrando ? (
          <Link href="/propostas" className="pb-1.5 text-xs text-fg-mute underline underline-offset-2 hover:text-foreground">
            limpar
          </Link>
        ) : null}
      </form>

      {propostas.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border-strong bg-surface/40 p-8 text-center text-sm text-fg-faint">
          {filtrando ? "Nenhuma proposta com esses filtros." : "Nenhuma proposta ainda. Crie a partir de um projeto (detalhe do card → Proposta)."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="eyebrow px-4 py-3 font-normal">projeto</th>
                <th className="eyebrow px-4 py-3 font-normal">status</th>
                <th className="eyebrow hidden px-4 py-3 font-normal md:table-cell">responsável</th>
                <th className="eyebrow hidden px-4 py-3 text-right font-normal sm:table-cell">valor</th>
                <th className="eyebrow hidden px-4 py-3 font-normal lg:table-cell">versão</th>
                <th className="eyebrow hidden px-4 py-3 font-normal lg:table-cell">atualizada</th>
              </tr>
            </thead>
            <tbody>
              {propostas.map((x) => (
                <tr key={x.id} className="border-b border-border align-top last:border-0 hover:bg-surface-hover">
                  <td className="px-4 py-2.5">
                    <Link href={`/projetos/${x.projeto.id}/proposta`} className="text-foreground hover:underline">
                      {x.projeto.titulo}
                    </Link>
                    <span className="block text-xs text-fg-mute">
                      {x.projeto.empresa ? `${x.projeto.empresa} · ` : ""}
                      {x.projeto.fase.nome}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusPropostaBadge status={x.status} />
                  </td>
                  <td className="hidden px-4 py-2.5 text-fg-soft md:table-cell">{x.projeto.responsavel.nome}</td>
                  <td className="hidden px-4 py-2.5 text-right font-mono tabular text-fg-soft sm:table-cell">{x.valor ? formatarDinheiro(x.valor) : "—"}</td>
                  <td className="hidden px-4 py-2.5 font-mono text-xs text-fg-soft lg:table-cell">
                    {x.ultimaVersao ? (
                      <Link href={`/projetos/${x.projeto.id}/proposta/versoes/${x.ultimaVersao.numero}`} className="hover:underline">
                        v{x.ultimaVersao.numero}
                      </Link>
                    ) : (
                      <span className="text-fg-faint">só rascunho</span>
                    )}
                  </td>
                  <td className="hidden px-4 py-2.5 font-mono text-[11px] text-fg-faint lg:table-cell">{formatarDataHora(x.atualizadoEm)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
