#!/usr/bin/env bash
# Gera a lista de seções da apuração paralela de 2026 (data/2026-1/<cd_municipio>/secoes.csv) a partir da lista
# "Seções Eleitorais no Estado" do TRE-CE. Com ela no lugar, a tela de apuração conta as seções de 2026 em vez das de 2024.
# Aceita o arquivo como o TRE publica (ISO-8859-1) ou já convertido para UTF-8.
#
# Uso: bash scripts/secoes-apuracao.sh tre-ce-eleicoes-2026-secoes-no-estado-1t_estado-CE.csv [códigos dos municípios]
#      (sem códigos: Paraipaba 15997 e Paracuru 15059)
set -euo pipefail
ARQ="$1"; shift
MUNS="${*:-15997 15059}"
DEST="${DEST:-data/2026-1}"
TMP="$(mktemp -d)"

if iconv -f UTF-8 -t UTF-8 "$ARQ" > /dev/null 2>&1; then tr -d '\r' < "$ARQ" > "$TMP/tre.csv"
else iconv -f ISO-8859-1 -t UTF-8 "$ARQ" | tr -d '\r' > "$TMP/tre.csv"; fi

# layout de eleição geral (2022) tem "Aptos Princ. Eleição Estadual": aptos na coluna 15, agregadas na 12;
# o de 2024 tem "Total de Eleitores Aptos": aptos na 13, agregadas na 11 (mesma regra de aplicar-secoes-tre.sh)
if grep -q "Aptos Princ. Elei" "$TMP/tre.csv"; then COL_APTOS=15; COL_AGR=12; else COL_APTOS=13; COL_AGR=11; fi

for cd in $MUNS; do
  awk -F';' -v cd="$cd" -v ca="$COL_APTOS" -v cg="$COL_AGR" '
    $2 == cd && $9 ~ /^ *[0-9]+ *$/ {
      for (i=1;i<=NF;i++) gsub(/^ +| +$/, "", $i)
      agr=$cg; gsub(/ /, "", agr)
      print ($1+0) ";" ($9+0) ";" $4 ";" $5 ";" $6 ";" $7 ";" $8 ";" $ca ";" agr
    }' "$TMP/tre.csv" | sort -t';' -k1,1n -k2,2n > "$TMP/$cd.txt"
  n=$(wc -l < "$TMP/$cd.txt" | tr -d ' ')
  if [ "$n" = 0 ]; then echo "$cd: nenhuma seção no arquivo (código do município certo?); nada gravado"; continue; fi
  mkdir -p "$DEST/$cd"
  { echo "zona;secao;cod_local;local;endereco;bairro;cep;aptos;agregadas"; cat "$TMP/$cd.txt"; } > "$DEST/$cd/secoes.csv"
  echo "$cd: $n seções gravadas em $DEST/$cd/secoes.csv"
done
rm -rf "$TMP"
