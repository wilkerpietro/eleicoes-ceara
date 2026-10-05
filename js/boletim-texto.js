/* Leitura do boletim de urna pelo TEXTO, para o PDF "Via Digital" que o site de resultados do TSE gera
   (resultados.tse.jus.br > Boletim de urna > baixar): uma página comprida, só texto, sem QR Code. É o mesmo
   texto do boletim impresso, uma informação por linha:
     Município 15997 / Zona Eleitoral 0109 / Seção Eleitoral 0112 / Eleitores aptos 0306 / Comparecimento 0265
     -----DEPUTADO FEDERAL----- / Partido: 15 - MDB / YURY DO PAREDÃO 1515 0060 / Votos de legenda 0000 /
     Total do partido 0065 / ... / Total de votos Nominais / Total de votos de Legenda / Brancos / Nulos / Total Apurado
   Sem o código de segurança do QR Code, a leitura é conferida pelas somas do próprio boletim: votos dos candidatos
   = total nominal; candidatos + legenda = total de cada partido; nominais + legenda + brancos + nulos = total
   apurado, que não passa do comparecimento (para Senador, com duas vagas, o dobro; pode ficar abaixo quando há
   eleitor temporário que só vota para Presidente). Qualquer soma que não bata recusa o boletim.
   Devolve o mesmo formato de BoletimQR.interpretar: { cab: {MUNI, ZONA, LOCA, SECA, APTO, COMP, DTPL, FASE},
   cargos: [{ cargo, votos: {numero: n}, nomes: {numero: nome}, partidos: {numero_partido: {sigla, LEGP, TOTP}},
   NOMI, LEGC, BRAN, NULO, TOTC }] }. O mesmo texto vem dentro do arquivo "imgbu" que o TSE publica por seção
   (cópia do que a urna mandou para a impressora), usado por scripts/boletins-2026.js.
   Funciona no navegador (window.BoletimTexto) e no Node (require), para o mesmo leitor servir aos scripts. */
(function (global) {
  'use strict';

  const CARGOS = { PRESIDENTE: 1, GOVERNADOR: 3, SENADOR: 5, 'DEPUTADO FEDERAL': 6, 'DEPUTADO ESTADUAL': 7, 'DEPUTADO DISTRITAL': 8, PREFEITO: 11, VEREADOR: 13 };
  const NOME_CARGO = { 1: 'Presidente', 3: 'Governador', 5: 'Senador', 6: 'Deputado Federal', 7: 'Deputado Estadual', 8: 'Deputado Distrital', 11: 'Prefeito', 13: 'Vereador' };

  /** Sem acento, maiúsculas e espaços simples (o PDF às vezes traz "ı́" no lugar de "í"). */
  function simples(texto) {
    return String(texto).replace(/ı/g, 'i').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
  }

  /** Separa um texto em linhas não vazias, com espaços simples. */
  function linhasDe(texto) {
    return String(texto).split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  }

  /** O texto parece um boletim de urna? (para decidir entre ler o texto ou procurar QR Code) */
  function pareceBoletim(texto) {
    const t = simples(texto);
    return /BOLETIM DE URNA/.test(t) && /SECAO ELEITORAL \d+/.test(t) && /MUNICIPIO \d+/.test(t);
  }

  /**
   * Lê o boletim a partir das linhas do texto. Devolve { cab, cargos } ou lança Error dizendo o que não conferiu.
   */
  function ler(entrada) {
    const linhas = Array.isArray(entrada) ? entrada.map((l) => String(l).replace(/\s+/g, ' ').trim()).filter(Boolean) : linhasDe(entrada);
    const cab = {};
    const cargos = [];
    let atual = null;
    let partido = null;
    let pendente = ''; // nome longo que continua na linha seguinte ("NOME COMPRIDO-----" / "------> 13006 0001")
    let fase = 'O';
    for (const original of linhas) {
      const l = simples(original);
      let m;
      if (/\bSIMULAD[OA]\b/.test(l) && !atual) fase = 'S';
      if (/\bTREINAMENTO\b/.test(l) && !atual) fase = 'T';
      // cabeçalho do cargo: "-----DEPUTADO FEDERAL-----"
      if ((m = /^-{3,} ?([A-Z][A-Z ]*?) ?-{3,}$/.exec(l))) {
        const cg = CARGOS[m[1].trim()];
        if (!cg) throw new Error('cargo desconhecido no boletim: ' + m[1].trim());
        atual = { cargo: cg, votos: {}, nomes: {}, partidos: {}, porPartido: {} };
        partido = null;
        pendente = '';
        cargos.push(atual);
        continue;
      }
      if (!atual) {
        // cabeçalho do boletim (até o primeiro cargo)
        if ((m = /^MUNICIPIO (\d+)$/.exec(l)) && !cab.MUNI) cab.MUNI = m[1];
        else if ((m = /^ZONA ELEITORAL (\d+)$/.exec(l)) && !cab.ZONA) cab.ZONA = m[1];
        else if ((m = /^LOCAL DE VOTACAO (\d+)$/.exec(l)) && !cab.LOCA) cab.LOCA = m[1];
        else if ((m = /^SECAO ELEITORAL (\d+)$/.exec(l)) && !cab.SECA) cab.SECA = m[1];
        else if ((m = /^ELEITORES APTOS (\d+)$/.exec(l)) && !cab.APTO) cab.APTO = m[1];
        else if ((m = /^COMPARECIMENTO (\d+)$/.exec(l)) && !cab.COMP) cab.COMP = m[1];
        else if ((m = /^ELEITORES FALTOSOS (\d+)$/.exec(l)) && !cab.FALT) cab.FALT = m[1];
        // boletim do Sistema de Apuração (urna substituída por votação manual): "No. de votos MAJORITÁRIO/PROPORCIONAL"
        else if ((m = /^NO\.? DE VOTOS (MAJORITARIO|PROPORCIONAL) (\d+)$/.exec(l))) cab.COMPSA = String(Math.max(+m[2], +(cab.COMPSA || 0)));
        else if ((m = /^SECOES AGREGADAS: ?(.+)$/.exec(l))) cab.AGRE = m[1].replace(/\s+/g, '');
        else if ((m = /^\((\d{2})\/(\d{2})\/(\d{4})\)$/.exec(l)) && !cab.DTPL) cab.DTPL = m[3] + m[2] + m[1];
        else if ((m = /^(\d)\S* TURNO$/.exec(l)) && !cab.TURN) cab.TURN = m[1];
        continue;
      }
      if ((m = /^PARTIDO: ?(\d+) ?- ?(.+)$/.exec(l))) { partido = m[1]; atual.partidos[partido] = { sigla: m[2].trim() }; atual.porPartido[partido] = 0; continue; }
      if ((m = /^VOTOS DE LEGENDA (\d+)$/.exec(l))) { if (partido) atual.partidos[partido].LEGP = +m[1]; continue; }
      if ((m = /^TOTAL DO PARTIDO (\d+)$/.exec(l))) { if (partido) atual.partidos[partido].TOTP = +m[1]; continue; }
      if ((m = /^TOTAL DE VOTOS NOMINAIS (\d+)$/.exec(l))) { atual.NOMI = +m[1]; partido = null; continue; }
      if ((m = /^TOTAL DE VOTOS DE LEGENDA (\d+)$/.exec(l))) { atual.LEGC = +m[1]; continue; }
      if ((m = /^BRANCOS (\d+)$/.exec(l))) { atual.BRAN = +m[1]; continue; }
      if ((m = /^NULOS (\d+)$/.exec(l))) { atual.NULO = +m[1]; continue; }
      if ((m = /^TOTAL APURADO (\d+)$/.exec(l))) { atual.TOTC = +m[1]; atual = null; partido = null; continue; }
      if ((m = /^ELEITORES APTOS (\d+)$/.exec(l))) { atual.APTA = +m[1]; continue; }
      // candidato: "YURY DO PAREDÃO 1515 0060" (nome, número e votos); nome longo vem numa linha antes, terminada em "---"
      if ((m = /^(.*\S) (\d{2,5}) (\d{1,5})$/.exec(l)) && (/[A-Z]/.test(m[1]) || (pendente && /^-*>$/.test(m[1]))) && !/^(ORIGINAIS|TEMPORARIOS|HABILITACAO|CODIGO)/.test(m[1])) {
        atual.votos[m[2]] = (atual.votos[m[2]] || 0) + +m[3];
        atual.nomes[m[2]] = /[A-Z]/.test(m[1]) ? original.replace(/\s+\d+\s+\d+\s*$/, '').trim() : pendente;
        if (partido) atual.porPartido[partido] += +m[3];
        pendente = '';
        continue;
      }
      if ((m = /^(.*[A-Z].*?) ?-{3,}$/.exec(l))) { pendente = original.replace(/\s*-{3,}\s*$/, '').trim(); continue; }
      pendente = '';
    }
    if (!cab.COMP && cab.COMPSA) cab.COMP = cab.COMPSA;
    delete cab.COMPSA;
    conferirSomas(cab, cargos);
    for (const c of cargos) delete c.porPartido;
    cab.FASE = fase;
    return { cab, cargos, leitura: 'texto' };
  }

  function conferirSomas(cab, cargos) {
    if (!cab.MUNI || !cab.SECA) throw new Error('o texto não traz o município e a seção do boletim');
    const comp = +cab.COMP;
    if (!comp) throw new Error('o texto não traz o comparecimento');
    if (!cargos.length) throw new Error('nenhum cargo encontrado no texto do boletim');
    for (const c of cargos) {
      const nome = NOME_CARGO[c.cargo];
      for (const k of ['NOMI', 'BRAN', 'NULO', 'TOTC']) if (c[k] == null) throw new Error(nome + ': falta o resumo do cargo (texto incompleto)');
      const nominais = Object.values(c.votos).reduce((a, b) => a + b, 0);
      if (nominais !== c.NOMI) throw new Error(nome + ': os votos dos candidatos (' + nominais + ') não batem com o total nominal (' + c.NOMI + ')');
      let legenda = 0;
      for (const [p, dados] of Object.entries(c.partidos)) {
        legenda += dados.LEGP || 0;
        if (dados.TOTP != null && c.porPartido[p] + (dados.LEGP || 0) !== dados.TOTP) throw new Error(nome + ': a soma do partido ' + p + ' não confere');
      }
      if ((c.LEGC || 0) !== legenda) throw new Error(nome + ': os votos de legenda não batem com o total');
      const total = c.NOMI + (c.LEGC || 0) + c.BRAN + c.NULO;
      if (total !== c.TOTC) throw new Error(nome + ': nominais + legenda + brancos + nulos (' + total + ') não batem com o total apurado (' + c.TOTC + ')');
      // cada eleitor vota no máximo uma vez por cargo (Senador com duas vagas: duas vezes); pode ser menos, porque
      // eleitor temporário em trânsito de outro estado só vota para Presidente
      if (c.TOTC > (c.cargo === 5 ? 2 : 1) * comp) throw new Error(nome + ': total apurado (' + c.TOTC + ') maior que o comparecimento (' + comp + ')');
    }
  }

  const api = { ler, linhasDe, pareceBoletim, simples, CARGOS, NOME_CARGO };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.BoletimTexto = api;
})(typeof window !== 'undefined' ? window : globalThis);
