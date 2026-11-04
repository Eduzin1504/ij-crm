# Kanban interno do projeto (tasks do time)

Data: 2026-11-04. Status: pronto para plano. Pontos marcados com **[escolha do
autor]** foram definidos na escrita da spec, sem validação do Gabriel: podem ser
questionados.

## 1. O que é e por quê

Hoje o CRM mostra em que fase cada projeto está, mas não o trabalho dentro dele. O
time de projetos precisa alinhar as tasks do dia a dia, no estilo do Linear, dentro
do próprio CRM.

São **dois kanbans diferentes**. Esta spec trata só do segundo:

| | Kanban geral | Kanban interno (esta spec) |
|---|---|---|
| Mostra | onde cada projeto está no fluxo | as tasks do time naquele projeto |
| Cada card é | um projeto | uma task |
| Quem vê | todo mundo | só o time de projetos |
| Onde fica | quadro de Projetos (`/kanban?quadro=projetos`), já existe | dentro de cada projeto |

Sucesso: uma pessoa de projetos abre um projeto, vê o que cada colega está fazendo,
cria e arrasta tasks. Ninguém de fora do time vê que essas tasks existem.

## 2. Escopo

**Entra**

**O Linear é a base** (decisão do Gabriel): em caso de dúvida sobre como algo deve
funcionar, faça como o Linear faz. A referência é o funcionamento, adaptado ao CRM e
ao visual do projeto, sem copiar marca nem identidade visual dele.

- Página `/projetos/[id]/tarefas`, com link na página do projeto.
- Criar, editar, excluir e arrastar tasks entre colunas e dentro da coluna.
- Task com identificador, título, descrição, status, prioridade, responsável, prazo
  e etiquetas.
- Visões de quadro e de lista, com agrupamento e filtros (seção 4).
- Subtasks, comentários e histórico de atividade em cada task.
- Aviso no sino para quem recebe uma task.
- Bloqueio de acesso no servidor (seção 5).

**Ordem de entrega** **[escolha do autor]**: um PR por etapa.

1. Modelo, acesso e quadro: status, responsável, prazo, arrastar e separar por pessoa.
2. Prioridade, etiquetas, visão de lista, filtros, agrupamentos e atalhos de teclado.
3. Subtasks, comentários, histórico de atividade e aviso no sino.

**Não entra**

- Item no menu lateral. O acesso é só pela página do projeto.
- Tasks em qualquer visão geral: quadro de Projetos, Tabela, Painel, Minha Semana,
  Calendário.
- Cronograma de entregas e check-in semanal: são do GAB-95 e ficam separados. Uma
  task poderá apontar para uma entrega mais tarde, sem nada disso agora.
- Escala de membros por projeto ("Gestão de membros ↔ projetos", item próprio do
  roadmap).
- **[escolha do autor]** Do Linear, ficam para depois: ciclos, estimativas, status
  personalizáveis, dependências entre tasks, visões salvas e vínculo com GitHub.
- **[escolha do autor]** Ferramentas MCP e aviso por WhatsApp ficam para depois.

**Anti-objetivos** (seria falha mesmo funcionando)

- Vazar task para quem é de fora do time por qualquer caminho: página, action,
  Timeline do card, busca, MCP.
- Adicionar dependência nova: `@dnd-kit` já está no projeto.

## 3. Modelo de dados

Tabela nova, ligada ao `Projeto`. Sugestão, com os detalhes a cargo de quem constrói:

```prisma
enum StatusTarefa {
  BACKLOG
  A_FAZER
  EM_ANDAMENTO
  EM_REVISAO
  FEITA
  CANCELADA
}

enum PrioridadeTarefa {
  SEM_PRIORIDADE
  URGENTE
  ALTA
  MEDIA
  BAIXA
}

model Tarefa {
  id            String           @id @default(cuid())
  projetoId     String           @map("oportunidade_id") // a tabela de Projeto se chama "oportunidade"
  numero        Int              // sequencial por projeto; aparece como #12
  paiId         String?          @map("pai_id") // subtask: um nível só
  titulo        String
  descricao     String?
  status        StatusTarefa     @default(A_FAZER)
  prioridade    PrioridadeTarefa @default(SEM_PRIORIDADE)
  posicao       Float            // ordem dentro da coluna
  responsavelId String?          @map("responsavel_id") // pode ficar sem responsável
  prazo         DateTime?        @db.Date
  etiquetas     String[]         @default([])
  concluidaEm   DateTime?        @map("concluida_em")
  criadoPorId   String           @map("criado_por_id")
  deletadoEm    DateTime?        @map("deletado_em")
  criadoEm      DateTime         @default(now()) @map("criado_em")
  atualizadoEm  DateTime         @updatedAt @map("atualizado_em")

  projeto Projeto @relation(fields: [projetoId], references: [id], onDelete: Cascade)
  // + relações com Usuario (responsavel com onDelete: SetNull; criadoPor) e auto-relação do pai

  @@unique([projetoId, numero])
  @@index([projetoId, status, posicao])
  @@map("tarefa")
}

// Etapa 3: tabelas próprias, nunca a Timeline do card (seção 5).
// TarefaComentario: tarefaId, autorId, texto, criadoEm, deletadoEm.
// TarefaAtividade (só inserção): tarefaId, usuarioId, tipo, payload, em.
```

- **[escolha do autor]** Os seis status são fixos, como os padrões do Linear. No
  quadro, Backlog e Cancelada ficam recolhidas por padrão.
- **[escolha do autor]** Identificador `#12` por projeto, sem prefixo de time. Gere o
  número dentro da transação, para duas criações simultâneas não repetirem número, e
  não reaproveite o de task excluída.
- **[escolha do autor]** Etiquetas como texto livre, com sugestão das já usadas naquele
  projeto, sem tela de administração.
- Excluir é soft delete (`deletadoEm`), como em `Prazo`. Apagar o projeto de vez leva
  as tasks junto (`onDelete: Cascade`). Excluir a task pai leva as subtasks junto.
- `concluidaEm` é preenchido ao entrar em `FEITA` ou `CANCELADA` e limpo ao sair.
- O campo `prazo` é só dia. Use os helpers de fuso que já existem (`diaEmFuso`, em
  `src/lib/projetos/aging.ts`), porque o sistema trabalha no horário de São Paulo.

## 4. Tela

- **Quadro:** uma coluna por status. Arrastar com `@dnd-kit`, como em
  `src/app/(app)/kanban/quadro-kanban.tsx`.
- **Lista:** as mesmas tasks em linhas, agrupadas por status, com edição direta de
  status, prioridade, responsável e prazo. A escolha entre quadro e lista fica salva
  por pessoa (`usuario.preferencias`).
- **Separar por pessoa:** o quadro agrupa as tasks em uma linha por responsável, com
  uma linha "Sem responsável" no fim.
- **[escolha do autor]** A interpretação de "separa as tasks do time" é essa
  separação em linhas, e ela é o modo padrão. O agrupamento pode ser trocado para
  prioridade, etiqueta ou nenhum.
- **Filtros** no topo: responsável, status, prioridade, etiqueta e prazo. Ficam na URL,
  para poder mandar o link a um colega.
- **Cartão da task:** identificador, título, ícone de prioridade, etiquetas, avatar do
  responsável, prazo com destaque se atrasado e progresso das subtasks (2/5).
- **Detalhe da task:** abre em painel ou página, com descrição, propriedades ao lado,
  subtasks, comentários e histórico de atividade (quem mudou o quê e quando).
- **Criação:** rápida pelo título, direto na coluna, ou pelo atalho `C`.
- **Atalhos de teclado [escolha do autor]:** `C` cria, `A` escolhe o responsável, `S` o
  status, `P` a prioridade, `Esc` fecha. Os atalhos não disparam enquanto a pessoa
  digita num campo de texto.
- **Aviso no sino:** quem recebe uma task é avisado no app, sem aviso para quem atribuiu
  a si mesmo. Use `emitirAvisos` (`src/lib/avisos/avisos.ts`), depois do commit. O texto
  do aviso só chega a quem já passa na regra de acesso da seção 5.
- **Responsável:** pessoas ativas que passam na regra de acesso da seção 5.
- Link na página do projeto (`src/app/(app)/projetos/[id]/page.tsx`, perto do link da
  proposta), visível só para quem tem acesso.
- Precisa funcionar no celular, mesmo que com rolagem horizontal nas colunas.

**[escolha do autor]** O kanban interno só existe para card que está no quadro de
Projetos (`card.pipeline.chave === "projetos"`). Em outro quadro o link não aparece e
a rota responde 404. Se o card voltar para Vendas, as tasks continuam no banco e
reaparecem quando ele retornar.

## 5. Quem acessa

Regra única, em função pura ao lado de `src/lib/auth/areas.ts`:

```ts
// Pessoa da área de Projetos (inclui o gestor com essa área) ou admin.
export function podeVerTarefas(u: PessoaComLado): boolean {
  return u.papel === "ADMIN" || ladoDe(u) === "PROJETOS";
}
```

| Quem | Acesso |
|---|---|
| Papel PROJETOS | vê e edita |
| GESTOR com área Projetos | vê e edita |
| ADMIN | vê e edita |
| VENDEDOR, GESTOR de Vendas ou sem área, VISUALIZADOR | nada: sem link, e a rota e as actions recusam |

**Em aberto com o Gabriel:** "só o time de projetos" pode significar toda a área ou
só quem está escalado naquele projeto. Como a escala ainda não existe, começa valendo
toda a área. Toda checagem deve passar por essa função, para a troca ser em um lugar
só.

**Pontos de atenção**

- A regra vale em toda página e **toda server action**, não só no link. `exigirEscrita`
  não basta: ele deixa passar vendedor.
- Confira se o usuário da sessão traz `area` e `cargos`. A página da proposta busca
  esses dados à parte (`pessoaDaCaneta`), e o mesmo pode ser necessário aqui.
- A action precisa conferir que a task pertence ao projeto informado.
- **Não grave nada na `Timeline` do card.** A Timeline aparece para todo mundo, então
  registrar task nela vazaria o conteúdo para Vendas. É a armadilha mais fácil de
  cair, já que o resto do sistema registra tudo lá.

## 6. Convivência com o resto do projeto

- **Não mexa em `src/components/shell/rail.tsx` nem em `nav-config.ts`.** O menu está
  sendo reestruturado por área em outro trabalho
  (`docs/superpowers/specs/2026-11-03-areas-hub-design.md`).
- **Migration:** nome com o timestamp real do dia (a última em `main` é
  `20261101210000_comentarios`). Nunca rode `prisma migrate reset` num banco com dados
  sem combinar com o Gabriel.
- **Erros:** a tela mostra uma `ref` e o log do servidor tem a causa com a mesma `ref`.
  Use `comTratamento` (`src/lib/erros/registrar`), como em
  `src/app/(app)/projetos/[id]/proposta/actions.ts`.
- **Simplicidade:** são até 15 usuários numa VPS modesta. Prefira a opção mais simples
  e leve. Não precisa de tempo real: atualizar ao mover e ao voltar para a aba basta.
- **Regras do repo:**
  - branch e PR, nunca push na `main`;
  - commits no padrão conventional e texto do PR em português;
  - o merge acontece depois de revisão adversarial;
  - não commitar `.vitest/json/output.json`.
- **Testes:** os de integração (`*.int.test.ts`) rodam em schema de teste isolado, nunca
  no banco `ijcrm` de desenvolvimento, e duas suítes não podem rodar juntas no mesmo
  schema. Ver a seção "Testes" do `README.md`.

## 7. Critérios de aceite

- [ ] Pessoa de projetos cria, edita, exclui e arrasta task, e a ordem persiste ao
      recarregar.
- [ ] O quadro separa por responsável e tem a linha "Sem responsável". O agrupamento
      pode ser trocado.
- [ ] Visão de lista com edição direta, e a escolha de visão persiste por pessoa.
- [ ] Filtros funcionam, ficam na URL e sobrevivem a recarregar a página.
- [ ] Duas criações simultâneas no mesmo projeto geram números diferentes (teste de
      integração).
- [ ] Subtask tem um nível só, e excluir a pai leva as subtasks.
- [ ] Comentários e mudanças de task aparecem no histórico da própria task.
- [ ] Atribuir task a outra pessoa gera aviso no sino dela. Atribuir a si mesmo não gera.
- [ ] Atalhos funcionam e não disparam enquanto se digita.
- [ ] Teste de integração: VENDEDOR, GESTOR de Vendas, GESTOR sem área e VISUALIZADOR
      são recusados em cada action; PROJETOS, GESTOR de Projetos e ADMIN passam.
- [ ] A rota responde recusa para quem não tem acesso, e o link não aparece para essa
      pessoa.
- [ ] Teste: criar, mover, comentar e excluir task não gera nenhuma linha em `Timeline`.
- [ ] Action com id de task de outro projeto é recusada.
- [ ] Tasks não aparecem no quadro de Projetos, na Tabela, no Painel, na Minha Semana
      nem no Calendário.
- [ ] Card fora do quadro de Projetos responde 404 na rota de tasks, e as tasks voltam
      quando o card retorna.
- [ ] Task excluída some do quadro. Apagar o projeto de vez apaga as tasks.
- [ ] Desativar um usuário não quebra o quadro: as tasks dele continuam visíveis e
      podem ser reatribuídas.
- [ ] CI verde, sem dependência nova.

## 8. A cargo de quem constrói

- Layout e acabamento, seguindo o visual atual do projeto.
- Nome de arquivos e organização do serviço (sugestão: `src/lib/tarefas/`).
- Estratégia de ordenação (`posicao`) e como tratar duas pessoas movendo ao mesmo
  tempo. A última gravação pode vencer.
