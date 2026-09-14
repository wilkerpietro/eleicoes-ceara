# Eleições Ceará

Consulta de votação por **município**, **bairro**, **local de votação** e **seção eleitoral** nos 184 municípios do Ceará, a partir dos dados abertos do TSE. O projeto nasceu como "Eleições Paraipaba" e Paraipaba continua sendo o município padrão e o único com bairros geolocalizados.

Site publicado: **https://wilkerpietro.github.io/eleicoes-ceara/**

Site estático, sem dependências: HTML, CSS e JavaScript puro lendo os CSVs da pasta `data/` diretamente no navegador. Pode ser publicado no GitHub Pages sem nenhuma etapa de build.

## O que já funciona

- Barra lateral com as **eleições** (2022 gerais, 2024 municipais) como itens de menu; os **cargos** da eleição escolhida aparecem aninhados abaixo dela. Em seguida, o seletor de **município**.
- Opção **"Todos os municípios (Ceará)"** no seletor: agregado estadual em que cada município funciona como um "bairro" (ranking do estado, votos de um candidato por município, clique no município abre a página dele). Disponível nas eleições em que os candidatos são os mesmos no estado inteiro (2022); em 2024 a opção fica desabilitada, porque os números dos candidatos se repetem entre municípios. O agregado é gerado por `scripts/agregar-estado.sh data/2022-1` (pasta `data/2022-1/todos/`) e ligado pela chave `agregado_estado` em `data/eleicoes.json`.
- Filtros por **cargo**, **candidato** e **bairro** (quando o município tem bairros cadastrados), com busca por nome, número ou partido.
- **Modo ranking** (nenhum candidato selecionado): ranking dos candidatos do cargo no município ou em um bairro, com foto, cor do partido, votos e %, além de aptos, comparecimento, abstenção, válidos, brancos, nulos e votos de legenda.
- **Modo candidato**: cartão em destaque com foto, nome, total de votos, nome completo, partido e número; abaixo, os votos agrupados por bairro, local de votação ou seção, com % dos votos válidos no grupo, % do total do candidato, válidos e aptos.
- Foto oficial, nome completo, ocupação e situação (Eleito, Suplente, 2º turno) de cada candidato, a partir do cadastro do TSE (2022; 2024 quando o cadastro for adicionado).
- Navegação por clique (candidato abre a distribuição, bairro abre as seções), trilha de localização e estado na URL (`#e=2022-1&m=15997&cargo=...&cand=...&bairro=...`) para compartilhar consultas.

## Mapa por bairro

- Tela **Mapa por bairro**: em cada bairro, um mini gráfico de barras com os 3 mais votados (foto no topo da barra, quantidade de votos e barra na cor do partido, altura relativa ao 1º do bairro); com candidato selecionado, uma barra só com os votos dele. Clicar no bairro abre o painel de detalhes (pizza com todos os candidatos, totais e lista com "Ver todos"); sem bairro selecionado, o painel mostra "Detalhes gerais" do município.
- As coordenadas ficam em `data/bairros.json`, por código TSE do município. Hoje só Paraipaba tem bairros e coordenadas (planilha em `data/raw/`). Para os demais municípios, os dados abertos do TSE não trazem o bairro dos locais de votação, então a tela informa isso e as tabelas usam local de votação e seção.
- O mapa usa [Leaflet](https://leafletjs.com/) (CDN) com o mapa base do [OpenStreetMap](https://www.openstreetmap.org/copyright).

## Eleições 2026 (mapeamento político municipal)

Seção **Eleições 2026** no menu, com três telas, sempre para o município escolhido na barra lateral:

- **Lideranças**: lista enxuta com foto, nome, votos em 2024 com os três bairros de maior votação (para quem foi candidato a vereador) e a expectativa de votos em 2026. Todos os candidatos a vereador e a prefeito de 2024 do município entram automaticamente, e é possível incluir lideranças manualmente. "Detalhes" abre um popup com a ficha completa (para quem trabalhou em 2022 para Deputado Estadual e Federal, quem apoiou em 2024 para Prefeito e Vereador, para quem vai trabalhar em 2026 como Deputado Federal e Estadual com a estimativa, observações), o botão Editar e, para quem foi candidato em 2024, "Ver detalhamento dos votos", que abre a tela Tabelas nas Eleições 2024 com o candidato filtrado.
- **Estimativa**: abas Deputado Federal e Deputado Estadual com a soma do que as lideranças do município devem dar a cada candidato de 2026. O botão "Detalhar" de cada candidato (que vira "Ocultar") expande a relação das lideranças que o apoiam, com votos de 2024, estimativa editável, ficha e remoção, além da inclusão de novas lideranças (a estimativa sugerida é a expectativa da liderança) e o total no município. Uma liderança apoia um candidato por cargo; mover para outro pede confirmação.
- **Candidatos 2026**: todos os candidatos a Presidente, Governador, Senador, Deputado Federal e Deputado Estadual do Ceará registrados no TSE para 2026, com foto oficial, número, partido e ocupação (`data/2026-1/candidatos.csv` e `data/2026-1/fotos/`, gerados a partir de `consulta_cand_2026.zip` e dos pacotes `foto_cand2026_CE_div.zip` / `foto_cand2026_BR_div.zip`; registro de candidaturas ainda em análise pelo TSE). Nos campos "trabalhará em 2026 para", a liderança é ligada a um desses candidatos por lista de sugestão; candidatos fora da lista podem ser cadastrados manualmente. A aba lista os candidatos manuais e aponta duplicidades com o cadastro do TSE (mesmo nome), com o botão "Substituir pelo TSE", que migra as lideranças ligadas e apaga o registro manual.
- **Onde ficam os dados**: no navegador (`localStorage`), sem servidor. No rodapé da tela Lideranças, **Exportar** baixa um JSON e **Importar** carrega em outro computador. Um arquivo `data/liderancas.json` publicado junto com o site serve de base inicial para quem abre o site pela primeira vez (substitua-o por um export para compartilhar o cadastro).

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
scripts/serve.ps1          servidor HTTP de desenvolvimento (Windows)
scripts/build-municipios.sh  converte o "votacao_secao" do TSE em uma pasta por município
data/eleicoes.json         manifesto das eleições (pasta, lista de municípios, fotos)
data/cargos.json           código do cargo (CD_CARGO do TSE) -> nome
data/partidos.json         número do partido -> sigla, por ano
data/bairros.json          coordenadas dos bairros, por código de município
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
- Só Paraipaba tem coordenadas de bairros; nos demais municípios a tela de mapa avisa que faltam coordenadas e as tabelas funcionam normalmente por bairro, local e seção.
- Em Paraipaba 2022, as seções 208 e 212 foram agregadas às seções 152 (Pedrinhas) e 162 (Camburão); os votos delas aparecem nas seções principais, conforme os boletins de urna.

## Roteiro

- [x] Etapa 1: consulta por candidato com votos por bairro e seção (Paraipaba, Eleições 2022).
- [x] Etapa 2: mapa interativo com a geolocalização de cada bairro (Leaflet).
- [x] Etapa 3: todos os municípios do Ceará nas Eleições 2022 (todos os cargos) e 2024 (Prefeito e Vereador), com seções e bairros do TRE-CE, cadastro e fotos do TSE.
- [ ] Coordenadas de bairros para outros municípios (mapa).
- [x] Publicado no GitHub Pages: https://wilkerpietro.github.io/eleicoes-ceara/ (repositório https://github.com/wilkerpietro/eleicoes-ceara).

## Fonte dos dados

Dados abertos do Tribunal Superior Eleitoral (TSE) e do Tribunal Regional Eleitoral do Ceará (TRE-CE).
