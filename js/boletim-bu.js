/* Leitura do arquivo binário do boletim de urna ("-bu.dat"), que o TSE publica por seção no site de resultados
   (arquivo-urna). É o arquivo oficial da totalização; o PDF "Via Digital" do site do TSE é montado a partir dele.
   Formato: ASN.1 em BER, especificação oficial do TSE ("bu.asn1", ModuloBU, IMPLICIT TAGS):
     EntidadeEnvelopeGenerico ::= SEQUENCE { cabecalho, fase, urna OPTIONAL, identificacao, tipoEnvelope,
                                             seguranca OPTIONAL, conteudo OCTET STRING }   -- conteudo = o boletim
     EntidadeBoletimUrna ::= SEQUENCE { cabecalho, fase, urna, identificacaoSecao { municipioZona { municipio, zona },
       local, secao }, dataHoraEmissao, dadosSecaoSA ([0] seção | [1] Sistema de Apuração), qtdEleitoresCompareceram,
       detalhamentoComparecimento [1] OPTIONAL, resultadosVotacaoPorEleicao SEQUENCE OF { idEleicao, qtdEleitoresAptos,
       ..., resultadosVotacao SEQUENCE OF { tipoCargo, qtdComparecimento, totaisVotosCargo SEQUENCE OF {
       codigoCargo ([1] cargo constitucional), ordemImpressao, votosVotaveis SEQUENCE OF { tipoVoto [1],
       quantidadeVotos [2], identificacaoVotavel [3] { partido, codigo } OPTIONAL, ... } } } }, ... }
   tipoVoto: 1 nominal, 2 branco, 3 nulo, 4 legenda, 5 cargo sem candidato. fase: 1 simulado, 2 oficial, 3 treinamento.
   Os campos são lidos pelo tipo (INTEGER, SEQUENCE, etiqueta de contexto) e pela ordem, sem depender dos campos
   novos que o TSE acrescenta entre versões (o de 2022 e o de 2024 diferem em alguns campos).
   Devolve o mesmo formato de BoletimTexto.ler: { cab: {MUNI, ZONA, LOCA, SECA, APTO, COMP, FASE, SA},
   cargos: [{ cargo, votos: {numero: n}, nomes: {}, partidos: {numero: {LEGP}}, NOMI, LEGC, BRAN, NULO, TOTC }] }.
   Funciona no navegador (window.BoletimBu, com Uint8Array) e no Node (require, com Buffer). */
(function (global) {
  'use strict';

  const UNIV = 0;
  const CONTEXTO = 2;
  const T = { INTEIRO: 2, OCTETOS: 4, ENUM: 10, SEQ: 16 };

  /** Um elemento TLV a partir de pos: { cls, cons, tag, ini, fim } (fim = fim do conteúdo). */
  function elemento(b, pos, limite) {
    let p = pos;
    if (p >= limite) throw new Error('arquivo do boletim truncado');
    const b0 = b[p++];
    const cls = b0 >> 6;
    const cons = (b0 & 0x20) !== 0;
    let tag = b0 & 0x1f;
    if (tag === 0x1f) { tag = 0; let x; do { x = b[p++]; tag = tag * 128 + (x & 0x7f); } while (x & 0x80); }
    let len = b[p++];
    if (len === 0x80) {
      // tamanho indefinido (BER): vai até o marcador 00 00
      let q = p;
      while (q < limite && !(b[q] === 0 && b[q + 1] === 0)) q = elemento(b, q, limite).prox;
      return { cls, cons, tag, ini: p, fim: q, prox: q + 2 };
    }
    if (len & 0x80) { const n = len & 0x7f; len = 0; for (let i = 0; i < n; i++) len = len * 256 + b[p++]; }
    if (p + len > limite) throw new Error('arquivo do boletim truncado');
    return { cls, cons, tag, ini: p, fim: p + len, prox: p + len };
  }

  function filhos(b, no) {
    const lista = [];
    for (let p = no.ini; p < no.fim;) { const f = elemento(b, p, no.fim); lista.push(f); p = f.prox; }
    return lista;
  }

  function inteiro(b, no) {
    let v = 0;
    for (let i = no.ini; i < no.fim; i++) v = v * 256 + b[i];
    if (no.fim > no.ini && b[no.ini] & 0x80) v -= Math.pow(256, no.fim - no.ini); // negativo (não deve ocorrer)
    return v;
  }

  const eh = (no, cls, tag) => no && no.cls === cls && no.tag === tag;
  const seq = (no) => eh(no, UNIV, T.SEQ) && no.cons;

  /**
   * Lê o arquivo do boletim (Buffer ou Uint8Array). Lança Error se não for um boletim reconhecível ou se os totais
   * não fecharem.
   */
  function ler(dados) {
    const b = dados instanceof Uint8Array ? dados : new Uint8Array(dados);
    const env = elemento(b, 0, b.length);
    if (!seq(env)) throw new Error('não é um arquivo de boletim de urna (ASN.1)');
    const partesEnv = filhos(b, env);
    const conteudo = partesEnv.filter((n) => eh(n, UNIV, T.OCTETOS)).pop();
    if (!conteudo) throw new Error('boletim sem conteúdo');
    const faseEnv = partesEnv.find((n) => eh(n, UNIV, T.ENUM));
    const bu = b.subarray(conteudo.ini, conteudo.fim);
    const raiz = elemento(bu, 0, bu.length);
    if (!seq(raiz)) throw new Error('conteúdo do boletim em formato inesperado');
    const c = filhos(bu, raiz);

    // ordem: cabecalho, fase, urna, identificacaoSecao, dataHoraEmissao, dadosSecaoSA, qtdEleitoresCompareceram, ...
    const fase = c.find((n) => eh(n, UNIV, T.ENUM));
    const iFase = c.indexOf(fase);
    const ident = c[iFase + 2];
    if (!seq(ident)) throw new Error('boletim sem identificação da seção');
    const [munZona, local, secao] = filhos(bu, ident);
    const [mun, zona] = filhos(bu, munZona);
    const iSA = c.findIndex((n, i) => i > iFase + 2 && n.cls === CONTEXTO && (n.tag === 0 || n.tag === 1) && n.cons);
    const resto = c.slice(iSA + 1);
    // formato de 2024 em diante: qtdEleitoresCompareceram e a lista de resultados (SEQUENCE OF);
    // formato de 2022: sem o comparecimento geral, e a lista de resultados com etiqueta [3]
    const comp = resto.find((n) => eh(n, UNIV, T.INTEIRO));
    const resultados = (comp && resto.slice(resto.indexOf(comp) + 1).find((n) => seq(n))) || resto.find((n) => n.cls === CONTEXTO && n.tag === 3 && n.cons);
    if (!resultados) throw new Error('boletim sem resultados');

    const valorFase = inteiro(bu, fase);
    const cab = {
      MUNI: String(inteiro(bu, mun)), ZONA: String(inteiro(bu, zona)), LOCA: String(inteiro(bu, local)), SECA: String(inteiro(bu, secao)),
      COMP: comp ? String(inteiro(bu, comp)) : '', FASE: { 1: 'S', 2: 'O', 3: 'T' }[valorFase] || String(valorFase), SA: iSA >= 0 && c[iSA].tag === 1,
    };
    if (faseEnv && inteiro(b, faseEnv) !== valorFase) throw new Error('fase do envelope diferente da do boletim');

    const porCargo = new Map();
    for (const eleicao of filhos(bu, resultados)) {
      const partes = filhos(bu, eleicao);
      const ints = [];
      for (const n of partes) { if (eh(n, UNIV, T.INTEIRO)) ints.push(inteiro(bu, n)); else break; }
      // idEleicao, qtdEleitoresAptos, (qtdEleitoresAptosSecao, qtdEleitoresAptosTTE)
      if (ints[1] != null && !cab.APTO) cab.APTO = String(ints[1]);
      const listaRes = partes.find((n) => seq(n));
      if (!listaRes) continue;
      for (const rv of filhos(bu, listaRes)) {
        const [tipoCargo, qtdComp, totais] = filhos(bu, rv);
        if (!eh(tipoCargo, UNIV, T.ENUM) || !seq(totais)) continue;
        if (inteiro(bu, tipoCargo) === 3) continue; // consulta popular
        for (const tc of filhos(bu, totais)) {
          const [codigo, , votaveis] = filhos(bu, tc);
          if (!codigo || codigo.cls !== CONTEXTO || codigo.tag !== 1 || !seq(votaveis)) continue; // só cargos constitucionais
          const cargo = inteiro(bu, codigo);
          let atual = porCargo.get(cargo);
          if (!atual) { atual = { cargo, votos: {}, nomes: {}, partidos: {}, NOMI: 0, LEGC: 0, BRAN: 0, NULO: 0, TOTC: 0, comparecimento: inteiro(bu, qtdComp) }; porCargo.set(cargo, atual); }
          for (const vv of filhos(bu, votaveis)) {
            let tipo = null;
            let qtd = 0;
            let partido = null;
            let numero = null;
            for (const n of filhos(bu, vv)) {
              if (n.cls !== CONTEXTO) continue;
              if (n.tag === 1) tipo = inteiro(bu, n);
              else if (n.tag === 2) qtd = inteiro(bu, n);
              else if (n.tag === 3 && n.cons) { const [p, cod] = filhos(bu, n); partido = inteiro(bu, p); numero = inteiro(bu, cod); }
            }
            if (tipo === 1 && numero != null) { atual.votos[String(numero)] = (atual.votos[String(numero)] || 0) + qtd; atual.NOMI += qtd; }
            else if (tipo === 4 && partido != null) { const k = String(partido); (atual.partidos[k] = atual.partidos[k] || { LEGP: 0 }).LEGP += qtd; atual.LEGC += qtd; }
            else if (tipo === 2) atual.BRAN += qtd;
            else if (tipo === 3) atual.NULO += qtd;
            if (tipo >= 1 && tipo <= 4) atual.TOTC += qtd;
          }
        }
      }
    }
    const cargos = Array.from(porCargo.values());
    if (!cargos.length) throw new Error('boletim sem votos de cargos');
    if (!cab.COMP) cab.COMP = String(Math.max(...cargos.map((x) => x.comparecimento)));
    const nComp = +cab.COMP;
    for (const x of cargos) {
      // cada eleitor vota no máximo uma vez por cargo (Senador com duas vagas: duas)
      if (x.TOTC > (x.cargo === 5 ? 2 : 1) * Math.max(nComp, x.comparecimento)) throw new Error('cargo ' + x.cargo + ': mais votos (' + x.TOTC + ') que eleitores (' + nComp + ')');
      delete x.comparecimento;
    }
    return { cab, cargos, leitura: 'bu' };
  }

  const api = { ler };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.BoletimBu = api;
})(typeof window !== 'undefined' ? window : globalThis);
