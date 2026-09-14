#!/usr/bin/env bash
# Converte o arquivo "votacao_secao" do TSE (já em UTF-8, sem \r e sem aspas)
# em uma pasta por município com votos.csv, secoes.csv e candidatos.csv.
#
# Uso:
#   scripts/build-municipios.sh <ano> <votacao.csv> <destino> [cadastro.csv] [pasta_fotos...]
#
# Variáveis de ambiente opcionais:
#   LAYOUT=aberto|resultados  aberto = dados abertos (votacao_secao_<ano>_<UF>, 26 colunas, sem aptos);
#                             resultados = portal de resultados (votacao_secao-uf_*, com aptos por seção).
#                             Padrão: aberto para 2022, resultados para 2024.
#   TURNO=1                   turno a manter (layout aberto: coluna NR_TURNO; layout resultados: nr_turno). Padrão 1.
#   ANEXAR=1                  acrescenta os cargos do arquivo a uma pasta já gerada (une votos, seções e candidatos).
#
# - cadastro.csv (opcional): consulta_cand do TSE em UTF-8 (nome de urna, partido, situação, gênero, ocupação).
#   Sem ele, o nome vem do próprio arquivo de votos e o partido é deduzido do número (data/partidos.json).
# - pasta_fotos (opcional, várias): pastas foto_cand<ano>_<UF>_div; as fotos dos candidatos com votos
#   são copiadas para <destino>/fotos/<SQ_CANDIDATO>.<ext>.
#
# Formatos gerados (separador ";", UTF-8):
#   votos.csv       zona;secao;cargo;numero;votos            (cargo = código CD_CARGO, ver data/cargos.json)
#   secoes.csv      zona;secao;cod_local;local;endereco;bairro;cep;aptos;agregadas
#   candidatos.csv  cargo;numero;sq;nome;nome_urna;partido;situacao;genero;ocupacao;foto  (cargo = nome)
#   municipios.json [{"cd":"15997","nome":"PARAIPABA"}, ...]
set -euo pipefail

ANO="$1"; ARQ="$2"; DEST="$3"; CAD="${4:-}"; shift 3; [ $# -gt 0 ] && shift
FOTOS=("$@")
RAIZ="${RAIZ:-$(cd "$(dirname "$0")/.." && pwd)}"
LAYOUT="${LAYOUT:-$([ "$ANO" = "2022" ] && echo aberto || echo resultados)}"
TURNO="${TURNO:-1}"
ANEXAR="${ANEXAR:-0}"
TMP="$(mktemp -d)"
mkdir -p "$DEST"

# tabela número do partido -> sigla, para o ano
grep -A200 "\"$ANO\"" "$RAIZ/data/partidos.json" | sed -n '2,/}/p' | tr ',' '\n' | sed -n 's/.*"\([0-9][0-9]\)": *"\([^"]*\)".*/\1;\2/p' > "$TMP/partidos.txt"

echo "[1/3] Lendo $ARQ (layout $LAYOUT, turno $TURNO, anexar=$ANEXAR) ..."
if [ "$LAYOUT" = "aberto" ]; then
  # 6 NR_TURNO 14 cd_mun 15 nm_mun 16 zona 17 secao 18 cd_cargo 19 ds_cargo 20 nr_votavel 21 nm_votavel 22 qt_votos 23 nr_local 24 sq 25 nm_local 26 endereco
  MAPA='turno=$6; cd=$14; nm=$15; z=$16; s=$17; cg=$18; nv=$20; nome=$21; qt=$22; loc=$23; sq=$24; nloc=$25; end=$26; aptos=""'
else
  # 8 cd_mun 9 nm_mun 10 zona 11 nm_local 12 endereco 13 secao 14 nr_local 17 nr_turno 18 ds_cargo 19 nr_votavel 20 nm_votavel 21 sq 22 qt_aptos 26 qt_votos
  MAPA='turno=$17; cd=$8; nm=$9; z=$10; s=$13; dcg=$18; cg=(dcg=="Prefeito"?11:(dcg=="Vereador"?13:0)); nv=$19; nome=$20; qt=$26; loc=$14; sq=$21; nloc=$11; end=$12; aptos=$22'
fi
SUFIXO=""; [ "$ANEXAR" = "1" ] && SUFIXO=".novo"

gawk -F';' -v dest="$DEST" -v tmp="$TMP" -v turnof="$TURNO" -v anexar="$ANEXAR" -v suf="$SUFIXO" "
NR>1 && NF>=26 {
  $MAPA
  if (turno+0 != turnof+0) next
  gsub(/^ +| +$/, \"\", nome); gsub(/^ +| +$/, \"\", nloc); gsub(/^ +| +$/, \"\", end); gsub(/^ +| +$/, \"\", nm)
  if (!(cd in mun)) {
    mun[cd]=nm; system(\"mkdir -p '\" dest \"/\" cd \"'\")
    f=dest \"/\" cd \"/votos.csv\" suf
    if (anexar==1) { if (system(\"test -f '\" dest \"/\" cd \"/votos.csv'\")!=0) print \"zona;secao;cargo;numero;votos\" > f }
    else print \"zona;secao;cargo;numero;votos\" > f
  }
  f=dest \"/\" cd \"/votos.csv\" suf; print z \";\" s \";\" cg \";\" nv \";\" qt > f
  k=cd \"|\" z \"|\" s
  if (!(k in sec)) { sec[k]=z \";\" s \";\" loc \";\" nloc \";\" end \";;;\" aptos \";\"; secmun[k]=cd }
  nominal = (cg==6 || cg==7 || cg==13) ? (nv+0 > 99) : (nv+0 != 95 && nv+0 != 96)
  if (nominal) { kc=cd \"|\" cg \"|\" nv; if (!(kc in cand)) { cand[kc]=cg \";\" nv \";\" sq \";\" nome; candmun[kc]=cd } }
}
END {
  for (cd in mun) { print \"zona;secao;cod_local;local;endereco;bairro;cep;aptos;agregadas\" > (dest \"/\" cd \"/secoes.csv\" suf); print \"cargo;numero;sq;nome\" > (tmp \"/cand_\" cd \".txt\") }
  for (k in sec) print sec[k] > (dest \"/\" secmun[k] \"/secoes.csv\" suf)
  for (k in cand) print cand[k] > (tmp \"/cand_\" candmun[k] \".txt\")
  n=0; printf \"[\" > (dest \"/municipios.json\" suf)
  for (cd in mun) { printf \"%s{\\\"cd\\\":\\\"%s\\\",\\\"nome\\\":\\\"%s\\\"}\", (n++ ? \",\" : \"\"), cd, mun[cd] > (dest \"/municipios.json\" suf) }
  print \"]\" > (dest \"/municipios.json\" suf)
}" "$ARQ"

# une (modo anexar) e ordena seções
for d in "$DEST"/*/; do
  cd_="$(basename "$d")"; [ "$cd_" = "fotos" ] && continue
  if [ "$ANEXAR" = "1" ]; then
    [ -f "$d/votos.csv.novo" ] || continue
    if [ -f "$d/votos.csv" ]; then
      tail -n +2 "$d/votos.csv.novo" >> "$d/votos.csv"; rm -f "$d/votos.csv.novo"
      gawk -F';' 'FNR==NR { k[$1"|"$2]=1; print; next } FNR>1 && !($1"|"$2 in k) { print }' "$d/secoes.csv" "$d/secoes.csv.novo" > "$TMP/s.csv"
      rm -f "$d/secoes.csv.novo"
    else
      mv "$d/votos.csv.novo" "$d/votos.csv"; mv "$d/secoes.csv.novo" "$TMP/s.csv"
    fi
  else
    cp "$d/secoes.csv" "$TMP/s.csv"
  fi
  { head -1 "$TMP/s.csv"; tail -n +2 "$TMP/s.csv" | sort -t';' -k1,1n -k2,2n; } > "$d/secoes.csv"
done
if [ "$ANEXAR" = "1" ]; then
  if [ -f "$DEST/municipios.json" ]; then rm -f "$DEST/municipios.json.novo"; else mv "$DEST/municipios.json.novo" "$DEST/municipios.json"; fi
fi

echo "[2/3] Cadastro dos candidatos ..."
# cadastro normalizado: cargo_codigo;numero;sq;nome;nome_urna;partido;situacao;genero;ocupacao;SG_UE  (prioriza APTO e situação definida)
if [ -n "$CAD" ] && [ -f "$CAD" ]; then
  awk -F';' 'NR>1 {
    c=toupper($15); cg=(c=="PRESIDENTE"?1:(c=="GOVERNADOR"?3:(c=="SENADOR"?5:(c=="DEPUTADO FEDERAL"?6:(c=="DEPUTADO ESTADUAL"?7:(c=="PREFEITO"?11:(c=="VEREADOR"?13:0)))))));
    if (cg==0) next;
    for(i=1;i<=NF;i++){gsub(/^ +| +$/,"",$i)}
    pri=0; if($24=="APTO")pri+=2; if($50!="#NULO")pri+=1;
    key=cg";"$17";"$12;
    sit=$50; if(sit=="#NULO")sit="";
    if(!(key in best)||pri>bestpri[key]){best[key]=cg";"$17";"$16";"$18";"$19";"$27";"sit";"$40";"$48";"$12; bestpri[key]=pri}
  } END{for(k in best)print best[k]}' "$CAD" > "$TMP/cadastro.txt"
else
  : > "$TMP/cadastro.txt"
fi

# índice de fotos disponíveis: sq -> caminho
: > "$TMP/fotos.txt"
for p in "${FOTOS[@]}"; do
  [ -d "$p" ] || continue
  find "$p" -maxdepth 1 -type f \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' \) | sed -n 's|.*/F[A-Z][A-Z]\([0-9]*\)_div\.\([A-Za-z]*\)$|\1;&|p' >> "$TMP/fotos.txt"
done
mkdir -p "$DEST/fotos"

echo "[3/3] Gerando candidatos.csv por município ..."
CARGOS="$RAIZ/data/cargos.json"
# 3a. candidatos por município (sem a coluna foto) e lista global de SQ_CANDIDATO
: > "$TMP/sq_todos.txt"
for d in "$DEST"/*/; do
  cd_="$(basename "$d")"; [ "$cd_" = "fotos" ] && continue
  [ -f "$TMP/cand_$cd_.txt" ] || continue
  gawk -F';' -v cd="$cd_" -v sqlist="$TMP/sq_todos.txt" '
    FILENAME==ARGV[1] { partido[$1]=$2; next }
    FILENAME==ARGV[2] { linha=$0; while (match(linha, /"([0-9]+)": *"([^"]*)"/, m)) { nomecargo[m[1]]=m[2]; linha=substr(linha, RSTART+RLENGTH) }; next }
    FILENAME==ARGV[3] { k=$1"|"$2; ue=$10; if (ue==cd || ue=="CE" || ue=="BR") { if (!(k in cad) || ue==cd) { cad[k]=$0 } } ; next }
    FNR==1 { print "cargo;numero;sq;nome;nome_urna;partido;situacao;genero;ocupacao"; next }
    {
      cg=$1; nv=$2; sq=$3; nome=$4; k=cg"|"nv
      nomeurna=nome; sigla=partido[substr(nv,1,2)]; sit=""; gen=""; ocu=""
      if (k in cad) { split(cad[k], c, ";"); if (c[3]!="") sq=c[3]; nome=c[4]; nomeurna=c[5]; if (c[6]!="") sigla=c[6]; sit=c[7]; gen=c[8]; ocu=c[9] }
      print nomecargo[cg]";"nv";"sq";"nome";"nomeurna";"sigla";"sit";"gen";"ocu
      print sq >> sqlist
    }' "$TMP/partidos.txt" "$CARGOS" "$TMP/cadastro.txt" "$TMP/cand_$cd_.txt" > "$TMP/c_$cd_.csv"
done

# 3b. copia cada foto uma única vez
sort -u "$TMP/sq_todos.txt" > "$TMP/sq_unicos.txt"
gawk -F';' 'FILENAME==ARGV[1] { foto[$1]=$2; next } ($1 in foto) { print $1 ";" foto[$1] }' "$TMP/fotos.txt" "$TMP/sq_unicos.txt" > "$TMP/fotos_usadas.txt"
: > "$TMP/fotomap.txt"
while IFS=';' read -r sq src; do
  ext="${src##*.}"; ext="${ext,,}"; dst="$DEST/fotos/$sq.$ext"
  [ -f "$dst" ] || cp "$src" "$dst"
  echo "$sq;$sq.$ext" >> "$TMP/fotomap.txt"
done < "$TMP/fotos_usadas.txt"
echo "   fotos: $(wc -l < "$TMP/fotomap.txt") de $(wc -l < "$TMP/sq_unicos.txt") candidatos"

# 3c. acrescenta a coluna foto, une com o existente (modo anexar) e ordena por cargo e número
for d in "$DEST"/*/; do
  cd_="$(basename "$d")"; [ "$cd_" = "fotos" ] && continue
  [ -f "$TMP/c_$cd_.csv" ] || continue
  gawk -F';' 'FILENAME==ARGV[1] { f[$1]=$2; next } FNR==1 { print $0 ";foto"; next } { print $0 ";" (($3 in f) ? f[$3] : "") }' "$TMP/fotomap.txt" "$TMP/c_$cd_.csv" > "$TMP/cf_$cd_.csv"
  if [ "$ANEXAR" = "1" ] && [ -f "$d/candidatos.csv" ]; then
    gawk -F';' 'FNR==NR { if (FNR>1) k[$1"|"$2]=1; print; next } FNR>1 && !($1"|"$2 in k) { print }' "$d/candidatos.csv" "$TMP/cf_$cd_.csv" > "$TMP/cu_$cd_.csv"
  else
    cp "$TMP/cf_$cd_.csv" "$TMP/cu_$cd_.csv"
  fi
  { head -1 "$TMP/cu_$cd_.csv"; tail -n +2 "$TMP/cu_$cd_.csv" | sort -t';' -k1,1 -k2,2n; } > "$d/candidatos.csv"
done

rm -rf "$TMP"
echo "Concluído: $(ls -d "$DEST"/*/ | grep -vc fotos) municípios em $DEST"
