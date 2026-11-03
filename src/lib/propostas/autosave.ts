/**
 * Autosave do rascunho da proposta (lado cliente, sem React — testável com
 * relógio falso). Regras:
 * - cada edição reinicia a espera (`atrasoMs`); depois grava o ÚLTIMO texto;
 * - uma gravação por vez (fila): texto, parte estruturada e "salvar versão"
 *   nunca correm juntos, e cada uma usa a revisão devolvida pela anterior;
 * - CONFLITO (outra aba/pessoa/MCP gravou antes): para de gravar, guarda o
 *   texto local e espera a pessoa escolher — carregar o do servidor ou manter o
 *   seu (aí grava sobre a revisão nova, por escolha explícita);
 * - erro (rede, servidor com ref): o texto continua pendente; nada se perde.
 */

export type ConflitoCliente = { revisao: number; por: string | null; viaMcp: boolean; em: string | null };

/** O que as actions devolvem (forma comum). `ref` = erro inesperado logado no servidor. */
export type RespostaGravacao =
  | { ok: true; revisao: number }
  | { ok?: false; erro: string; ref?: string; conflito?: ConflitoCliente & Record<string, unknown> };

export type EstadoAutosave =
  | { tipo: "salvo"; em: Date | null }
  | { tipo: "pendente" }
  | { tipo: "salvando" }
  | { tipo: "conflito"; conflito: ConflitoCliente & Record<string, unknown> }
  | { tipo: "erro"; texto: string; ref?: string };

export const FALHA_REDE = "Sem conexão com o servidor. O texto continua aqui; tente de novo.";

export class Autosave<Doc> {
  private revisao: number;
  private pendenteDoc: Doc | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private fila: Promise<unknown> = Promise.resolve();
  private estado: EstadoAutosave = { tipo: "salvo", em: null };

  constructor(
    private readonly opcoes: {
      revisao: number;
      atrasoMs: number;
      salvarTexto: (revisao: number, doc: Doc) => Promise<RespostaGravacao>;
      aoMudar: (e: EstadoAutosave) => void;
    },
  ) {
    this.revisao = opcoes.revisao;
  }

  get revisaoAtual(): number {
    return this.revisao;
  }

  /** Estado atual (conflito/erro/salvo…) — lido fora do render (antes de passar a caneta). */
  get situacao(): EstadoAutosave {
    return this.estado;
  }

  /** Há texto que ainda não chegou ao servidor (aviso ao sair da página). */
  get temPendencia(): boolean {
    return this.pendenteDoc !== null || this.estado.tipo === "salvando";
  }

  private mudar(e: EstadoAutosave) {
    this.estado = e;
    this.opcoes.aoMudar(e);
  }

  /** O editor mudou: agenda a gravação (a não ser que haja conflito aberto). */
  alterou(doc: Doc) {
    this.pendenteDoc = doc;
    if (this.estado.tipo === "conflito") return;
    this.mudar({ tipo: "pendente" });
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.enfileirar(() => this.gravarTexto());
    }, this.opcoes.atrasoMs);
  }

  /** Grava já o que estiver pendente (ex.: antes de sair, ou "tentar de novo"). */
  agora(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    return this.enfileirar(() => this.gravarTexto());
  }

  private enfileirar<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.fila.then(fn);
    this.fila = p.catch(() => undefined);
    return p;
  }

  /** Interpreta a resposta: avança a revisão, ou abre conflito/erro. true = gravou. */
  private tratar(r: RespostaGravacao | undefined): boolean {
    if (r && r.ok === true) {
      this.revisao = r.revisao;
      return true;
    }
    if (r && r.conflito) this.mudar({ tipo: "conflito", conflito: r.conflito });
    else this.mudar({ tipo: "erro", texto: r?.erro ?? FALHA_REDE, ref: r?.ref });
    return false;
  }

  private async gravarTexto(): Promise<void> {
    if (this.estado.tipo === "conflito" || this.pendenteDoc === null) return;
    const doc = this.pendenteDoc;
    this.pendenteDoc = null;
    this.mudar({ tipo: "salvando" });
    let r: RespostaGravacao | undefined;
    try {
      r = await this.opcoes.salvarTexto(this.revisao, doc);
    } catch {
      r = undefined;
    }
    if (this.tratar(r)) {
      this.mudar(this.pendenteDoc !== null ? { tipo: "pendente" } : { tipo: "salvo", em: new Date() });
      if (this.pendenteDoc !== null) void this.agora();
    } else {
      // não perde o texto: volta a ser pendente (o mais novo, se a pessoa seguiu digitando)
      this.pendenteDoc ??= doc;
    }
  }

  /**
   * Outra gravação (parte estruturada, "salvar versão") na MESMA fila, com a
   * revisão atual. `levaTexto`: a operação já manda o texto do editor (a
   * versão manda) — então o pendente sai da fila.
   */
  executar(op: (revisao: number) => Promise<RespostaGravacao>, levaTexto = false): Promise<RespostaGravacao | undefined> {
    return this.enfileirar(async () => {
      if (this.estado.tipo === "conflito") return undefined;
      if (levaTexto && this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      const doc = levaTexto ? this.pendenteDoc : null;
      if (levaTexto) this.pendenteDoc = null;
      this.mudar({ tipo: "salvando" });
      let r: RespostaGravacao | undefined;
      try {
        r = await op(this.revisao);
      } catch {
        r = undefined;
      }
      if (this.tratar(r)) {
        this.mudar(this.pendenteDoc !== null ? { tipo: "pendente" } : { tipo: "salvo", em: new Date() });
        if (this.pendenteDoc !== null) void this.agora();
      } else if (doc !== null) {
        this.pendenteDoc ??= doc;
      }
      return r;
    });
  }

  /**
   * Uma ação da caneta (GAB-87) incrementou a revisão no servidor sem mexer no
   * texto: adota a nova, sem descartar o que estiver pendente (senão a próxima
   * digitação de quem continua editando daria conflito falso).
   */
  adotarRevisao(revisao: number) {
    this.revisao = revisao;
  }

  /** Conflito resolvido carregando o do servidor: o texto local é descartado. */
  usarDoServidor(revisao: number) {
    this.revisao = revisao;
    this.pendenteDoc = null;
    this.mudar({ tipo: "salvo", em: new Date() });
  }

  /** Conflito resolvido mantendo o local: grava por cima da revisão nova (escolha explícita). */
  manterMeu(revisao: number, doc: Doc): Promise<void> {
    this.revisao = revisao;
    this.pendenteDoc = doc;
    this.mudar({ tipo: "pendente" });
    return this.agora();
  }
}
