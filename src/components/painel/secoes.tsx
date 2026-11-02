/**
 * Seções do painel de vendas (GAB-94). Gráficos em HTML/CSS puro (barras com
 * largura percentual): nada de biblioteca de gráficos — são ≤ 15 linhas.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "cn";
import type { Acompanhamento, Conversao, Engajamento, Pessoa, Satisfacao } from "@/lib/painel/calculo";
import { DEFINICOES_PAINEL } from "@/lib/painel/definicoes";
import type { IndicadorProposta } from "@/lib/painel/proposta";
import type { Indicador } from "@/lib/painel/servico";
import { fmtDias, fmtDinheiro, fmtInteiro, fmtPercentual, TRACO } from "@/lib/ranking/formatar";

const NOTA = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtNota = (n: number | null) => (n === null ? TRACO : NOTA.format(n));
const fmtDiasInteiros = (d: number | null) => (d === null ? TRACO : fmtDias(Math.round(d * 10) / 10));
const nome = (p: Pessoa) => (p.ativo ? p.nome : `${p.nome} (inativo)`);

function Kpi({ rotulo, valor, dica, tom }: { rotulo: string; valor: string; dica?: string; tom?: "alerta" | "mudo" }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="eyebrow">{rotulo}</p>
      <p className={cn("mt-2 font-mono text-xl font-semibold tabular", tom === "alerta" && "text-danger", tom === "mudo" && "text-base font-normal text-fg-mute")}>{valor}</p>
      {dica ? <p className="mt-1 text-xs text-fg-faint">{dica}</p> : null}
    </div>
  );
}

function KpiProposta({ rotulo, ind, fmt }: { rotulo: string; ind: IndicadorProposta; fmt: (n: number) => string }) {
  return ind.disponivel ? <Kpi rotulo={rotulo} valor={fmt(ind.valor)} /> : <Kpi rotulo={rotulo} valor="sem dados" dica="Depende da Proposta no CRM (em construção)." tom="mudo" />;
}

/** Barra horizontal simples; `fracao` em [0, 1]. */
function Barra({ fracao, tom = "primario", rotulo }: { fracao: number | null; tom?: "primario" | "sucesso" | "perigo"; rotulo: string }) {
  const pct = fracao === null ? 0 : Math.max(0, Math.min(1, fracao)) * 100;
  return (
    <div role="img" aria-label={rotulo} className="h-2 w-full min-w-16 overflow-hidden rounded-full bg-surface-strong">
      <div className={cn("h-full rounded-full", tom === "primario" && "bg-primary", tom === "sucesso" && "bg-success", tom === "perigo" && "bg-danger")} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Barra empilhada (partes somam o total da linha), largura relativa ao `max` da tabela. */
function BarraEmpilhada({ partes, max, rotulo }: { partes: { valor: number; classe: string }[]; max: number; rotulo: string }) {
  return (
    <div role="img" aria-label={rotulo} className="flex h-2 w-full min-w-16 overflow-hidden rounded-full bg-surface-strong">
      {partes.map((p, i) => (max > 0 && p.valor > 0 ? <div key={i} className={cn("h-full", p.classe)} style={{ width: `${(p.valor / max) * 100}%` }} /> : null))}
    </div>
  );
}

function Legenda({ itens }: { itens: { rotulo: string; classe: string }[] }) {
  return (
    <p className="flex flex-wrap gap-3 text-xs text-fg-mute">
      {itens.map((i) => (
        <span key={i.rotulo} className="inline-flex items-center gap-1.5">
          <span aria-hidden className={cn("inline-block size-2 rounded-full", i.classe)} />
          {i.rotulo}
        </span>
      ))}
    </p>
  );
}

function Tabela({ cabecalho, children, minimo = "40rem" }: { cabecalho: { rotulo: string; numerica?: boolean; titulo?: string }[]; children: ReactNode; minimo?: string }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full text-sm" style={{ minWidth: minimo }}>
        <thead>
          <tr className="border-b border-border text-left">
            {cabecalho.map((c) => (
              <th key={c.rotulo} scope="col" title={c.titulo} className={cn("px-3 py-2 font-mono text-[11px] font-normal uppercase tracking-eyebrow text-fg-mute", c.numerica && "text-right")}>
                {c.rotulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

const TD = "px-3 py-2";
const TDN = "px-3 py-2 text-right font-mono tabular";

function Secao({ titulo, pergunta, indicador, children }: { titulo: string; pergunta: string; indicador: Indicador; children: ReactNode }) {
  return (
    <section aria-labelledby={`painel-${indicador}`} className="space-y-4">
      <div>
        <h2 id={`painel-${indicador}`} className="eyebrow">
          {titulo}
        </h2>
        <p className="mt-1 text-lg font-medium">{pergunta}</p>
      </div>
      {children}
      <details className="text-xs text-fg-faint">
        <summary className="cursor-pointer hover:text-fg-mute">Como é calculado</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {DEFINICOES_PAINEL[indicador].map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}

export function SecaoConversao({ c }: { c: Conversao }) {
  return (
    <Secao titulo="conversão" pergunta="Estamos convertendo?" indicador="conversao">
      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Kpi rotulo="Ganhos" valor={fmtInteiro(c.ganhos)} />
        <Kpi rotulo="Perdidos" valor={fmtInteiro(c.perdidos)} />
        <Kpi rotulo="Conversão" valor={fmtPercentual(c.conversao)} dica="ganhos ÷ (ganhos + perdidos)" />
        <Kpi rotulo="R$ fechado" valor={fmtDinheiro(c.valorFechado)} />
        <KpiProposta rotulo="R$ em proposta" ind={c.valorEmProposta} fmt={fmtDinheiro} />
        <KpiProposta rotulo="Versões até fechar" ind={c.versoesAteFechar} fmt={(n) => NOTA.format(n)} />
      </div>
      <Tabela
        cabecalho={[
          { rotulo: "Fase" },
          { rotulo: "Entradas", numerica: true },
          { rotulo: "Avanços", numerica: true },
          { rotulo: "Perdas", numerica: true },
          { rotulo: "Recuos", numerica: true },
          { rotulo: "Conversão", titulo: "avanços ÷ (avanços + perdas)" },
          { rotulo: "Tempo médio", numerica: true, titulo: "duração média das estadias que terminaram no período" },
        ]}
      >
        {c.fases.length === 0 ? (
          <tr>
            <td colSpan={7} className={cn(TD, "text-fg-mute")}>
              Nenhuma fase aberta em Vendas.
            </td>
          </tr>
        ) : (
          c.fases.map((f) => (
            <tr key={f.faseId} className="border-b border-border last:border-0">
              <td className={TD}>{f.nome}</td>
              <td className={TDN}>{fmtInteiro(f.entradas)}</td>
              <td className={TDN}>{fmtInteiro(f.avancos)}</td>
              <td className={TDN}>{fmtInteiro(f.perdas)}</td>
              <td className={TDN}>{fmtInteiro(f.recuos)}</td>
              <td className={TD}>
                <div className="flex items-center gap-2">
                  <Barra fracao={f.conversao} tom="sucesso" rotulo={`Conversão ${fmtPercentual(f.conversao)}`} />
                  <span className="w-10 text-right font-mono text-xs tabular">{fmtPercentual(f.conversao)}</span>
                </div>
              </td>
              <td className={TDN}>{fmtDiasInteiros(f.tempoMedioDias)}</td>
            </tr>
          ))
        )}
      </Tabela>
    </Secao>
  );
}

const CANAIS = [
  { chave: "whatsapp", rotulo: "WhatsApp #crm", classe: "bg-success" },
  { chave: "tela", rotulo: "Tela", classe: "bg-primary" },
  { chave: "mcp", rotulo: "MCP (Claude)", classe: "bg-chart-3" },
] as const;

export function SecaoEngajamento({ e }: { e: Engajamento }) {
  const max = Math.max(0, ...e.porVendedor.map((l) => l.interacoes));
  return (
    <Secao titulo="engajamento" pergunta="O time está engajado?" indicador="engajamento">
      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <Kpi rotulo="Interações" valor={fmtInteiro(e.time.interacoes)} />
        <Kpi rotulo="WhatsApp #crm" valor={fmtInteiro(e.time.whatsapp)} />
        <Kpi rotulo="Tela / MCP" valor={`${fmtInteiro(e.time.tela)} / ${fmtInteiro(e.time.mcp)}`} />
        <Kpi rotulo="Ações feitas" valor={fmtInteiro(e.time.acoesFeitas)} />
        <Kpi rotulo="Feitas no prazo" valor={fmtPercentual(e.time.taxaNoPrazo)} dica={`${fmtInteiro(e.time.acoesNoPrazo)} de ${fmtInteiro(e.time.acoesComPrazo)} com data`} />
      </div>
      <Legenda itens={CANAIS.map((c) => ({ rotulo: c.rotulo, classe: c.classe }))} />
      <Tabela
        cabecalho={[
          { rotulo: "Vendedor" },
          { rotulo: "Interações" },
          { rotulo: "#crm", numerica: true },
          { rotulo: "Tela", numerica: true },
          { rotulo: "MCP", numerica: true },
          { rotulo: "Ações feitas", numerica: true },
          { rotulo: "No prazo", numerica: true, titulo: "feitas até o dia marcado ÷ feitas com data" },
        ]}
      >
        {e.porVendedor.map((l) => (
          <tr key={l.usuario.id} className="border-b border-border last:border-0">
            <td className={TD}>{nome(l.usuario)}</td>
            <td className={TD}>
              <div className="flex items-center gap-2">
                <BarraEmpilhada max={max} partes={CANAIS.map((c) => ({ valor: l[c.chave], classe: c.classe }))} rotulo={`${l.interacoes} interações`} />
                <span className="w-8 text-right font-mono text-xs tabular">{fmtInteiro(l.interacoes)}</span>
              </div>
            </td>
            <td className={TDN}>{fmtInteiro(l.whatsapp)}</td>
            <td className={TDN}>{fmtInteiro(l.tela)}</td>
            <td className={TDN}>{fmtInteiro(l.mcp)}</td>
            <td className={TDN}>{fmtInteiro(l.acoesFeitas)}</td>
            <td className={TDN}>{fmtPercentual(l.taxaNoPrazo)}</td>
          </tr>
        ))}
      </Tabela>
    </Secao>
  );
}

/** `soMeus`: visão restrita (ranking oculto) — a lista de parados é só dos cards da pessoa. */
export function SecaoAcompanhamento({ a, soMeus = false }: { a: Acompanhamento; soMeus?: boolean }) {
  return (
    <Secao titulo="acompanhamento · agora" pergunta="Os leads estão sendo acompanhados?" indicador="acompanhamento">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi rotulo="Abertos em Vendas" valor={fmtInteiro(a.abertos)} />
        <Kpi rotulo="Sem próxima ação" valor={fmtInteiro(a.semProximaAcao)} tom={a.semProximaAcao > 0 ? "alerta" : undefined} />
        <Kpi rotulo="Próxima ação vencida" valor={fmtInteiro(a.vencidas)} tom={a.vencidas > 0 ? "alerta" : undefined} />
        <Kpi rotulo="Dias sem contato (média)" valor={fmtDiasInteiros(a.mediaDiasSemContato)} dica={a.semContatoRegistrado > 0 ? `${fmtInteiro(a.semContatoRegistrado)} sem nenhum contato registrado` : undefined} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Tabela
          minimo="28rem"
          cabecalho={[
            { rotulo: "Responsável" },
            { rotulo: "Abertos", numerica: true },
            { rotulo: "Sem ação", numerica: true },
            { rotulo: "Vencidas", numerica: true },
            { rotulo: "Sem contato", numerica: true, titulo: "média de dias desde o último contato" },
          ]}
        >
          {a.porResponsavel.map((l) => (
            <tr key={l.usuario.id} className="border-b border-border last:border-0">
              <td className={TD}>{nome(l.usuario)}</td>
              <td className={TDN}>{fmtInteiro(l.abertos)}</td>
              <td className={cn(TDN, l.semProximaAcao > 0 && "text-danger")}>{fmtInteiro(l.semProximaAcao)}</td>
              <td className={cn(TDN, l.vencidas > 0 && "text-danger")}>{fmtInteiro(l.vencidas)}</td>
              <td className={TDN}>{fmtDiasInteiros(l.mediaDiasSemContato)}</td>
            </tr>
          ))}
        </Tabela>
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="eyebrow">{soMeus ? "seus cards há mais tempo sem contato" : "há mais tempo sem contato"}</p>
          {a.maisParados.length === 0 ? (
            <p className="mt-2 text-sm text-fg-mute">{soMeus ? "Você não tem cards abertos em Vendas." : "Nenhum card aberto em Vendas."}</p>
          ) : (
            <ol className="mt-3 space-y-2">
              {a.maisParados.map((c) => (
                <li key={c.id} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate">
                    <Link href={`/projetos/${encodeURIComponent(c.id)}`} className="hover:underline">
                      {c.titulo}
                    </Link>
                    <span className="text-fg-mute">
                      {" · "}
                      {c.fase}
                      {c.responsavel ? ` · ${c.responsavel.nome}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-xs tabular text-fg-soft">{c.ultimoContatoEm ? fmtDias(c.diasSemContato) : `${fmtDias(c.diasSemContato)} (sem contato)`}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </Secao>
  );
}

const SENTIMENTOS = [
  { chave: "positivos", rotulo: "Positivo", classe: "bg-success" },
  { chave: "neutros", rotulo: "Neutro", classe: "bg-fg-faint" },
  { chave: "negativos", rotulo: "Negativo", classe: "bg-danger" },
] as const;

export function SecaoSatisfacao({ s }: { s: Satisfacao }) {
  const totalSent = s.time.positivos + s.time.neutros + s.time.negativos;
  return (
    <Secao titulo="satisfação" pergunta="Os leads gostaram do contato?" indicador="satisfacao">
      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi rotulo="Nota média (1–5)" valor={fmtNota(s.time.notaMedia)} dica={`${fmtInteiro(s.time.notas)} ${s.time.notas === 1 ? "nota" : "notas"}`} />
        <div className="rounded-xl border border-border bg-surface p-4 sm:col-span-2">
          <p className="eyebrow">sentimento nas mensagens #crm</p>
          {totalSent === 0 ? (
            <p className="mt-2 font-mono text-xl text-fg-mute">{TRACO}</p>
          ) : (
            <div className="mt-3 space-y-2">
              <BarraEmpilhada max={totalSent} partes={SENTIMENTOS.map((x) => ({ valor: s.time[x.chave], classe: x.classe }))} rotulo="Distribuição do sentimento" />
              <Legenda itens={SENTIMENTOS.map((x) => ({ rotulo: `${x.rotulo}: ${fmtInteiro(s.time[x.chave])} (${fmtPercentual(s.time[x.chave] / totalSent)})`, classe: x.classe }))} />
            </div>
          )}
        </div>
      </div>
      <Tabela
        cabecalho={[
          { rotulo: "Vendedor" },
          { rotulo: "Nota média", numerica: true },
          { rotulo: "Notas", numerica: true },
          { rotulo: "Sentimento" },
          { rotulo: "Pos.", numerica: true },
          { rotulo: "Neu.", numerica: true },
          { rotulo: "Neg.", numerica: true },
        ]}
      >
        {s.porVendedor.map((l) => {
          const t = l.positivos + l.neutros + l.negativos;
          return (
            <tr key={l.usuario.id} className="border-b border-border last:border-0">
              <td className={TD}>{nome(l.usuario)}</td>
              <td className={TDN}>{fmtNota(l.notaMedia)}</td>
              <td className={TDN}>{fmtInteiro(l.notas)}</td>
              <td className={TD}>
                <BarraEmpilhada max={t} partes={SENTIMENTOS.map((x) => ({ valor: l[x.chave], classe: x.classe }))} rotulo={`${l.positivos} positivos, ${l.neutros} neutros, ${l.negativos} negativos`} />
              </td>
              <td className={TDN}>{fmtInteiro(l.positivos)}</td>
              <td className={TDN}>{fmtInteiro(l.neutros)}</td>
              <td className={TDN}>{fmtInteiro(l.negativos)}</td>
            </tr>
          );
        })}
      </Tabela>
    </Secao>
  );
}
