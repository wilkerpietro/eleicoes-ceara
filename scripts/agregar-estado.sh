#!/usr/bin/env bash
# Gera a pasta <destino>/todos com o agregado estadual de uma eleição: cada município vira uma
# "seção" (secao = código TSE, bairro/local = nome do município), os votos são somados por
# município e os candidatos são a união dos candidatos.csv de todos os municípios.
# Só faz sentido para eleições em que os candidatos são os mesmos no estado inteiro (2022).
#
# Uso: scripts/agregar-estado.sh data/2022-1
set -euo pipefail
DEST="$1"
OUT="$DEST/todos"
TMP="$(mktemp -d)"
mkdir -p "$OUT"

# nome dos municípios
gawk 'BEGIN{RS="}"} match($0, /"cd":"([0-9]+)","nome":"([^"]*)"/, m) { print m[1] ";" m[2] }' "$DEST/municipios.json" | sort > "$TMP/nomes.txt"

echo "zona;secao;cargo;numero;votos" > "$OUT/votos.csv"
echo "zona;secao;cod_local;local;endereco;bairro;cep;aptos;agregadas" > "$OUT/secoes.csv"
: > "$TMP/cands.txt"
n=0
while IFS=';' read -r cd nome; do
  d="$DEST/$cd"
  [ -f "$d/votos.csv" ] || continue
  gawk -F';' -v cd="$cd" 'NR>1 { v[$3";"$4]+=$5 } END { for (k in v) print "0;" cd ";" k ";" v[k] }' "$d/votos.csv" >> "$OUT/votos.csv"
  aptos=$(gawk -F';' 'NR>1 { s+=$8 } END { print s+0 }' "$d/secoes.csv")
  echo "0;$cd;$cd;$nome;;$nome;;$aptos;" >> "$OUT/secoes.csv"
  tail -n +2 "$d/candidatos.csv" >> "$TMP/cands.txt"
  n=$((n+1))
done < "$TMP/nomes.txt"

{ echo "cargo;numero;sq;nome;nome_urna;partido;situacao;genero;ocupacao;foto"; gawk -F';' '!seen[$1"|"$2]++' "$TMP/cands.txt" | sort -t';' -k1,1 -k2,2n; } > "$OUT/candidatos.csv"
rm -rf "$TMP"
echo "Agregado estadual: $n municípios, $(($(wc -l < "$OUT/votos.csv")-1)) linhas de votos, $(($(wc -l < "$OUT/candidatos.csv")-1)) candidatos em $OUT"
