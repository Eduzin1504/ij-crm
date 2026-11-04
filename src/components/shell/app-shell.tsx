import type { ReactNode } from "react";
import type { Area } from "@prisma/client";
import type { UsuarioSessao } from "@/lib/auth/sessao";
import type { PaginaInicial } from "@/lib/preferencias/preferencias";
import { podeEscrever } from "@/lib/auth/papeis";
import { NavegacaoAreaProvider } from "./area-atual";
import { QuadroAtivoProvider } from "./quadro-ativo";
import { Rail } from "./rail";
import { SomenteLeituraProvider } from "./somente-leitura";
import { Topbar } from "./topbar";

/**
 * `inicio` = o que abre dentro de cada área (preferência do usuário); `ultimaArea`
 * = a do cookie, para rotas que não definem área.
 */
export function AppShell({
  children,
  usuario,
  inicio,
  ultimaArea,
}: {
  children: ReactNode;
  usuario: UsuarioSessao;
  inicio: PaginaInicial;
  ultimaArea: Area | null;
}) {
  const pessoa = { papel: usuario.papel, area: usuario.area, cargos: usuario.cargos, areaEntrada: usuario.areaEntrada };
  return (
    <QuadroAtivoProvider>
      <NavegacaoAreaProvider pessoa={pessoa} inicio={inicio} ultimaArea={ultimaArea}>
        <div className="flex min-h-screen">
          <Rail />
          <div className="flex min-w-0 flex-1 flex-col pb-16 md:pb-0 md:pl-[88px]">
            <Topbar usuario={usuario} />
            <main className="flex-1 px-4 py-6 md:px-8 md:py-8">
              <SomenteLeituraProvider valor={!podeEscrever(usuario.papel)}>{children}</SomenteLeituraProvider>
            </main>
          </div>
        </div>
      </NavegacaoAreaProvider>
    </QuadroAtivoProvider>
  );
}
