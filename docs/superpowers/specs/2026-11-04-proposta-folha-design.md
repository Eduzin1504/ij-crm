# Proposta como folha: editor no modelo da IJ, comentários de revisão e elementos

Data: 2026-11-04. Status: aprovado em conversa com o Gabriel. Pontos com
**[escolha do autor]** foram definidos na escrita, sem validação dele.

Referências:

- Modelo visual: `IJ/proposta/Proposta_Comercial_Vertice.pdf` e `.docx` (fora do repo).
- Mockup aprovado: `.superpowers/brainstorm/38320-1793814761/content/proposta-modelo-ij.html`
  (local, não versionado). A descrição abaixo vale por si.

## 1. Por quê

A tela de proposta é um editor escuro com formulários empilhados e não mostra o que o
cliente vai receber. O time quer escrever na própria folha, com a cara do PDF, e revisar
como se revisa um PR. As propostas reais da IJ também usam tabelas livres, comparações e
números de destaque, que o editor de hoje não aceita.

Sucesso: quem tem a caneta escreve na folha e o PDF sai igual ao modelo da IJ, sem refazer
no Word. Quem revisa comenta ao lado da linha e propõe texto que se aplica com um clique.

## 2. Objetivos, não-objetivos, anti-objetivos

**Objetivos**

1. Tela em três colunas: comentários na margem, folha no centro, ações e infos à direita.
2. Folha e PDF no modelo da IJ.
3. Comentários no estilo de revisão do GitHub e do GitLab.
4. Tabelas, gráficos e elementos criados dentro da folha, e saindo no PDF.

**Não-objetivos**

- Geração de contrato (GAB-92 aguarda o modelo).
- Edição simultânea: a caneta continua sendo de uma pessoa só.
- Modelos diferentes de proposta por cliente ou tipo de projeto.
- Exportar para Word.

**Anti-objetivos** (seria falha mesmo funcionando)

- A folha prometer um resultado que o PDF não entrega.
- Quebrar autosave, caneta, pingue-pongue, versões, diff, OCR, MCP ou as regras de acesso.
- Propostas e versões já existentes deixarem de abrir ou de gerar PDF.
- Biblioteca pesada: são até 15 usuários numa VPS modesta.

## 3. Tela

Grade de três colunas ao lado do rail e abaixo da topbar atuais. As colunas encolhem com a
janela e nunca cortam conteúdo nem criam rolagem horizontal na página.

- **Cabeçalho:** voltar ao projeto, rótulo, título e selo de status (`StatusPropostaBadge`).
- **Margem esquerda:** contador ("2 abertos · 1 resolvido"), setas de anterior e próximo, e
  um cartão por conversa, na altura da linha comentada, ligado a ela por um fio tracejado.
  Se dois cartões colidirem, o de baixo desce.
- **Centro:** barra de formatação fixa acima da folha, com "Salvo há N s", e a folha.
- **Direita:**
  - ações: "Passar a caneta" como principal, "Salvar versão" e "Ver PDF". As demais ações
    da caneta e do envio aparecem conforme `acoesPossiveis` e `acoesDeEnvio`;
  - Proposta: com a caneta, lado, responsável, empresa, data de criação;
  - Dados da proposta (seção 5);
  - Para enviar ao cliente: comentários abertos, concordância, versão salva;
  - Versões com "comparar", e Tempo com a caneta.
- **Abaixo de 1024 px [escolha do autor]:** a folha ocupa a largura, e comentários e infos
  abrem em painel (`Sheet`, já existente).
- **Quem não tem a caneta** vê a mesma tela em leitura, sem barra de formatação, e pode
  comentar. Os dados estruturados também ficam só leitura.
- **Tema:** a tela segue os tokens de `globals.css` e o §4.5.1 da spec original (Inter,
  JetBrains Mono em rótulos e datas, coral só na ação principal, cor funcional só em ponto e
  borda). A folha é a única exceção clara, com tokens próprios (`--papel-*`).

## 4. Modelo visual da folha e do PDF

Vale igual para a folha e para o PDF, seguindo a proposta Vértice:

- **Capa:** fundo da capa do modelo, com moldura e rede vermelha. Em Poppins Bold à direita:
  "PROPOSTA COMERCIAL" e o nome da empresa. Abaixo, cidade e data, e o endereço da IJ.
- **Páginas seguintes:** faixa preta no topo com o logo e a rede vermelha, e a rede vermelha
  no rodapé esquerdo.
- **Texto:** Arial justificado com recuo de primeira linha. Título "Proposta Comercial de
  Projeto" centralizado. Títulos pretos e em negrito: **o vermelho fica só nos desenhos.**
- **Tabela:** cabeçalho `#1F1F1F` com texto branco, bordas pretas, linha de total `#F3E3E3`.
- **Formato:** A4, como o gerador atual (a Vértice é Carta).

**Fontes [escolha do autor]:** Arial não pode ser embutida, então usar **Arimo** (mesmas
métricas e licença aberta) e **Poppins**, nos dois lados. Nada de biblioteca nova: `pdf-lib`
e `fontkit` já estão no projeto. Atualizar a checagem de fontes do `build.yml` e o
`outputFileTracingIncludes`.

**Imagens:** extrair de `Proposta_Comercial_Vertice.docx` (`word/media/image1.png` capa,
`image2.png` topo, `image3.png` rodapé) para o repo, com versões otimizadas. Se o nome da
Vértice estiver gravado em alguma imagem, avisar.

**Template:** substitui `TEMPLATE_PROVISORIO` em `src/lib/pdf/templates`.

**PDF de versão antiga [escolha do autor]:** o PDF é gerado sob demanda, então versões
antigas passam a sair no modelo novo. O conteúdo continua sendo o da versão.

**Quebra de página:** a folha é contínua na edição. A marca "fim da página N" precisa ser
verdadeira: deve vir do mesmo cálculo do gerador, por bloco. Se isso não for viável sem
custo alto, não mostrar a marca. "Ver PDF" é a fonte da verdade.

## 5. Dados da proposta

Decisões do Gabriel, a partir das propostas reais da IJ:

**Cartão "Dados da proposta" no painel à direita.** Traz valor total, prazo em dias corridos,
escopo resumido e cronograma de entregas com "+ Adicionar entrega", como no formulário de
hoje, abaixo de "Proposta". Sai do corpo da tela. Só quem tem a caneta edita; os demais leem.
Salva sozinho pela mesma `revisao` do rascunho, sem o botão "Salvar dados" **[escolha do
autor]**.

**Blocos móveis na folha.** "Cronograma" e "Investimento" são blocos opcionais, um de cada, que
mostram esses dados na folha e no PDF. Quem tem a caneta os posiciona onde quiser no texto,
como na Vértice, em que o cronograma fica no meio. Tirar um bloco da folha não apaga os dados,
que continuam no cartão, e ele deixa de sair no PDF. Proposta antiga, que não tem bloco
posicionado, mostra os dois no fim **[escolha do autor]**. O bloco não é editado na folha: quem
edita usa o cartão. O escopo resumido é só dado do sistema e não vira bloco **[escolha do
autor]**: o escopo do cliente é o texto da proposta.

**Opção recomendada.** O sistema guarda só uma opção: `valor` e `entregas` são os da opção
recomendada, e é isso que alimenta a regra de §4.4 da spec da fase 2, o contrato e a execução
(GAB-95). Essas regras não mudam. As outras opções e a comparação ficam em tabelas livres.

**Duração na entrega.** A entrega aceita duração ("2 semanas") além da data, como na Vértice.
Na execução, a data prevista é calculada a partir do início. A entrega passa a ter data ou
duração: ajustar `estruturado.ts`, o `Entrega` gravado, o PDF e a cópia do cronograma do GAB-95,
sem invalidar entregas antigas, que têm data.

## 6. Comentários de revisão

Partem de GAB-91 (`src/lib/propostas/comentarios.ts`, `ancora.ts`), mantendo o polling, o
aviso e as permissões do GAB-98.

- **Botão + ao lado da linha** ao passar o mouse, no bloco inteiro. Selecionar um trecho
  mostra "Comentar" e "Sugerir" num balão flutuante.
- **Sugestão aplicável:** quem revisa propõe o texto novo do trecho, exibido como diff no
  cartão. Só quem tem a caneta aplica, e isso entra no rascunho pelo autosave, resolve a
  conversa e registra quem aplicou. Se o trecho mudou, a sugestão fica desatualizada e não
  se aplica.
- **Resolver e recolher:** resolvida vira uma linha fina que pode ser reaberta.
- **Contador e próximo:** contador de abertos e navegação que rola até a linha.
- **Desatualizado:** trecho que não está mais no texto ganha a marca e mostra o texto antigo
  (hoje `trecho_alterado`).
- **Revisão em lote:** o comentário pode ser "Adicionar à revisão", fica pendente e só o autor
  vê, até "Enviar revisão (N)", que publica tudo e gera um único aviso. "Comentar agora"
  continua existindo. Pendente não conta como aberto. Isso também resolve o excesso de avisos
  de comentários.
- **MCP:** criar sugestão e enviar revisão, com o mesmo serviço da tela.
- **Dados estruturados [escolha do autor]:** aceitam comentário ancorado ao campo, sem
  sugestão aplicável, porque um clique alteraria valor ou prazo e dispararia a regra de §4.4.
  A âncora precisa cobrir esses campos, para o comentário não nascer desatualizado.

## 7. Tabelas, gráficos e elementos

Todo elemento novo é nó do documento, e a proposta é guardada em Markdown canônico
(`markdown.ts`). Cada nó precisa funcionar, com teste, em todos estes pontos:

`documento.ts` (validação) · `markdown.ts` (ida e volta sem perda) · editor · `pdf.ts` e
gerador · `diff.ts` · `ancora.ts` (comentar) · `preenchimento` (OCR) e MCP.

Documento antigo continua válido, sem migração de conteúdo.

**OCR [escolha do autor]:** os nós novos só precisam passar pela canonização sem quebrar. O
preenchimento a partir de arquivo não extrai tabelas, gráficos nem imagens nesta entrega, e o
prompt `proposta-arquivo.v1` não muda.

- **Tabela:** criar, adicionar e remover linha e coluna, marcar linha de total. Só texto com
  negrito e itálico nas células, sem mesclar. Markdown no formato de tabela padrão, com a
  marca de total definida pelo construtor.
- **Gráfico:** barra, linha e pizza. Preenchido numa tabelinha de dados (rótulos e valores,
  com limites de quantidade), com título. Um único cálculo de desenho, puro, alimenta o SVG
  da tela e o vetor do PDF. Nada de biblioteca de gráficos. Cores derivadas do vermelho da
  marca e de cinzas. Guardado como bloco delimitado no Markdown.
- **Elementos [escolha do autor]**, porque o Gabriel aprovou sem listar outros:
  - **Imagem:** PNG, JPEG ou WebP com limite de tamanho, usando `src/lib/anexos` e os
    cuidados de tipo real. Só quem vê a proposta a lê. O GAB-98 define esse acesso.
  - **Caixa de destaque:** bloco de texto com fundo `#F3E3E3`, como "Obs:" da Vértice.
  - **Cartão com número:** rótulo e valor em destaque, de um a três lado a lado.

  Inserir por um botão "+" na barra de formatação.

## 8. Ordem de entrega

Um ticket e um PR por etapa, cada uma com revisão adversarial. Começa depois do merge do
GAB-98 (PR #68), que muda as mesmas páginas.

1. **Folha e tela nova:** layout, modelo visual, PDF, dados estruturados na folha.
2. **Comentários de revisão:** margem, +, sugestão, recolher, próximo, lote.
3. **Tabelas.**
4. **Gráficos e elementos.**

## 9. Critérios de aceite gerais

- [ ] Fluxo completo de ponta a ponta sem regressão: criar, editar, passar, devolver,
      concordar, enviar, aceitar, contrato assinado. Provado com testes e **em navegador real**.
- [ ] PDF gerado confere com o modelo: capa, faixa, rodapé, tabela, em mais de uma página.
- [ ] Proposta antiga abre, edita e gera PDF.
- [ ] Sem rolagem horizontal da página em 1280 px, e usável em celular.
- [ ] Mesma operação pela tela e pelo MCP, com as regras de acesso do GAB-98.
- [ ] Sem dependência pesada. Extensões de tabela do Tiptap são aceitáveis, com a versão
      alinhada à 3.32 do projeto.

## 10. A cargo de quem constrói

- Detalhes de layout, animação e atalhos, seguindo o mockup.
- Modelo de dados de sugestão e revisão pendente, desde que a migration não apague nada.
- Formato exato no Markdown dos nós novos.
- Limites numéricos dos elementos.
