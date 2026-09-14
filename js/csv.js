/* Leitor de CSV simples (separador ";", sem aspas), usado pelos arquivos em data/. */
(function (global) {
  'use strict';

  function parseCsv(texto, separador) {
    const sep = separador || ';';
    const linhas = texto.replace(/^﻿/, '').replace(/\r/g, '').split('\n')
      .filter(l => l.trim() !== '');
    if (linhas.length === 0) return [];
    const cabecalho = linhas[0].split(sep).map(c => c.trim());
    const registros = [];
    for (let i = 1; i < linhas.length; i++) {
      const colunas = linhas[i].split(sep);
      const obj = {};
      for (let j = 0; j < cabecalho.length; j++) {
        obj[cabecalho[j]] = (colunas[j] === undefined ? '' : colunas[j]).trim();
      }
      registros.push(obj);
    }
    return registros;
  }

  async function carregarCsv(url, separador) {
    const resposta = await fetch(url, { cache: 'no-cache' });
    if (!resposta.ok) throw new Error('Falha ao carregar ' + url + ' (' + resposta.status + ')');
    return parseCsv(await resposta.text(), separador);
  }

  global.Csv = { parseCsv, carregarCsv };
})(window);
