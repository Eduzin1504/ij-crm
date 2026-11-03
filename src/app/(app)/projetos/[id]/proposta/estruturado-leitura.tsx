import { formatarDia, formatarDinheiro } from "@/lib/projetos/formatar";
import { somaDasParcelas, type Estruturado } from "@/lib/propostas/estruturado";

/** Parte estruturada só para leitura (quem não edita e as versões). */
export function EstruturadoLeitura({ e }: { e: Estruturado }) {
  const soma = somaDasParcelas(e.entregas);
  return (
    <dl className="space-y-3 text-sm">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <dt className="font-mono text-[11px] text-fg-mute uppercase">Valor</dt>
          <dd>{e.valor ? formatarDinheiro(e.valor) : "—"}</dd>
        </div>
        <div>
          <dt className="font-mono text-[11px] text-fg-mute uppercase">Prazo</dt>
          <dd>{e.prazoDias ? `${e.prazoDias} dias` : "—"}</dd>
        </div>
      </div>
      <div>
        <dt className="font-mono text-[11px] text-fg-mute uppercase">Escopo resumido</dt>
        <dd className="break-words whitespace-pre-wrap">{e.escopoResumo ?? "—"}</dd>
      </div>
      <div>
        <dt className="font-mono text-[11px] text-fg-mute uppercase">Cronograma</dt>
        <dd>
          {e.entregas.length === 0 ? (
            "—"
          ) : (
            <ol className="mt-1 space-y-1">
              {e.entregas.map((x, i) => (
                <li key={i} className="flex gap-2">
                  <span className="w-5 font-mono text-xs text-fg-faint tabular">{i + 1}</span>
                  <span className="min-w-0 flex-1 break-words">{x.titulo}</span>
                  <span className="font-mono text-xs text-fg-mute tabular">{formatarDia(x.dia)}</span>
                  <span className="w-28 text-right font-mono text-xs tabular">{x.valor ? formatarDinheiro(x.valor) : "—"}</span>
                </li>
              ))}
            </ol>
          )}
          {soma ? <p className="mt-1 text-right font-mono text-[11px] text-fg-faint">soma das parcelas: {formatarDinheiro(soma)}</p> : null}
        </dd>
      </div>
    </dl>
  );
}
