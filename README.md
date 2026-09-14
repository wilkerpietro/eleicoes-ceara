# Eleições Paraipaba

Consulta de votação por **bairro**, **local de votação** e **seção eleitoral** no município de Paraipaba-CE.

Site estático, sem dependências: HTML, CSS e JavaScript puro lendo os CSVs da pasta `data/` diretamente no navegador. Pode ser publicado no GitHub Pages sem nenhuma etapa de build.

## O que já funciona (etapa 1 — Eleições 2022)

- Filtros por **eleição**, **cargo**, **candidato** e **bairro**, com busca por nome, número ou partido.
- **Modo ranking** (nenhum candidato selecionado): ranking dos candidatos do cargo no município ou em um bairro, com aptos, comparecimento, abstenção, válidos, brancos, nulos e votos de legenda.
- **Modo candidato**: votos do candidato agrupados por bairro, local de votação ou seção, com % dos votos válidos no grupo, % do total do candidato, válidos e aptos.
- Navegação por clique: candidato no ranking abre a distribuição; bairro na tabela abre as seções daquele bairro.
- Estado na URL (`#cargo=...&cand=...&bairro=...`) para compartilhar consultas.
- Foto oficial, nome completo, ocupação e situação (Eleito, Suplente, 2º turno) de cada candidato, a partir do cadastro do TSE.

## Mapa por bairro (etapa 2)

- Tela **Mapa por bairro** no menu lateral: um gráfico de pizza por bairro. Sem candidato, a pizza divide os votos válidos do bairro entre todos os candidatos (e votos de legenda), cada fatia com a **cor fixa do partido**; com candidato, mostra a fatia dele contra os demais. O tamanho é proporcional aos votos válidos ou aos votos do candidato.
- Clicar em um bairro abre o painel de detalhes: pizza ampliada com a participação de cada partido em %, aptos, comparecimento, válidos, brancos/nulos, e a lista de mais votados no bairro (cinco primeiros e botão "Ver todos"); com candidato selecionado, também os votos e a posição dele ali.
- Na tela de tabelas, o painel de destaques do ranking tem a mesma pizza por partido e a mesma lista com "Ver todos"; a tabela de ranking mostra a cor do partido. As cores por partido ficam em `CORES_PARTIDO` no `js/app.js`.
- Na tela de tabelas, com candidato selecionado e visão por bairro, o painel de destaques mostra a pizza da distribuição dos votos do candidato entre os bairros.
- As coordenadas (centro aproximado de cada bairro) ficam em `data/bairros.json`, extraídas da planilha `data/raw/Geolocalização dos bairros.xlsx`.
- O mapa usa [Leaflet](https://leafletjs.com/) (carregado via CDN) com o mapa base padrão do [OpenStreetMap](https://www.openstreetmap.org/copyright). Sem internet, as tabelas continuam funcionando; só o mapa fica indisponível.

## Como rodar localmente

Os dados são carregados via `fetch`, então a página precisa ser servida por HTTP (abrir o `index.html` direto do disco não funciona).

Qualquer servidor estático serve. Exemplos:

```bash
# Python
python -m http.server 8080
```

```bash
# Node
npx serve .
```

Ou use a extensão *Live Server* do VS Code. Depois abra `http://localhost:8080`.

## Estrutura

```
index.html            página única
css/style.css         estilos
js/csv.js             leitor de CSV (separador ";")
js/app.js             carga dos dados, agregações e renderização
data/eleicoes.json    manifesto das eleições disponíveis
data/bairros.json     coordenadas (lat/lng) de cada bairro, usadas pelo mapa
data/2022/secoes.csv  seções: zona, seção, local, endereço, bairro, aptos, seções agregadas
data/2022/votos.csv   votos por seção: cargo, número, nome, votos, partido, coligação
data/2022/candidatos.csv  cadastro dos candidatos com votos: nome completo, situação, gênero, ocupação, foto
data/2022/fotos/      fotos oficiais dos candidatos (TSE), nomeadas pelo SQ_CANDIDATO
data/raw/             arquivos originais do TRE-CE/TSE
```

### Formato dos dados

`data/<ano>/secoes.csv` (UTF-8, separador `;`):

```
zona;secao;cod_local;local;endereco;bairro;cep;aptos;agregadas
```

`data/<ano>/votos.csv`:

```
zona;secao;cargo;numero;nome;votos;partido;coligacao
```

Linhas com nome `BRANCOS`, `NULOS` e `LEGENDA <partido>` são tratadas como brancos, nulos e votos de legenda. Votos válidos = nominais + legenda.

`data/<ano>/candidatos.csv` (opcional, cruzado com os votos por cargo + número):

```
cargo;numero;sq;nome;nome_urna;partido;situacao;genero;ocupacao;foto
```

Gerado a partir do "consulta_cand" do TSE, mantendo só campos públicos não sensíveis (sem CPF, e-mail, título ou data de nascimento) e só os candidatos com votos no município. Em caso de substituição de candidato (mesmo número), fica a candidatura APTA com situação de totalização definida. A coluna `foto` aponta para `data/<ano>/fotos/<SQ_CANDIDATO>.jpg`, copiada dos pacotes `foto_cand<ano>_<UF>_div` do TSE.

### Origem dos dados de 2022

- **Seções e bairros**: TRE-CE, "Seções por município" (1º turno, dados de 04/10/2022).
- **Votos por seção**: TRE-CE/TSE, "Resultado por seção — boletins das urnas", Eleições Gerais 2022, 1º turno (dados gerados em 22/10/2022).

Os arquivos originais (ISO-8859-1) estão em `data/raw/`. A conversão para os CSVs em `data/2022/` foi: converter para UTF-8, remover cabeçalhos e rodapés, selecionar e renomear colunas.

Observação: as seções 208 e 212 foram agregadas às seções 152 (Pedrinhas) e 162 (Camburão); os votos delas aparecem nas seções principais, conforme os boletins de urna.

## Como adicionar uma nova eleição (ex.: 2024)

1. Criar `data/2024/secoes.csv` e `data/2024/votos.csv` no formato acima.
2. Adicionar uma entrada em `data/eleicoes.json`:

```json
{
  "id": "2024-1",
  "ano": 2024,
  "turno": 1,
  "nome": "Eleições Municipais 2024 · 1º turno",
  "data": "2024-10-06",
  "secoes": "data/2024/secoes.csv",
  "votos": "data/2024/votos.csv",
  "fonte": "TRE-CE / TSE — Resultado por seção (boletins de urna)"
}
```

Os cargos (Prefeito, Vereador) são detectados automaticamente a partir do CSV.

## Roteiro

- [x] Etapa 1: consulta por candidato com votos por bairro e seção (Eleições 2022).
- [x] Etapa 2: mapa interativo com a geolocalização de cada bairro (Leaflet), clicando no bairro para ver os dados eleitorais.
- [ ] Etapa 3: incluir os dados das Eleições Municipais 2024.
- [ ] Publicar no GitHub Pages.

## Fonte dos dados

Dados abertos do Tribunal Superior Eleitoral (TSE) e do Tribunal Regional Eleitoral do Ceará (TRE-CE).
