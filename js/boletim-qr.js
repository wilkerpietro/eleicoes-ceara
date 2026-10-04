/* Leitura do boletim de urna pelos QR Codes impressos nele, a partir de um PDF (ex.: o "imgbu.pdf" do TSE)
   ou de uma foto. Segue o manual do TSE "QR Code no Boletim de Urna" (versão do formato 1.5, desde 2024):
   - cada QR Code começa com "QRBU:i:N VRQR:x VRCH:y" (parte i de N), traz um trecho do conteúdo e termina com
     "HASH:..." (e "ASSI:..." no último); um boletim de eleição geral pode ter até 4 QR Codes;
   - o conteúdo é uma lista "chave:valor" separada por espaço: cabeçalho (MUNI, ZONA, SECA, COMP...) e, por cargo,
     "CARG:n TIPO:n", os votos "número:votos" e o resumo (NOMI, LEGC, BRAN, NULO, TOTC);
   - HASH confere a leitura: na parte 1 é SHA-512 dos dados dela; nas seguintes, SHA-512 de tudo o que veio antes
     ("dados1 HASH:h1 dados2 HASH:h2 ...") mais um espaço e os dados da parte (fórmula conferida com os exemplos
     oficiais de 2024). Hash que não bate = leitura com erro, e o boletim não é usado.
   Bibliotecas carregadas só quando a leitura é usada: pdf.js (PDF -> imagem) e, para o QR Code, o leitor do próprio
   navegador (BarcodeDetector, quando existe), o ZXing em WebAssembly e, de reserva, o jsQR. */
(function (global) {
  'use strict';

  const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
  const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  const JSQR = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
  // ZXing (zxing-cpp em WebAssembly): lê vários QR Codes de uma vez, inclusive em foto torta; jsQR fica de reserva
  const ZXING = 'https://cdn.jsdelivr.net/npm/zxing-wasm@2.2.4/dist/iife/reader/index.js';
  const ZXING_WASM = 'https://cdn.jsdelivr.net/npm/zxing-wasm@2.2.4/dist/reader/zxing_reader.wasm';
  let zxingPronto = null;
  const scripts = {};

  function carregarScript(url) {
    if (!scripts[url]) {
      scripts[url] = new Promise((ok, falha) => {
        const s = document.createElement('script');
        s.src = url;
        s.onload = ok;
        s.onerror = () => { delete scripts[url]; falha(new Error('não foi possível carregar o leitor (sem internet?)')); };
        document.head.appendChild(s);
      });
    }
    return scripts[url];
  }

  // ---------- imagens: PDF (cada página) ou foto ----------
  async function paginasDoPdf(arquivo) {
    await carregarScript(PDFJS);
    const pdfjs = global.pdfjsLib;
    pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await arquivo.arrayBuffer()) }).promise;
    const telas = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const pagina = await doc.getPage(i);
      const base = pagina.getViewport({ scale: 1 });
      // ~2000 px de largura (o imgbu.pdf do TSE é A4), sem passar de ~16 milhões de pixels por página
      const escala = Math.min(Math.max(1.5, Math.min(5, 2000 / base.width)), Math.sqrt(16e6 / (base.width * base.height)));
      const vp = pagina.getViewport({ scale: escala });
      const tela = document.createElement('canvas');
      tela.width = Math.ceil(vp.width);
      tela.height = Math.ceil(vp.height);
      const c2d = tela.getContext('2d');
      c2d.fillStyle = '#fff';
      c2d.fillRect(0, 0, tela.width, tela.height);
      await pagina.render({ canvasContext: c2d, viewport: vp }).promise;
      telas.push(tela);
    }
    return telas;
  }

  async function telaDaFoto(arquivo) {
    const url = URL.createObjectURL(arquivo);
    try {
      const img = await new Promise((ok, falha) => {
        const i = new Image();
        i.onload = () => ok(i);
        i.onerror = () => falha(new Error('não foi possível abrir a imagem'));
        i.src = url;
      });
      const max = 3000;
      const f = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const tela = document.createElement('canvas');
      tela.width = Math.round(img.naturalWidth * f);
      tela.height = Math.round(img.naturalHeight * f);
      tela.getContext('2d').drawImage(img, 0, 0, tela.width, tela.height);
      return tela;
    } finally { URL.revokeObjectURL(url); }
  }

  // ---------- QR Codes de uma imagem ----------
  async function qrNativo(tela) {
    if (!('BarcodeDetector' in global)) return null;
    try {
      const formatos = await global.BarcodeDetector.getSupportedFormats();
      if (!formatos.includes('qr_code')) return null;
      const achados = await new global.BarcodeDetector({ formats: ['qr_code'] }).detect(tela);
      return achados.map((a) => a.rawValue).filter(Boolean);
    } catch (e) { return null; }
  }

  function reduzir(tela, max) {
    const f = Math.min(1, max / Math.max(tela.width, tela.height));
    if (f === 1) return tela;
    const t = document.createElement('canvas');
    t.width = Math.round(tela.width * f);
    t.height = Math.round(tela.height * f);
    t.getContext('2d').drawImage(tela, 0, 0, t.width, t.height);
    return t;
  }

  /** Imagem muito comprida (foto de uma tira inteira) é varrida em pedaços sobrepostos, para o QR não ficar minúsculo. */
  function recortes(tela) {
    if (tela.height <= tela.width * 2) return [tela];
    const alto = Math.round(tela.width * 1.4);
    const passo = Math.round(alto * 0.6);
    const lista = [];
    for (let y = 0; y < tela.height; y += passo) {
      const t = document.createElement('canvas');
      t.width = tela.width;
      t.height = Math.min(alto, tela.height - y);
      t.getContext('2d').drawImage(tela, 0, y, tela.width, t.height, 0, 0, tela.width, t.height);
      lista.push(t);
      if (y + alto >= tela.height) break;
    }
    return lista;
  }

  /** Já há todas as partes (1..N) de algum boletim entre os QR Codes lidos? */
  function completo(textos) {
    const porTotal = {};
    for (const t of textos) {
      const m = /^QRBU:(\d+):(\d+) /.exec(t);
      if (m) (porTotal[m[2]] = porTotal[m[2]] || new Set()).add(+m[1]);
    }
    return Object.entries(porTotal).some(([n, partes]) => partes.size >= +n);
  }

  /** Janelas quadradas que deslizam pela imagem com bastante sobreposição: cada QR Code cai inteiro e sozinho em alguma. */
  function janelas(tela, fracao) {
    const lado = Math.round(Math.min(tela.width, tela.height) * fracao);
    const passo = Math.max(1, Math.round(lado * 0.35));
    const posicoes = (total) => {
      const lista = [];
      for (let p = 0; p + lado < total; p += passo) lista.push(p);
      lista.push(Math.max(0, total - lado));
      return lista;
    };
    const lista = [];
    for (const y of posicoes(tela.height)) {
      for (const x of posicoes(tela.width)) {
        const t = document.createElement('canvas');
        t.width = Math.min(lado, tela.width);
        t.height = Math.min(lado, tela.height);
        t.getContext('2d').drawImage(tela, x, y, t.width, t.height, 0, 0, t.width, t.height);
        lista.push(t);
      }
    }
    return lista;
  }

  /**
   * jsQR lê um QR Code por vez e se confunde com vários lado a lado (mistura os cantos de códigos diferentes).
   * Por isso: imagem inteira (ou em tiras, se for comprida) em duas resoluções e, se ainda faltar parte, a mesma
   * busca em pedaços cada vez menores.
   */
  function qrJsqr(tela, achados) {
    for (const pedaco of recortes(tela)) {
      for (const max of [2000, 1300]) varrer(reduzir(pedaco, max), achados);
    }
    for (const fracao of [0.6, 0.42]) {
      if (completo(achados)) break;
      for (const janela of janelas(tela, fracao)) {
        varrer(reduzir(janela, 1100), achados);
        if (completo(achados)) break;
      }
    }
    return achados;
  }

  function varrer(tela, achados) {
    const copia = document.createElement('canvas');
    copia.width = tela.width;
    copia.height = tela.height;
    const c2d = copia.getContext('2d', { willReadFrequently: true });
    c2d.drawImage(tela, 0, 0);
    for (let n = 0; n < 8; n++) {
      const dados = c2d.getImageData(0, 0, copia.width, copia.height);
      const r = global.jsQR(dados.data, copia.width, copia.height, { inversionAttempts: 'dontInvert' });
      if (!r || !r.data) break;
      if (!achados.includes(r.data)) achados.push(r.data);
      const l = r.location;
      const xs = [l.topLeftCorner.x, l.topRightCorner.x, l.bottomLeftCorner.x, l.bottomRightCorner.x];
      const ys = [l.topLeftCorner.y, l.topRightCorner.y, l.bottomLeftCorner.y, l.bottomRightCorner.y];
      const margem = (Math.max(...xs) - Math.min(...xs)) * 0.12;
      c2d.fillStyle = '#fff';
      c2d.fillRect(Math.min(...xs) - margem, Math.min(...ys) - margem, Math.max(...xs) - Math.min(...xs) + 2 * margem, Math.max(...ys) - Math.min(...ys) + 2 * margem);
    }
  }

  function prepararZxing() {
    if (!zxingPronto) {
      zxingPronto = carregarScript(ZXING).then(() => {
        global.ZXingWASM.prepareZXingModule({ overrides: { locateFile: (caminho, prefixo) => (/\.wasm$/.test(caminho) ? ZXING_WASM : prefixo + caminho) }, fireImmediately: false });
        return global.ZXingWASM;
      }).catch((e) => { zxingPronto = null; throw e; });
    }
    return zxingPronto;
  }

  async function qrZxing(tela, achados) {
    let zx;
    try { zx = await prepararZxing(); } catch (e) { return false; }
    for (const max of [3000, 1800]) {
      const t = reduzir(tela, max);
      try {
        const dados = t.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, t.width, t.height);
        const res = await zx.readBarcodes(dados, { formats: ['QRCode'], tryHarder: true, tryRotate: true, maxNumberOfSymbols: 12 });
        for (const r of res) if (r.isValid !== false && r.text && !achados.includes(r.text)) achados.push(r.text);
      } catch (e) { return false; }
      if (completo(achados)) break;
    }
    return true;
  }

  async function qrDaTela(tela) {
    const achados = [];
    for (const t of (await qrNativo(tela)) || []) if (!achados.includes(t)) achados.push(t);
    if (achados.length && completo(achados)) return achados;
    const zxingRodou = await qrZxing(tela, achados);
    if (achados.length && completo(achados)) return achados;
    // página sem nenhum QR Code (ex.: a parte de texto do boletim): o ZXing já basta
    if (zxingRodou && !achados.length) return achados;
    // reserva: jsQR (se o ZXing não carregou, ou achou só parte dos QR Codes)
    try { await carregarScript(JSQR); } catch (e) { if (achados.length) return achados; throw e; }
    return qrJsqr(tela, achados);
  }

  /**
   * Lê os arquivos (PDF ou imagens) e devolve os QR Codes de boletim encontrados, por "unidade" (página ou foto),
   * na ordem: [{ arquivo, unidade, textos: [...] }]. progresso(texto) é chamado a cada etapa.
   */
  async function lerArquivos(arquivos, progresso) {
    const unidades = [];
    let n = 0;
    for (const arquivo of arquivos) {
      n++;
      const nome = arquivo.name || 'arquivo ' + n;
      if (progresso) progresso('Lendo ' + nome + ' (' + n + ' de ' + arquivos.length + ')…');
      const ehPdf = /pdf/i.test(arquivo.type) || /\.pdf$/i.test(nome);
      const telas = ehPdf ? await paginasDoPdf(arquivo) : [await telaDaFoto(arquivo)];
      for (let p = 0; p < telas.length; p++) {
        const textos = (await qrDaTela(telas[p])).filter((t) => /^QRBU:\d+:\d+ /.test(t));
        unidades.push({ arquivo: nome, unidade: ehPdf ? 'página ' + (p + 1) : 'foto', textos });
      }
    }
    return unidades;
  }

  // ---------- partes -> boletins ----------
  function separarParte(texto) {
    const m = /^QRBU:(\d+):(\d+) VRQR:(\S+) VRCH:(\S+) ([\s\S]*?) HASH:([0-9A-Fa-f]+)(?: ASSI:([0-9A-Fa-f]+))?\s*$/.exec(texto.trim());
    if (!m) return null;
    return { i: +m[1], n: +m[2], versao: m[3], dados: m[5], hash: m[6].toUpperCase(), texto };
  }

  /** Partes únicas encontradas nas unidades, cada uma com o arquivo de onde veio. */
  function partesDe(unidades) {
    const partes = [];
    for (const u of unidades) {
      for (const t of u.textos) {
        const p = separarParte(t);
        if (!p || partes.some((x) => x.texto === p.texto)) continue; // o mesmo QR lido duas vezes conta uma
        p.onde = u.arquivo + (u.unidade === 'foto' || !u.unidade ? '' : ', ' + u.unidade);
        partes.push(p);
      }
    }
    return partes;
  }

  /**
   * Junta as partes em boletins sem depender da ordem dos arquivos: cada parte 1 abre um boletim, e a parte k
   * entra no boletim cujo código de segurança acumulado bate com ela (o HASH da parte k só confere com as partes
   * anteriores certas). Partes que ainda não puderam ser encaixadas (falta uma anterior) ficam no boletim do mesmo
   * total, só para dizer quais já foram lidas. Devolve [{ n, partes: [p1..pN ou null], origem: [arquivos] }].
   */
  async function montar(unidades) {
    const partes = partesDe(unidades);
    const usadas = new Set();
    const boletins = [];
    const anotar = (b, p) => { b.partes[p.i - 1] = p; usadas.add(p); if (!b.origem.includes(p.onde)) b.origem.push(p.onde); };
    for (const p1 of partes.filter((p) => p.i === 1)) {
      const b = { n: p1.n, partes: new Array(p1.n).fill(null), origem: [] };
      anotar(b, p1);
      let acumulado = p1.dados + ' HASH:' + p1.hash;
      for (let k = 2; k <= p1.n; k++) {
        let achou = null;
        for (const c of partes) {
          if (usadas.has(c) || c.i !== k || c.n !== p1.n) continue;
          if ((await sha512Hex(acumulado + ' ' + c.dados)) === c.hash) { achou = c; break; }
        }
        if (!achou) break; // sem a parte k, as seguintes ainda não podem ser conferidas
        anotar(b, achou);
        acumulado += ' ' + achou.dados + ' HASH:' + achou.hash;
      }
      boletins.push(b);
    }
    // sobras: partes cuja anterior ainda não chegou (ou sem a parte 1)
    for (const p of partes.filter((x) => !usadas.has(x))) {
      let b = boletins.find((x) => x.n === p.n && !x.partes[p.i - 1] && x.partes.some((y) => !y));
      if (!b) { b = { n: p.n, partes: new Array(p.n).fill(null), origem: [] }; boletins.push(b); }
      anotar(b, p);
    }
    return boletins;
  }

  /** Completa um boletim incompleto com as partes de novas fotos/PDF (refaz a junção com tudo o que já foi lido). */
  async function completar(boletim, unidades) {
    const antigas = boletim.partes.filter(Boolean);
    const juntos = await montar([{ arquivo: '', unidade: '', textos: antigas.map((p) => p.texto) }].concat(unidades));
    // fica o boletim que mais reaproveita as partes já lidas
    let melhor = null;
    let pontos = -1;
    for (const b of juntos) {
      const n = b.partes.filter((p) => p && antigas.some((a) => a.texto === p.texto)).length;
      if (n > pontos) { melhor = b; pontos = n; }
    }
    if (!melhor) return boletim;
    melhor.origem = Array.from(new Set(boletim.origem.concat(melhor.origem.filter(Boolean))));
    return melhor;
  }

  async function sha512Hex(texto) {
    const bytes = new TextEncoder().encode(texto);
    const h = await crypto.subtle.digest('SHA-512', bytes);
    return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  }

  /** Confere a cadeia de HASH de um boletim completo. Devolve o conteúdo remontado ou lança erro. */
  async function conferir(boletim) {
    let acumulado = '';
    const dados = [];
    for (let k = 0; k < boletim.n; k++) {
      const p = boletim.partes[k];
      if (!p) throw new Error('falta o QR Code ' + (k + 1) + ' de ' + boletim.n);
      const entrada = (acumulado ? acumulado + ' ' : '') + p.dados;
      if ((await sha512Hex(entrada)) !== p.hash) throw new Error('o QR Code ' + (k + 1) + ' não confere (leitura com erro ou de outro boletim)');
      acumulado = entrada + ' HASH:' + p.hash;
      dados.push(p.dados);
    }
    return dados.join(' ');
  }

  /** Interpreta o conteúdo remontado: { cab: {MUNI, ZONA, SECA, COMP, ...}, cargos: [{ cargo, tipo, votos: {numero: n}, BRAN, NULO, ... }] }. */
  function interpretar(conteudo) {
    const cab = {};
    const cargos = [];
    let atual = null;
    let eleicao = '';
    for (const tok of conteudo.split(/\s+/)) {
      const i = tok.indexOf(':');
      if (i < 1) continue;
      const k = tok.slice(0, i);
      const v = tok.slice(i + 1);
      if (k === 'IDEL') { eleicao = v; atual = null; continue; }
      if (k === 'CARG') { atual = { cargo: +v, eleicao, tipo: null, votos: {}, partidos: {} }; cargos.push(atual); continue; }
      if (!atual) { if (!(k in cab)) cab[k] = v; continue; }
      if (k === 'TIPO') atual.tipo = +v;
      else if (k === 'PART') atual.partido = v;
      else if (k === 'LEGP' || k === 'TOTP') { (atual.partidos[atual.partido] = atual.partidos[atual.partido] || {})[k] = +v; }
      else if (/^\d+$/.test(k)) atual.votos[k] = (atual.votos[k] || 0) + (+v || 0);
      else if (/^[A-Z]{4}$/.test(k)) atual[k] = +v;
    }
    return { cab, cargos };
  }

  global.BoletimQR = { lerArquivos, montar, completar, conferir, interpretar, separarParte };
})(window);
