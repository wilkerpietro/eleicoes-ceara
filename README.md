# Eleições Ceará

Consulta de votação por **município**, **bairro**, **local de votação** e **seção eleitoral** nos 184 municípios do Ceará, a partir dos dados abertos do TSE. O projeto nasceu como "Eleições Paraipaba" e Paraipaba continua sendo o município padrão e o único com bairros geolocalizados.

Site publicado: **https://wilkerpietro.github.io/eleicoes-ceara/**

Site estático, sem dependências: HTML, CSS e JavaScript puro lendo os CSVs da pasta `data/` diretamente no navegador. Pode ser publicado no GitHub Pages sem nenhuma etapa de build.

## O que já funciona

- Barra lateral com as **eleições** (2022 gerais, 2024 municipais) como itens de menu; os **cargos** da eleição escolhida aparecem aninhados abaixo dela e podem ser recolhidos clicando de novo na eleição. Ao lado deles, no mesmo padrão, o item **Candidatos 2026**. Em seguida, o seletor de **município**. No celular a barra lateral fica escondida num botão "sanduíche" na barra do topo e abre como uma gaveta.
- Opção **"Todos os municípios (Ceará)"** no seletor: agregado estadual em que cada município funciona como um "bairro" (ranking do estado, votos de um candidato por município, clique no município abre a página dele). Disponível nas eleições em que os candidatos são os mesmos no estado inteiro (2022); em 2024 a opção fica desabilitada, porque os números dos candidatos se repetem entre municípios. O agregado é gerado por `scripts/agregar-estado.sh data/2022-1` (pasta `data/2022-1/todos/`) e ligado pela chave `agregado_estado` em `data/eleicoes.json`.
- Na tela Tabelas o ranking não tem cartões de resumo: eleitores aptos, comparecimento, abstenção, válidos, brancos, nulos e seções aparecem como uma linha discreta no rodapé da tabela.
- Filtros por **cargo**, **candidato** e **bairro** (quando o município tem bairros cadastrados), com busca por nome, número ou partido.
- **Modo ranking** (nenhum candidato selecionado): ranking dos candidatos do cargo no município ou em um bairro, com foto, cor do partido, votos e %, além de aptos, comparecimento, abstenção, válidos, brancos, nulos e votos de legenda.
- **Modo candidato**: cartão em destaque com foto, nome, total de votos, nome completo, partido e número; abaixo, os votos agrupados por bairro, local de votação ou seção, com % dos votos válidos no grupo, % do total do candidato, válidos e aptos.
- Foto oficial, nome completo, ocupação e situação (Eleito, Suplente, 2º turno) de cada candidato, a partir do cadastro do TSE (2022; 2024 quando o cadastro for adicionado).
- Navegação por clique (candidato abre a distribuição, bairro abre as seções), trilha de localização e estado na URL (`#e=2022-1&m=15997&cargo=...&cand=...&bairro=...`) para compartilhar consultas.

## Mapa dos votos

- Tela **Mapa dos votos** (município): em cada bairro, um mini gráfico de barras com os 3 mais votados (foto no topo da barra, quantidade de votos e barra na cor do partido, altura relativa ao 1º do bairro); com candidato selecionado, uma barra só com os votos dele. Clicar no bairro destaca o quadro e o painel lateral mostra a lista dos mais votados naquele bairro (5 e "Ver todos"; sem pizza) e, abaixo da lista, o rodapé com os totais (aptos, comparecimento, válidos, brancos, nulos, seções) e os links "Ver seções" e "Limpar seleção"; sem seleção, o painel traz o município inteiro.
- Tela **Mapa dos votos** (Todos os municípios): mapa coroplético do Ceará com o contorno dos 184 municípios (`data/ceara-municipios.geojson`, malha do IBGE em qualidade mínima, com código TSE e nome de cada município). No ranking, cada município recebe a cor do partido do candidato mais votado e a legenda conta quantos municípios cada partido venceu; com candidato selecionado, a intensidade da cor é a fatia dele nos votos válidos. Passar o mouse mostra os 3 mais votados; clicar abre o município. Os totais (aptos, comparecimento, abstenção, válidos, brancos, nulos, seções) aparecem em texto pequeno abaixo da legenda, sem cartões.
- As coordenadas ficam em `data/bairros.json`, por código TSE do município; a chave `todos` traz a sede dos 184 municípios do Ceará (latitude e longitude do IBGE, via o repositório aberto [kelvins/municipios-brasileiros](https://github.com/kelvins/municipios-brasileiros)), usadas no mapa do agregado estadual. Hoje só Paraipaba tem bairros com coordenadas (planilha em `data/raw/`). Para os demais municípios, os dados abertos do TSE não trazem o bairro dos locais de votação, então a tela informa isso e as tabelas usam local de votação e seção.
- O mapa usa [Leaflet](https://leafletjs.com/) (CDN) com o mapa base do [OpenStreetMap](https://www.openstreetmap.org/copyright).

## Eleições 2026 (mapeamento político municipal)

Seção **Eleições 2026** no menu, com três telas, sempre para o município escolhido na barra lateral:

- **Lideranças**: cada candidato de 2024 entra uma única vez por município (a importação lê a nuvem antes de decidir, roda uma por vez, e o banco tem índice único em município + sequencial do TSE; cópias antigas são unificadas ao abrir a tela, sem alterar os apoios a deputados). Lideranças cadastradas manualmente têm o campo **Reduto** (bairros ou localidades onde têm força, com sugestão dos bairros do município), mostrado na lista no lugar dos 3 bairros de maior votação das importadas. lista enxuta com foto, nome, votos em 2024 com os três bairros de maior votação (para quem foi candidato a vereador) e a expectativa de votos em 2026. Todos os candidatos a vereador e a prefeito de 2024 do município entram automaticamente, e é possível incluir lideranças manualmente. "Detalhes" abre um popup com a ficha completa (para quem trabalhou em 2022 para Deputado Estadual e Federal, quem apoiou em 2024 para Prefeito e Vereador, para quem vai trabalhar em 2026 como Deputado Federal e Estadual com a estimativa, observações), o botão Editar e, para quem foi candidato em 2024, "Ver detalhamento dos votos", que abre a tela Tabelas nas Eleições 2024 com o candidato filtrado.
- **Estimativa**: abas Deputado Federal e Deputado Estadual com a soma do que as lideranças do município devem dar a cada candidato de 2026. O botão "Detalhar" de cada candidato (que vira "Ocultar") expande a relação das lideranças que o apoiam, com votos de 2024, estimativa editável, ficha e remoção, além da inclusão de novas lideranças (a estimativa sugerida é a expectativa da liderança) e o total no município. Uma liderança pode apoiar até dois candidatos por cargo (Federal ou Estadual): ao incluir o segundo, seja no grupo ou na ficha, o sistema sempre avisa que ela já apoia o primeiro e pede confirmação; um terceiro é recusado. A expectativa da liderança passa a ser a soma dos apoios do cargo.
- **Mapa estimativo**: para um candidato a Deputado Federal ou Estadual com lideranças no município, mostra no mapa quantos votos devem sair de cada bairro. A estimativa de cada liderança é distribuída na proporção dos votos dela em 2024 (600 votos em 2024 e estimativa 300: um bairro em que teve 30 votos recebe 15); lideranças manuais dividem a estimativa igualmente entre os bairros do campo Reduto; sem base, o valor fica em "Sem bairro definido". A lista ao lado traz os bairros em ordem e, ao clicar, as lideranças que transferem votos ali, com os votos de 2024 delas no bairro.
- **Candidatos 2026**: todos os candidatos a Presidente, Governador, Senador, Deputado Federal e Deputado Estadual do Ceará registrados no TSE para 2026, com foto oficial, número, partido e ocupação (`data/2026-1/candidatos.csv` e `data/2026-1/fotos/`, gerados a partir de `consulta_cand_2026.zip` e dos pacotes `foto_cand2026_CE_div.zip` / `foto_cand2026_BR_div.zip`; registro de candidaturas ainda em análise pelo TSE). Nos campos "trabalhará em 2026 para", a liderança é ligada a um desses candidatos por lista de sugestão; candidatos fora da lista podem ser cadastrados manualmente. A aba lista os candidatos manuais e aponta duplicidades com o cadastro do TSE (mesmo nome), com o botão "Substituir pelo TSE", que migra as lideranças ligadas e apaga o registro manual.
- **Onde ficam os dados**: num banco na nuvem ([Supabase](https://supabase.com), projeto `eleicoes-ceara`), configurado em `data/config.json` (URL do projeto e chave pública). O acesso ao mapeamento é restrito: qualquer pessoa pode **criar conta** (nome, e-mail e senha, sem confirmação por e-mail), mas só lê e edita depois que um **administrador autoriza** o cadastro na tela **Usuários** (item de menu visível só para administradores). Quem ainda não foi autorizado vê "Cadastro recebido, aguardando autorização". Também há login por link enviado ao e-mail (para quem esqueceu a senha) e "Trocar senha". As tabelas, o gatilho que cria o perfil de cada conta e as regras de acesso (`eh_aprovado()`, `eh_admin()`) estão em `scripts/supabase.sql`; o primeiro administrador é definido no fim desse script, e outros podem ser promovidos mudando o campo `papel` para `admin` na tabela `perfis`. Cada alteração é gravada na hora, linha a linha; as lideranças de um município são carregadas quando ele é aberto, e os candidatos a vereador e prefeito de 2024 são importados na primeira abertura por um usuário conectado.
- **Banco sempre ativo**: no plano gratuito o Supabase pausa o projeto após ~7 dias sem uso (o login passa a mostrar "Sem conexão com o banco de dados"). A tarefa `.github/workflows/manter-supabase-ativo.yml` consulta o banco a cada 3 dias com a chave pública de `data/config.json`, e também pode ser disparada na aba **Actions** do GitHub ("Run workflow"). Se o projeto já estiver pausado, a tarefa falha e o GitHub avisa por e-mail; aí é preciso reativar no painel do Supabase (projeto `eleicoes-ceara` → Restore project). O GitHub desliga tarefas agendadas de repositórios sem nenhum commit por 60 dias; nesse caso, reative a tarefa na aba Actions.
- **Sem o banco configurado** (url e anonKey vazios em `data/config.json`), o site volta a salvar no navegador (`localStorage`), com **Exportar**/**Importar** em JSON no rodapé da tela Lideranças e `data/liderancas.json` como base inicial.

## Apuração paralela 2026 (Paraipaba e Paracuru)

Tela **Apuração paralela**, primeiro item de **Eleições 2026** no menu (link direto: `#tela=apuracao`). A equipe recebe as fotos dos boletins de urna e lança seção por seção; a tela soma tudo na hora.

- **No topo**: votos apurados (comparecimento das seções lançadas), seções apuradas (ex.: `2/208`, com barra de progresso) e três listas, do mais votado para o menos votado: **Governador** (Elmano e Ciro), **Deputado Federal** e **Deputado Estadual**. Nas de deputado aparecem os 3 mais votados (com a posição) e os da nossa chapa que estiverem abaixo deles; "Ver mais" mostra todos e "Ver menos" recolhe. Abas para ver os dois municípios juntos ou cada um.
- **Controle de envio** (só para quem está logado e autorizado): um cartão por pessoa que manda os boletins de uma área (Men, Manu, Bobó, Leandro, Rafael, Veridianny, Patrícia e Roberta, em Paraipaba), com seções lançadas/total, barra de progresso e cor por situação (verde completo, laranja em andamento, vermelho nada enviado). Tocar no cartão abre as áreas com o número de cada seção: as lançadas aparecem com ✓ e as que faltam são botões que abrem o formulário já naquela seção. "Copiar o que falta" copia um texto pronto para cobrar no WhatsApp ("Leandro, faltam 6 boletins: Segunda Etapa (seções 165, 166, 167, 168 e 213) e São Miguel (seção 155)."). A divisão fica em `responsaveis`, no `data/apuracao.json`: cada área é um bairro (nome igual ao da lista) ou um trecho do nome do local de votação; seção que não cair em ninguém aparece como "Sem responsável".
- **Por bairro**: uma linha por bairro com seções apuradas (`1/5`), votos apurados e o percentual de cada candidato (ex.: Lagoinha — Elmano 51,1%, Ciro 38,3%, Yury do Paredão 17,8%, Carlos Júnior 13,3%, Daniel Oliveira 8,9%). Na disputa com adversário (Elmano x Ciro), a célula de quem lidera fica verde (nosso) ou vermelha (adversário). Clicar no bairro abre as seções dele, com os números de cada boletim. No celular, cada bairro vira um cartão com um candidato por linha.
- **Percentual** = votos do candidato ÷ votos válidos do cargo na área, e válidos = comparecimento − brancos − nulos (no proporcional, os válidos incluem a legenda).
- **Lançar boletim** (só usuários autorizados, mesma conta do mapeamento de lideranças): município, seção escolhida num menu no formato "Seção 196 - Cacimbão dos Tabosas - José Braga de Paiva" (as já lançadas aparecem com "✓ lançada"; a última opção, "Outra seção", serve para seção fora da lista), comparecimento e, por cargo, os votos dos candidatos do `data/apuracao.json`, brancos e nulos (obrigatórios), na ordem em que aparecem no boletim (Deputado Federal, Deputado Estadual, Governador). Nos deputados entram também, como campos opcionais (em branco vale 0), os candidatos apoiados por lideranças de Paraipaba e Paracuru (tela Estimativa) e os que já aparecem em boletins. Como só a equipe lê as lideranças, o boletim grava esses candidatos com 0 quando ficam em branco: assim quem só olha a apuração também os vê nas listas (candidato cadastrado à mão entra se tiver número, e o nome vai junto no boletim). Enter passa para o próximo campo. O site confere ao vivo e recusa somas maiores que o comparecimento, e pede confirmação se o comparecimento passar muito do eleitorado de 2024. Lançar de novo uma seção já lançada mostra os números dela e substitui; também dá para apagar o boletim.
- **Seções**: a lista vem de `data/2026-1/<município>/secoes.csv` (lista do TRE-CE de 03/10/2026: 93 seções em Paraipaba e 115 em Paracuru, 208 no total); sem esse arquivo, vale a de `data/2024-1/`. Os arquivos do TRE estão em `data/raw/tre-ce-eleicoes-2026-secoes-por-municipio-1t_localidade-*`; o de Paraipaba veio em .xlsx com os acentos trocados (texto UTF-8 lido como Windows-1252) e foi convertido para CSV com os acentos corrigidos antes de passar pelo script. Correções por cima da lista ficam em `ajustes_secoes`, no `data/apuracao.json`, e continuam valendo se a lista for gerada de novo: a EMEIF Altina Laranjeira (Centro) está em obras, e as seções 122 a 130 votam provisoriamente na EMTI Humberto Vieira Pessoa, que aparece como "Humberto Vieira Pessoa (Altina)" e conta para o Centro (as seções 105 e 106, da mesma escola, continuam em Boa Esperança). Seção nova, fora da lista: escolha "Outra seção" no menu, digite o número e informe o bairro (ou use "Só incluir a seção, sem boletim" para ela já entrar na contagem). Seção que não existe mais: abra o bairro e marque **Sem urna**, para sair da contagem (dá para desfazer). Para usar a lista oficial de 2026, baixe do TRE-CE a lista "Seções Eleitorais no Estado" e rode `bash scripts/secoes-apuracao.sh <arquivo.csv>`.
- **Candidatos acompanhados**: `data/apuracao.json` (cargo, número, nome curto e `chapa`: `true` para os nossos, `false` para adversários). Foto e partido vêm do cadastro do TSE de 2026. Os votos são gravados pelo número; trocar ou incluir candidatos não mexe nos boletins já lançados (candidato novo começa sem votos nas seções já lançadas).
- **Onde ficam os dados**: tabela `apuracao` no Supabase, um registro por seção. **Antes de usar, rode `scripts/supabase-apuracao.sql` no SQL Editor do Supabase** (uma vez; pode repetir). Qualquer pessoa com o link vê a apuração (o boletim de urna é público); só usuários aprovados lançam, corrigem ou apagam. Para deixar a leitura só para a equipe, há duas linhas comentadas no fim do script. O registro guarda o nome de quem lançou (não o e-mail), visível só para a equipe na tela; o horário vem do relógio do banco.
- **Atualização**: a tela relê os boletins a cada 20 segundos (e ao voltar para a aba), sem perder o que estiver sendo digitado no formulário.
- Se a biblioteca do Supabase não carregar (internet ruim, bloqueio), a tela mostra erro em vez de salvar no navegador. Sem banco configurado em `data/config.json`, os boletins ficam no navegador (`localStorage`), útil só para testar.

## Resultado oficial (TSE)

Tela **Resultado oficial (TSE)**, em **Eleições 2026** no menu (link direto: `#tela=tse`). Lê, direto do navegador, os arquivos públicos de divulgação de resultados do TSE (`resultados.tse.jus.br`) e se atualiza sozinha a cada 60 segundos (e no botão "Atualizar agora"). É pública, sem login.

- Atalhos para Paraipaba e Paracuru e um menu com os demais municípios do Ceará.
- Seções totalizadas, votos válidos para governador, comparecimento e as listas de Governador, Deputado Federal, Deputado Estadual, Senador e Presidente, do mais votado para o menos votado (deputados: 10 primeiros, mais os da nossa chapa que estiverem abaixo, e "Ver mais"). Os candidatos do `data/apuracao.json` aparecem em destaque.
- Como os arquivos são lidos (formato confirmado nos simulados oficiais de setembro/2026): o catálogo `oficial/comum/config/ele-c.jws` informa o ciclo (`ele2026`), o código da eleição estadual (Governador, Senador, Deputados) e o da federal (Presidente) e o modelo de diretório; o resultado do município fica em `<diretório>/ce<município>-c<cargo>-e<eleição>-u.jws` (cargo 0003 Governador, 0005 Senador, 0006 Dep. Federal, 0007 Dep. Estadual, 0001 Presidente). Os arquivos vêm como JWS (cabeçalho.conteúdo.assinatura); a tela usa o conteúdo, sem conferir a assinatura. As seções totalizadas vêm do próprio arquivo, se ele trouxer, ou do arquivo de acompanhamento da UF (`ce-e<eleição>-ab.jws`).
- Antes das 17h do dia da eleição os arquivos dos municípios ainda não existem, e a tela avisa "Ainda sem dados publicados". Endereço, ciclo, UF, atalhos e intervalo ficam em `data/tse.json`.
- O TSE limita a 100 requisições por segundo por endereço de internet; cada atualização desta tela faz 5 a 6 requisições.

## Como rodar localmente

Os dados são carregados via `fetch`, então a página precisa ser servida por HTTP (abrir o `index.html` direto do disco não funciona).

```bash
# Windows, sem Python/Node
powershell -ExecutionPolicy Bypass -File scripts/serve.ps1
```

```bash
# Python
python -m http.server 8080
```

Depois abra `http://localhost:8080`.

## Estrutura

```
index.html                 página única
css/style.css              estilos
js/csv.js                  leitor de CSV (separador ";")
js/app.js                  carga dos dados, agregações e renderização
js/apuracao.js             tela de apuração paralela 2026 (boletins de urna por seção)
js/tse.js                  tela do resultado oficial do TSE por município (arquivos públicos de divulgação)
scripts/serve.ps1          servidor HTTP de desenvolvimento (Windows)
scripts/build-municipios.sh  converte o "votacao_secao" do TSE em uma pasta por município
scripts/secoes-apuracao.sh   lista de seções de 2026 da apuração (a partir da lista do TRE-CE)
scripts/supabase-apuracao.sql  tabela e regras de acesso da apuração paralela
data/apuracao.json         municípios, lista de seções e candidatos acompanhados na apuração paralela
data/tse.json              endereço, ciclo, UF e atalhos da tela do resultado oficial do TSE
data/eleicoes.json         manifesto das eleições (pasta, lista de municípios, fotos)
data/cargos.json           código do cargo (CD_CARGO do TSE) -> nome
data/partidos.json         número do partido -> sigla, por ano
data/bairros.json          coordenadas dos bairros, por código de município (chave "todos" = sede dos municípios)
data/ceara-municipios.geojson  contorno dos 184 municípios do Ceará (IBGE) com código TSE e nome
data/<eleicao>/municipios.json          [{"cd","nome"}] dos municípios disponíveis
data/<eleicao>/<cd_municipio>/secoes.csv      seções do município
data/<eleicao>/<cd_municipio>/votos.csv       votos por seção
data/<eleicao>/<cd_municipio>/candidatos.csv  candidatos com votos no município
data/<eleicao>/fotos/<SQ_CANDIDATO>.jpg       fotos oficiais (TSE)
data/raw/                  arquivos originais de Paraipaba (TRE-CE/TSE, planilha de bairros)
```

### Formato dos dados (UTF-8, separador `;`)

`secoes.csv`:

```
zona;secao;cod_local;local;endereco;bairro;cep;aptos;agregadas
```

`bairro`, `cep`, `aptos` e `agregadas` podem ficar vazios. Sem bairro em nenhuma seção, a interface esconde o filtro de bairro; sem aptos, os cartões mostram "—" no lugar de aptos e abstenção.

`votos.csv` (compacto; nomes e partidos vêm de `candidatos.csv`, `cargos.json` e `partidos.json`):

```
zona;secao;cargo;numero;votos
```

`cargo` é o código do TSE (1 Presidente, 3 Governador, 5 Senador, 6 Deputado Federal, 7 Deputado Estadual, 11 Prefeito, 13 Vereador). Número 95 = brancos, 96 = nulos; número de 2 dígitos em cargo proporcional = voto de legenda do partido. Votos válidos = nominais + legenda.

`candidatos.csv` (cruzado com os votos por cargo + número):

```
cargo;numero;sq;nome;nome_urna;partido;situacao;genero;ocupacao;foto
```

Gerado a partir do "consulta_cand" do TSE, mantendo só campos públicos não sensíveis (sem CPF, e-mail, título ou data de nascimento) e só os candidatos com votos no município. Em caso de substituição de candidato (mesmo número), fica a candidatura APTA com situação de totalização definida. Sem cadastro (caso de 2024 por enquanto), o nome vem do próprio arquivo de votos e o partido é deduzido do número. A coluna `foto` aponta para `data/<eleicao>/fotos/<SQ_CANDIDATO>.jpg`, copiada dos pacotes `foto_cand<ano>_<UF>_div` do TSE.

### Como gerar os dados de uma eleição

1. Baixar em [dadosabertos.tse.jus.br](https://dadosabertos.tse.jus.br/) o "Resultados — votação por seção eleitoral" do ano e UF (`votacao_secao_<ano>_CE.zip`), o "Candidatos" (`consulta_cand_<ano>.zip`) e as fotos (`foto_cand<ano>_CE_div.zip`).
2. Converter o CSV de votação para UTF-8 sem aspas, por exemplo no Git Bash:

```bash
unzip -p votacao_secao_2022_CE.zip votacao_secao_2022_CE.csv | iconv -f ISO-8859-1 -t UTF-8 | tr -d '\r' | sed 's/"//g' > v2022.csv
```

3. Rodar o conversor (o cadastro e as pastas de fotos são opcionais):

```bash
bash scripts/build-municipios.sh 2022 v2022.csv data/2022-1 consulta_cand_2022_CE.csv fotocand2022ce
```

4. Adicionar a eleição em `data/eleicoes.json` (`pasta`, `municipios`, `fotos`, `ano`).

O script também aceita o formato do arquivo "votação por seção" baixado do portal de resultados do TSE para 2024 (`votacao_secao-uf_*_2024_ce.csv`), que traz aptos e comparecimento por seção.

### Seções, bairros e aptos (TRE-CE)

O TRE-CE publica a lista "Seções Eleitorais no Estado" (uma linha por seção, com local, endereço, bairro, CEP, aptos e seções agregadas). O script abaixo aplica essa lista às pastas geradas, preenchendo `secoes.csv` de todos os municípios:

```bash
bash scripts/aplicar-secoes-tre.sh data/raw/tre-ce-eleicoes-2022-secoes-no-estado-1t_estado-CE.csv data/2022-1
```

Seções que aparecem nos votos mas não na lista do TRE são mantidas como vieram do arquivo de votação.

### Fotos

As fotos oficiais são reduzidas a miniaturas de 96 px de largura (cerca de 3 KB cada) com `scripts/reduzir-fotos.ps1`, para manter o repositório leve:

```bash
powershell -ExecutionPolicy Bypass -File scripts/reduzir-fotos.ps1 -Pasta data/2024-1/fotos
```

### Observações sobre as bases atuais

- **2022**: Governador, Senador, Deputado Federal e Deputado Estadual vêm de `votacao_secao_2022_CE`; **Presidente** vem de `votacao_secao_2022_BR` filtrado para o Ceará e anexado com `ANEXAR=1`. Em Paraipaba, a soma de votos para Presidente difere em 1 voto do resultado por seção do TRE-CE usado na primeira versão.
- **2024**: Vereador vem do arquivo do portal de resultados (`votacao_secao-uf_prefeito_t1_2024_ce`, que apesar do nome só traz Vereador, mas inclui aptos por seção); **Prefeito** vem dos dados abertos (`votacao_secao_2024_CE`, layout "aberto"), anexado com `LAYOUT=aberto ANEXAR=1`. Cadastro e fotos de 2024: `consulta_cand_2024_CE` e `foto_cand2024_CE_div`.
- Só Paraipaba tem coordenadas de bairros; nos demais municípios a tela Mapa dos votos mostra, no lugar do mapa, uma grade de 3 colunas com o gráfico dos 3 mais votados de cada bairro (do maior para o menor bairro; clique abre os detalhes), e as tabelas funcionam normalmente por bairro, local e seção. No agregado "Todos os municípios" o mapa mostra um quadro por município (coordenadas da sede em `data/bairros.json`, chave `todos`).
- Em Paraipaba 2022, as seções 208 e 212 foram agregadas às seções 152 (Pedrinhas) e 162 (Camburão); os votos delas aparecem nas seções principais, conforme os boletins de urna.

## Roteiro

- [x] Etapa 1: consulta por candidato com votos por bairro e seção (Paraipaba, Eleições 2022).
- [x] Etapa 2: mapa interativo com a geolocalização de cada bairro (Leaflet).
- [x] Etapa 3: todos os municípios do Ceará nas Eleições 2022 (todos os cargos) e 2024 (Prefeito e Vereador), com seções e bairros do TRE-CE, cadastro e fotos do TSE.
- [ ] Coordenadas de bairros para outros municípios (mapa).
- [x] Publicado no GitHub Pages: https://wilkerpietro.github.io/eleicoes-ceara/ (repositório https://github.com/wilkerpietro/eleicoes-ceara).

## Fonte dos dados

Dados abertos do Tribunal Superior Eleitoral (TSE) e do Tribunal Regional Eleitoral do Ceará (TRE-CE).
