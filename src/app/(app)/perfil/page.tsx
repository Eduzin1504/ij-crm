import { ErroCarregamento } from "@/components/erro-carregamento";
import { PageHeader } from "@/components/shell/page-header";
import { exigirUsuario, idSessaoAtual } from "@/lib/auth/atual";
import { descreverLado, ROTULO_AREA_ENTRADA } from "@/lib/auth/areas";
import { descreverDispositivo } from "@/lib/auth/dispositivo";
import { ROTULO_PAPEL } from "@/lib/auth/papeis";
import { listarSessoes } from "@/lib/auth/sessao";
import { areaDeEntrada, podeVerItemEmAlgumaArea } from "@/lib/auth/visibilidade";
import { db } from "@/lib/db";
import { comTratamento, ehInesperado } from "@/lib/erros/registrar";
import { listarConexoes } from "@/lib/mcp/oauth";
import { recursoMcp } from "@/lib/mcp/url";
import { paginaInicial, whatsappAvisosLigado } from "@/lib/preferencias/preferencias";
import { obterPreferencias } from "@/lib/preferencias/servico";
import { AvisosWhatsappForm, EmailForm, PaginaInicialForm, SenhaForm } from "./conta-forms";
import { FotoPerfil } from "./foto-perfil";
import { PerfilForm } from "./perfil-form";
import { ConexoesMcp } from "./conexoes-mcp";
import { Sessoes } from "./sessoes";

export const metadata = { title: "Meu perfil" };

export default async function PerfilPage() {
  const eu = await exigirUsuario();
  const dados = await comTratamento("pagina.perfil", () =>
    Promise.all([
      db.usuario.findUniqueOrThrow({
        where: { id: eu.id },
        select: { nome: true, email: true, papel: true, area: true, cargos: true, areaEntrada: true, telefoneWhatsapp: true, foto: { select: { atualizadoEm: true } } },
      }),
      obterPreferencias(eu.id),
      idSessaoAtual().then((atual) => listarSessoes(eu.id, atual)),
      listarConexoes(eu.id),
    ]),
  );
  if (ehInesperado(dados)) return <ErroCarregamento codigo={dados.ref} />;
  const [u, prefs, sessoes, conexoes] = dados;
  return (
    <>
      <PageHeader
        eyebrow="meu perfil"
        title={u.nome}
        description="Seu telefone é o que liga suas mensagens no grupo do WhatsApp aos cards do CRM."
      />
      <div className="grid max-w-4xl gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <FotoPerfil usuarioId={eu.id} nome={u.nome} fotoEm={u.foto?.atualizadoEm.getTime() ?? null} />
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
            <dt className="eyebrow">email</dt>
            <dd className="font-mono text-fg-soft">{u.email}</dd>
            <dt className="eyebrow">papel</dt>
            <dd className="text-fg-soft">{ROTULO_PAPEL[u.papel]}</dd>
            <dt className="eyebrow">área</dt>
            <dd className="text-fg-soft">{descreverLado(u)}</dd>
            <dt className="eyebrow">entrada</dt>
            <dd className="text-fg-soft">{ROTULO_AREA_ENTRADA[areaDeEntrada(u)]}</dd>
          </dl>
          <PerfilForm nome={u.nome} telefone={u.telefoneWhatsapp ?? ""} />
          {/* Quem não tem Minha Semana (visualizador) só tem o Kanban na área: nada a escolher. */}
          {podeVerItemEmAlgumaArea(u, "semana") ? <PaginaInicialForm atual={paginaInicial(prefs)} /> : null}
          <AvisosWhatsappForm ligado={whatsappAvisosLigado(prefs)} temTelefone={Boolean(u.telefoneWhatsapp)} />
        </div>
        <div className="space-y-6">
          <SenhaForm />
          <EmailForm email={u.email} />
          <Sessoes
            sessoes={sessoes.map((s) => ({
              id: s.id,
              dispositivo: descreverDispositivo(s.userAgent),
              criadoEm: s.criadoEm.toISOString(),
              ultimoUsoEm: s.ultimoUsoEm.toISOString(),
              atual: s.atual,
            }))}
          />
          <ConexoesMcp
            urlMcp={recursoMcp()}
            conexoes={conexoes.map((c) => ({ id: c.id, cliente: c.cliente, criadoEm: c.criadoEm.toISOString(), ultimoUsoEm: c.ultimoUsoEm.toISOString() }))}
          />
        </div>
      </div>
    </>
  );
}
