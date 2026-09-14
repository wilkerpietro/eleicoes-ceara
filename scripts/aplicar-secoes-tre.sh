#!/usr/bin/env bash
# Aplica a lista de seções do TRE-CE ("Seções Eleitorais no Estado", ISO-8859-1) às pastas por município:
# preenche local, endereço, bairro, CEP, aptos e seções agregadas em <destino>/<cd_municipio>/secoes.csv.
# Seções que só existem nos votos (não listadas pelo TRE) são mantidas como estavam.
#
# Uso: scripts/aplicar-secoes-tre.sh tre-ce-eleicoes-2022-secoes-no-estado-1t_estado-CE.csv data/2022-1
set -euo pipefail
ARQ="$1"; DEST="$2"
TMP="$(mktemp -d)"

iconv -f ISO-8859-1 -t UTF-8 "$ARQ" | tr -d '\r' > "$TMP/tre.csv"

# layout: 2022 tem "Aptos Princ. Eleição Estadual" (aptos totais na coluna 15, agregadas na 12);
#         2024 tem "Total de Eleitores Aptos" (aptos na 13, agregadas na 11)
if grep -q "Aptos Princ. Elei" "$TMP/tre.csv"; then COL_APTOS=15; COL_AGR=12; else COL_APTOS=13; COL_AGR=11; fi

# uma lista por município: zona;secao;cod_local;local;endereco;bairro;cep;aptos;agregadas
gawk -F';' -v tmp="$TMP" -v ca="$COL_APTOS" -v cg="$COL_AGR" '
  $2 ~ /^[0-9]+$/ && $9 ~ /^[0-9]+$/ {
    for (i=1;i<=NF;i++) gsub(/^ +| +$/, "", $i)
    zona=$1+0; sec=$9+0; agr=$cg; gsub(/ /, "", agr)
    print zona ";" sec ";" $4 ";" $5 ";" $6 ";" $7 ";" $8 ";" $ca ";" agr > (tmp "/tre_" $2 ".txt")
  }' "$TMP/tre.csv"

n=0
for f in "$TMP"/tre_*.txt; do
  cd_="$(basename "$f" .txt)"; cd_="${cd_#tre_}"
  d="$DEST/$cd_"
  [ -d "$d" ] || continue
  if [ -f "$d/secoes.csv" ]; then
    # TRE tem prioridade; mantém do arquivo atual apenas seções ausentes no TRE
    gawk -F';' 'FNR==NR { k[$2+0]=1; print; next } FNR>1 && !($2+0 in k) { print }' "$f" "$d/secoes.csv" > "$TMP/uniao.txt"
  else
    cp "$f" "$TMP/uniao.txt"
  fi
  { echo "zona;secao;cod_local;local;endereco;bairro;cep;aptos;agregadas"; sort -t';' -k1,1n -k2,2n "$TMP/uniao.txt"; } > "$TMP/final.txt"
  ok=0; for i in 1 2 3 4 5; do cp "$TMP/final.txt" "$d/secoes.csv" 2>/dev/null && { ok=1; break; }; sleep 2; done
  [ "$ok" = 1 ] || cp "$TMP/final.txt" "$d/secoes.csv"
  n=$((n+1))
done
rm -rf "$TMP"
echo "Seções do TRE aplicadas em $n municípios de $DEST"
