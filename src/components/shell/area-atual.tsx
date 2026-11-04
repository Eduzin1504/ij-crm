"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type { Area } from "@prisma/client";
import { areaPadrao, COOKIE_AREA, type PessoaComEntrada } from "@/lib/auth/visibilidade";
import type { PaginaInicial } from "@/lib/preferencias/preferencias";
import { areaDaRota } from "./nav-config";
import { useQuadroAtivo } from "./quadro-ativo";

const UM_ANO_EM_SEGUNDOS = 60 * 60 * 24 * 365;

function gravarUltimaArea(area: Area) {
  const seguro = window.location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${COOKIE_AREA}=${area}; path=/; max-age=${UM_ANO_EM_SEGUNDOS}; samesite=lax${seguro}`;
}

type Navegacao = {
  pessoa: PessoaComEntrada;
  inicio: PaginaInicial;
  /** Área do menu agora. */
  area: Area;
  /** Quadro da página (declarado pelo detalhe do card ou `?quadro=`), para acender o item ativo. */
  quadro: string | null;
  gavetaAberta: boolean;
  /** Abre a gaveta; o foco volta a `elemento` quando ela fechar. */
  abrirGaveta: (elemento: HTMLElement) => void;
  fecharGaveta: () => void;
  gatilhoGaveta: RefObject<HTMLElement | null>;
  /** Escolha na gaveta: grava a área já, porque o destino pode ser uma rota sem área (ex.: Minha Semana do admin). */
  escolherArea: (area: Area) => void;
};

const Ctx = createContext<Navegacao | null>(null);

/**
 * Área atual e estado da gaveta, para rail, topbar e gaveta (§4.2, §4.7). A rota
 * manda quando define área; senão vale a última aberta, que fica em cookie (o
 * layout lê no servidor, e o primeiro HTML já sai com o menu certo).
 */
export function NavegacaoAreaProvider({
  pessoa,
  inicio,
  ultimaArea,
  children,
}: {
  pessoa: PessoaComEntrada;
  inicio: PaginaInicial;
  ultimaArea: Area | null;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const parametro = useSearchParams().get("quadro");
  const declarado = useQuadroAtivo();
  const quadro = declarado ?? parametro;

  const daRota = areaDaRota(pathname, quadro, pessoa);
  const [ultima, setUltima] = useState<Area | null>(daRota ?? ultimaArea);
  // Só quando a rota MUDA: comparar com `ultima` desfaria a escolha na gaveta enquanto a navegação não termina.
  const [rotaAnterior, setRotaAnterior] = useState(daRota);
  if (daRota !== rotaAnterior) {
    setRotaAnterior(daRota);
    if (daRota) setUltima(daRota);
  }
  useEffect(() => {
    if (daRota) gravarUltimaArea(daRota);
  }, [daRota]);

  const [gavetaAberta, setGavetaAberta] = useState(false);
  const gatilhoGaveta = useRef<HTMLElement | null>(null);
  const abrirGaveta = useCallback((elemento: HTMLElement) => {
    gatilhoGaveta.current = elemento;
    setGavetaAberta(true);
  }, []);
  const fecharGaveta = useCallback(() => setGavetaAberta(false), []);
  const escolherArea = useCallback((escolhida: Area) => {
    gravarUltimaArea(escolhida);
    setUltima(escolhida);
    setGavetaAberta(false);
  }, []);

  const area = daRota ?? ultima ?? areaPadrao(pessoa);
  const valor = useMemo(
    () => ({ pessoa, inicio, area, quadro, gavetaAberta, abrirGaveta, fecharGaveta, gatilhoGaveta, escolherArea }),
    [pessoa, inicio, area, quadro, gavetaAberta, abrirGaveta, fecharGaveta, escolherArea],
  );
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useNavegacaoArea(): Navegacao {
  const v = useContext(Ctx);
  if (!v) throw new Error("useNavegacaoArea fora de NavegacaoAreaProvider");
  return v;
}
