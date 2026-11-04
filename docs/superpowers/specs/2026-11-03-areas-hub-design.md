# Áreas e gaveta da IJ: interface separada por área

Data: 2026-11-03. Status: aprovado pelo Gabriel em 2026-11-04.

## 1. Por quê

Hoje o menu lateral mistura tudo: Vendas, Projetos, Propostas, Tabela, Ranking,
Painel, Gestão… todo mundo vê tudo. A IJ trabalha por áreas (Vendas, Projetos e,
no futuro, Adm-Fin, Marketing e outras), e cada pessoa passa o dia na própria
área. O CRM deve refletir isso:

- cada pessoa entra direto na **sua área**, com um menu só dela;
- trocar de área (ou ir ao que é geral) é um gesto explícito: clicar no ícone da
  IJ abre uma **gaveta (hub)**;
- algumas coisas de uma área só aparecem para quem é daquela área.

Sucesso: um vendedor abre o CRM e só vê o que é de vendas e o que é comum; um
membro de projetos idem; gestor vê tudo da sua área e o que é de gestor; admin vê
tudo. Ninguém se perde num menu de 11 itens.

## 2. Contexto do produto (não é tela)

O fluxo de um projeto na IJ passa por várias áreas, nesta ordem (referência para
este e os próximos tickets, **não vira tela agora**):

| Etapa | Área dona | O que acontece |
|---|---|---|
| 1 | Vendas | 1º contato, RD, RI, 1ª proposta |
| 2 | Projetos + Vendas | revisões e reunião de proposta, negociação |
| 3 | Adm-Fin | fazer contrato |
| 4 | Projetos | revisar/aprovar contrato |
| 5 | Projetos + Vendas | handoff e kickoff |
| 6 | Projetos (+ Adm-Fin: pagamentos) | desenvolvimento |
| 7 | Vendas (+ Marketing: posts) | upsell, feedback, indicações, NPS |

Ideia de longo prazo: travar a passagem de etapa até um checklist estar completo
e autorizado pelas áreas envolvidas. A trava de "Montando contrato" (GAB-89) é o
primeiro caso. Adm-Fin e Marketing ficam para depois.

Roadmap por área (o menu cresce com ele; nada aparece antes de existir):

- **Vendas:** CRM ✓, Banco de leads ✓, Conteúdos (Carol), repositório de
  propostas/contratos/apresentações, NPS.
- **Projetos:** Kanban estilo Linear, Kanban geral, trilhas de conteúdo por
  projeto, gestão de membros ↔ projetos.

## 3. Objetivos, não-objetivos, anti-objetivos

**Objetivos (este projeto)**

1. Gaveta da IJ (hub) aberta pelo ícone da IJ.
2. Menu lateral por área.
3. Entrada direto na área da pessoa.
4. Regras de visibilidade por papel × área aplicadas às telas que já existem
   (menu **e** servidor: esconder do menu não basta, a URL direta também barra).
5. Propostas: cada um vê só as em que está escalado (gestor vê as da área).
6. Calendário: cada um vê o seu e o que foi atribuído a ele.

**Não-objetivos (tickets separados, depois)**

- Grupos de eventos no calendário.
- Escala de membros em projetos ("Gestão de membros ↔ projetos").
- Pipeline geral como tela; travas por checklist entre áreas.
- Áreas Adm-Fin e Marketing; itens novos do roadmap.

**Anti-objetivos (seria falha mesmo funcionando)**

- O hub abrir sozinho ou virar uma página inicial obrigatória.
- Esconder só no menu e deixar a rota/ação/MCP vazar o dado.
- Quebrar o fluxo atual de proposta/caneta (o lado de projetos ainda precisa
  abrir a proposta do card em que atua).
- Itens "em breve" ou vazios no menu.

## 4. Decisões

### 4.1 Gaveta da IJ

- O ícone da IJ (topo do rail; no mobile, o da topbar) **não navega mais**: abre
  uma gaveta ao lado do rail. Fecha com clique fora, Esc ou ao escolher um item.
- Conteúdo da gaveta:
  - **Áreas:** Vendas e Projetos (as que existem no enum `Area`), destacando a da
    pessoa. Cada uma leva à página inicial daquela área.
  - **Geral:** Painel, Gestão (só GESTOR/ADMIN), Meu perfil.
- Nunca abre automaticamente.

### 4.2 Menu lateral por área

A área "atual" é a da página aberta (rota), não a da pessoa: quem visita Projetos
vê o menu de Projetos (filtrado pelas regras de 4.4).

| Área | Itens |
|---|---|
| Vendas | Minha Semana, Kanban de vendas, Propostas, Tabela, Ranking |
| Projetos | Minha Semana, Kanban de projetos |
| Compartilhado (em toda área) | Contatos, Empresas, Calendário |
| Geral (só na gaveta) | Painel, Gestão, Meu perfil |

Itens futuros do roadmap entram nessas listas quando forem construídos.

### 4.3 Entrada no sistema (`/` e pós-login)

- Membro (VENDEDOR / PROJETOS) e GESTOR com área: página inicial da própria área.
- ADMIN, GESTOR sem área e VISUALIZADOR: área de entrada **definida por quem
  criou o usuário**, na tela de Gestão de usuários (Vendas, Projetos ou Geral).
  Geral = Painel.
- A preferência atual "página inicial" (Meu perfil, GAB-43) continua valendo
  **dentro** da área (ex.: Minha Semana ou Kanban); usuários existentes sem
  configuração caem na área deles.

### 4.4 Visibilidade

| Papel | Na própria área | Em outra área |
|---|---|---|
| Membro | tudo; edita conforme a caneta | só o que é aberto a todos, leitura |
| Gestor | tudo da área + o que é de gestor | só o que é aberto a todos, leitura |
| Admin | tudo, todas as áreas | tudo |

O que é "aberto a todos" em cada área (visto por quem é de fora):

| Item | Fora da área |
|---|---|
| Kanban de vendas | vê, só leitura (projetos acompanha o que vai virar projeto) |
| Kanban de projetos | vê, só leitura |
| Propostas | ver 4.5 |
| Tabela, Ranking (vendas) | escondido |
| Minha Semana da área | escondido |
| Contatos, Empresas, Painel | todos |

**Card de outra área** (decisão do Gabriel): quem é de fora pode comentar, criar
prazo e anexar. Mover de fase e editar os dados do card ficam só para a área dona.
A proposta segue a caneta, como hoje.

Esta seção substitui o trecho "Sem visão restrita por área" do §4.12 da spec da
fase 2 (`2026-10-30-fase2-projetos-design.md`).

O kanban interno de cada projeto (só o time de projetos vê) tem spec própria:
`2026-11-04-kanban-interno-projeto-design.md`.

### 4.5 Propostas

- Cada pessoa vê a **parte interna da sua área** e só as propostas em que está
  **escalada**.
- Até existir a escala de membros, "escalado" = responsável pelo card **ou**
  dono/ex-dono da caneta daquela proposta (ou GP do lado, que já age na caneta).
- GESTOR vê todas as propostas da sua área. ADMIN vê todas.

### 4.6 Calendário

- Cada um vê só a própria agenda e o que foi atribuído a ele. Some a opção de ver
  "o time" ou outra pessoa para membros.
- Gestor: vê a agenda das pessoas da sua área. Admin: todos.

### 4.7 Decisões tomadas na escrita (sem validação do Gabriel; podem ser questionadas)

- **Área atual:** as URLs não mudam. `/kanban` usa o quadro; `/projetos/[id]` usa o
  quadro do card (`MarcarQuadroAtivo`). Rotas sem área (Contatos, Empresas, Calendário,
  Painel, Perfil, Gestão) mantêm a última área aberta, guardada em cookie; sem cookie,
  vale a área da pessoa. **Ao abrir `/`, a entrada (4.3) prevalece sobre a última área:**
  o redirect indica a área ao destino (`/semana?area=PROJETOS`, para quem é das duas áreas),
  e o menu e o cookie passam a segui-la. O parâmetro é validado e só escolhe o menu; quem
  entra em Geral vai ao Painel e mantém a última área.
- **Minha Semana:** continua sendo uma rota só, pessoal. Aparece no menu da própria área
  (admin: nas duas), sem filtro novo.
- **"Parte interna" da proposta:** significa só que cada um vê as propostas da sua área
  ou em que está escalado. Sem seção privada nova; se fizer falta, vira outro ticket.
- **Propostas:** o item entra também no menu de Projetos, porque a proposta passa pelas
  duas áreas. Gestor com área e GP veem todas. Ex-dono da caneta continua vendo
  (histórico `PropostaCaneta`).
- **Área dona do card:** a do quadro em que ele está (`pipeline.chave`). O **responsável
  do card** edita e move mesmo fora da área, para não travar o vendedor que ainda
  responde pelo card depois do Ganho.
- **VISUALIZADOR:** é visitante em todas as áreas: lê os dois Kanbans, Contatos, Empresas
  e Painel; sem Tabela, Ranking, Propostas e Calendário.
- **GESTOR sem área:** vê como gestor das duas áreas, porque é o diretor de hoje e tirar
  o acesso seria regressão.
- **Área de entrada:** coluna nova e nula (`VENDAS | PROJETOS | GERAL`), usada por ADMIN,
  GESTOR sem área e VISUALIZADOR. Não reaproveita `usuario.area`, que dá lado na caneta.
  Sem valor: Geral. Gestor com área entra na área dele.
- **Preferência `inicio`:** vira "o que abrir dentro da área" (`semana | kanban`).
  Valores antigos `vendas` e `projetos` passam a significar `kanban`.
- **Calendário:** "pessoas da área" = mesmo `ladoDe` do gestor. "Atribuído" = é o
  responsável do prazo ou do card. Minha Semana não muda.
- **Automação (#crm no WhatsApp) e MCP:** o MCP segue as mesmas regras da tela. A
  automação pelo WhatsApp não é restringida por área neste passo.

## 5. O que fica para quem constrói

- Visual exato da gaveta (largura, animação), desde que siga o tema atual
  (rail 88 px, `bg-sidebar`, ativo em `primary-soft`).
- Como representar a área de entrada no banco (coluna nova ou dentro de
  `preferencias`), mantendo a coerência área × papel de `src/lib/auth/areas.ts`.
- Onde centralizar a regra "pode ver X nesta área" (sugestão: ao lado de
  `areas.ts`, pura, usada por menu, páginas, actions e MCP).
- Quebrar em tickets no Linear (projeto P-GAB-2), um PR por ticket.
