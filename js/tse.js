/* Resultado oficial (TSE) por município — lê os arquivos públicos de divulgação de resultados do TSE
   (resultados.tse.jus.br) direto do navegador e atualiza sozinho.

   Formato (confirmado nos simulados oficiais de setembro/2026; o ambiente oficial abre no dia da eleição):
   - catálogo de eleições: <host>/<ambiente>/comum/config/ele-c.jws — diz o ciclo (ele2026), o código de cada
     eleição (a "estadual" tem Governador, Senador e Deputados; a "federal", Presidente) e, em arq[], o modelo de
     diretório de cada tipo de arquivo ("<base>/<ambiente>/<ciclo>/<cd_eleicao>/dados/<uf>");
   - resultado do município (tipo "u"): <dir>/<uf><municipio>-c<cargo 4 díg>-e<eleição 6 díg>-u.jws, com
     carg[0].agr[].par[].cand[] (n = número, nmu = nome de urna, vap = votos) e v.vv (votos válidos);
   - os arquivos vêm como JWS (cabeçalho.conteúdo.assinatura, em base64url): o conteúdo é o JSON. A assinatura
     não é conferida aqui (o arquivo vem do próprio domínio do TSE por HTTPS).
   Limite do TSE: 100 requisições por segundo por endereço; esta tela faz poucas por minuto. */
(function (global) {
  'use strict';

  const ARQUIVO_CONFIG = 'data/tse.json';
  const CARGOS = [ // código do cargo no TSE e quantos aparecem antes do "Ver mais"
    { cd: 3, nome: 'Governador', top: 99 },
    { cd: 6, nome: 'Deputado Federal', top: 10 },
    { cd: 7, nome: 'Deputado Estadual', top: 10 },
    { cd: 5, nome: 'Senador', top: 5 },
    { cd: 1, nome: 'Presidente', top: 5 },
  ];
  const TIPO_ESTADUAL = 1; // tipo de eleição no catálogo: 1 = ordinária estadual (Governador, Senador, Deputados)
  const TIPO_FEDERAL = 8;  // 8 = ordinária federal (Presidente)

  let cfg = null;
  let ctx = null;            // { el, municipios, candidatos2026, fotos2026 }
  let catalogo = null;       // catálogo já lido: { ciclo, estadual, federal, dir }
  let cargaCatalogo = null;
  const cadastro = new Map(); // cargo|numero -> { foto, partido }
  let chapa = new Map();      // numero -> { chapa: bool } (data/apuracao.json)
  const dados = new Map();    // cd do município -> { lidoEm, cargos: { [cd]: { ok, erro, cands, vv, tv, dg, hg } }, secoes }
  const ui = { mun: '', abertos: new Set(), erro: '' };
  let timer = null;
  let carregando = null;

  // ---------- utilidades ----------
  const MAPA_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => MAPA_ESC[c]);
  const fmtInt = (n) => (Number(n) || 0).toLocaleString('pt-BR');
  const fmtPct = (n) => (isFinite(n) ? n : 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
  const pct = (a, b) => (b > 0 ? (100 * a) / b : 0);
  const numero = (v) => { const n = Number(String(v == null ? '' : v).replace(/\./g, '').replace(',', '.')); return isFinite(n) ? n : 0; };
  const titulo = (s) => String(s || '').toLowerCase()
    .replace(/(^|[\s\-\/(])([^\s(])/g, (m, p, c) => p + c.toUpperCase())
    .replace(/ (De|Do|Da|Dos|Das|E) /g, (m) => m.toLowerCase());
  const pad = (n, w) => String(n).padStart(w, '0');
  const nomeMun = (cd) => { const m = (ctx.municipios || []).find((x) => x.cd === cd); return m ? titulo(m.nome) : cd; };

  function avatar(nome, foto, tam) {
    const iniciais = String(nome || '').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
    const img = foto ? '<img src="' + esc(foto) + '" alt="" loading="lazy" onerror="this.remove()">' : '';
    return '<span class="avatar" style="width:' + tam + 'px;height:' + tam + 'px">' + img + '<span class="iniciais">' + esc(iniciais) + '</span></span>';
  }

  /** Lê um arquivo do TSE: JWS (cabeçalho.conteúdo.assinatura) ou JSON puro. 404 vira erro com .naoPublicado. */
  async function lerArquivo(url) {
    let resp;
    try {
      resp = await fetch(url, { cache: 'no-cache' });
    } catch (e) {
      throw new Error('sem acesso ao site do TSE');
    }
    if (resp.status === 404 || resp.status === 403) {
      const e = new Error('ainda não publicado pelo TSE');
      e.naoPublicado = true;
      throw e;
    }
    if (!resp.ok) throw new Error('o TSE respondeu ' + resp.status);
    const texto = (await resp.text()).trim();
    if (texto.startsWith('{')) return JSON.parse(texto);
    const partes = texto.split('.');
    if (partes.length !== 3) throw new Error('arquivo do TSE em formato inesperado');
    const b64 = partes[1].replace(/-/g, '+').replace(/_/g, '/');
    const binario = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const bytes = Uint8Array.from(binario, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  // ---------- configuração e catálogo ----------
  async function carregarConfig() {
    const resp = await fetch(ARQUIVO_CONFIG, { cache: 'no-cache' });
    if (!resp.ok) throw new Error(ARQUIVO_CONFIG + ' (' + resp.status + ')');
    cfg = await resp.json();
    cfg.host = String(cfg.host || 'https://resultados.tse.jus.br').replace(/\/+$/, '');
    cfg.ambiente = String(cfg.ambiente || 'oficial').replace(/^\/+|\/+$/g, '');
    cfg.uf = String(cfg.uf || 'ce').toLowerCase();
    cfg.intervalo = Math.max(30, Number(cfg.intervalo_segundos) || 60) * 1000;
    cfg.municipios = (cfg.municipios || []).map(String);
    // candidatos da chapa (destaque) e cadastro com fotos
    try {
      const ap = await (await fetch('data/apuracao.json', { cache: 'no-cache' })).json();
      chapa = new Map((ap.candidatos || []).map((c) => [String(c.numero), { chapa: c.chapa !== false, cargo: c.cargo }]));
    } catch (e) { chapa = new Map(); }
    try {
      for (const c of await global.Csv.carregarCsv(ctx.candidatos2026 || 'data/2026-1/candidatos.csv')) {
        cadastro.set(c.cargo + '|' + c.numero, { foto: c.foto ? (ctx.fotos2026 || 'data/2026-1/fotos/') + c.foto : '', partido: c.partido || '' });
      }
    } catch (e) { /* sem fotos */ }
  }

  /** Lê o catálogo de eleições e acha o ciclo, os códigos das eleições do 1º turno e o modelo de diretório. */
  function garantirCatalogo() {
    if (catalogo) return Promise.resolve(catalogo);
    if (!cargaCatalogo) {
      cargaCatalogo = (async () => {
        const raw = await lerArquivo(cfg.host + '/' + cfg.ambiente + '/comum/config/ele-c.jws');
        const pleitos = Array.isArray(raw.pl) ? raw.pl : [];
        const temCargo = (e, cd) => (e.abr || []).some((a) => (a.cp || []).some((c) => Number(c.cd) === cd));
        let achado = null;
        // primeiro no ciclo configurado (ele2026); se o catálogo usar outro nome, aceita qualquer pleito com as eleições gerais
        const ordenados = pleitos.filter((p) => !cfg.ciclo || p.c === cfg.ciclo).concat(pleitos.filter((p) => cfg.ciclo && p.c !== cfg.ciclo));
        for (const p of ordenados) {
          const eleicoes = Array.isArray(p.e) ? p.e : [];
          const estadual = eleicoes.find((e) => Number(e.tp) === TIPO_ESTADUAL && Number(e.t) === 1 && temCargo(e, 3));
          const federal = eleicoes.find((e) => Number(e.tp) === TIPO_FEDERAL && Number(e.t) === 1 && temCargo(e, 1));
          if (estadual || federal) { achado = { ciclo: p.c, pleito: p.cd, estadual: estadual ? Number(estadual.cd) : null, federal: federal ? Number(federal.cd) : null }; break; }
        }
        if (!achado) throw new Error('o catálogo do TSE não tem as eleições gerais de 1º turno');
        const modelo = (Array.isArray(raw.arq) ? raw.arq : []).find((a) => a && a.tp === 'u');
        achado.dir = (modelo && modelo.dir) || '<base>/<ambiente>/<ciclo>/<cd_eleicao>/dados/<uf>';
        achado.dirAb = ((Array.isArray(raw.arq) ? raw.arq : []).find((a) => a && a.tp === 'ab') || {}).dir || achado.dir;
        catalogo = achado;
        return catalogo;
      })().catch((e) => { cargaCatalogo = null; throw e; });
    }
    return cargaCatalogo;
  }

  function diretorio(modelo, cdEleicao) {
    return modelo.replace('<base>', cfg.host).replace('<ambiente>', cfg.ambiente).replace('<ciclo>', catalogo.ciclo)
      .replace('<cd_eleicao>', String(cdEleicao)).replace('<uf>', cfg.uf).replace(/([^:])\/{2,}/g, '$1/');
  }

  function urlResultado(cdMun, cargo) {
    const ele = cargo === 1 ? catalogo.federal : catalogo.estadual;
    if (!ele) return null;
    return diretorio(catalogo.dir, ele) + '/' + cfg.uf + cdMun + '-c' + pad(cargo, 4) + '-e' + pad(ele, 6) + '-u.jws';
  }

  // ---------- leitura dos resultados ----------
  /** Converte o arquivo de resultado (tipo "u") em { cands: [{ n, nome, partido, votos }], vv, tv, dg, hg, secoes }. */
  function interpretar(raw) {
    const cargo = Array.isArray(raw.carg) ? raw.carg[0] : null;
    const cands = [];
    for (const agr of (cargo && cargo.agr) || []) {
      for (const par of agr.par || []) {
        for (const c of par.cand || []) {
          cands.push({ n: String(c.n), nome: titulo(c.nmu || c.nm), partido: par.sg || '', votos: numero(c.vap), destino: c.dvt || '', situacao: c.st || '' });
        }
      }
    }
    cands.sort((a, b) => b.votos - a.votos || a.nome.localeCompare(b.nome, 'pt-BR'));
    const v = raw.v || {};
    const validosCands = cands.filter((c) => !/anulad/i.test(c.destino)).reduce((t, c) => t + c.votos, 0);
    // seções e eleitorado, se o arquivo trouxer (no formato do acompanhamento: s.ts / s.st, e.te / e.c / e.a)
    const s = raw.s || (Array.isArray(raw.abr) && raw.abr[0] && raw.abr[0].s) || null;
    const e = raw.e && typeof raw.e === 'object' ? raw.e : (Array.isArray(raw.abr) && raw.abr[0] && raw.abr[0].e) || null;
    return {
      cands, vv: numero(v.vv) || validosCands, tv: numero(v.tv), dg: raw.dg || '', hg: raw.hg || '',
      secoes: s && s.ts ? { total: numero(s.ts), totalizadas: numero(s.st) } : null,
      eleitorado: e && e.te ? { total: numero(e.te), comparecimento: numero(e.c), abstencao: numero(e.a) } : null,
    };
  }

  /** Seções totalizadas do município pelo arquivo de acompanhamento da UF (se ele listar os municípios). */
  async function secoesPeloAcompanhamento(cdMun) {
    if (!catalogo.estadual) return null;
    try {
      const raw = await lerArquivo(diretorio(catalogo.dirAb, catalogo.estadual) + '/' + cfg.uf + '-e' + pad(catalogo.estadual, 6) + '-ab.jws');
      const item = (raw.abr || []).find((a) => String(a.cdabr).replace(/^\D+/, '') === cdMun || String(a.cdabr) === cfg.uf + cdMun);
      if (!item || !item.s) return null;
      return {
        secoes: { total: numero(item.s.ts), totalizadas: numero(item.s.st) },
        eleitorado: item.e && item.e.te ? { total: numero(item.e.te), comparecimento: numero(item.e.c), abstencao: numero(item.e.a) } : null,
      };
    } catch (e) { return null; }
  }

  async function atualizarMunicipio(cdMun) {
    await garantirCatalogo();
    const res = { lidoEm: new Date(), cargos: {}, secoes: null, eleitorado: null };
    // um arquivo por vez, para não sobrecarregar o TSE
    for (const cargo of CARGOS) {
      const url = urlResultado(cdMun, cargo.cd);
      if (!url) { res.cargos[cargo.cd] = { ok: false, erro: 'eleição não encontrada no catálogo', naoPublicado: true }; continue; }
      try {
        const r = interpretar(await lerArquivo(url));
        res.cargos[cargo.cd] = Object.assign({ ok: true }, r);
        if (!res.secoes && r.secoes) res.secoes = r.secoes;
        if (!res.eleitorado && r.eleitorado) res.eleitorado = r.eleitorado;
      } catch (e) {
        res.cargos[cargo.cd] = { ok: false, erro: e.message, naoPublicado: !!e.naoPublicado };
      }
    }
    if (!res.secoes && Object.values(res.cargos).some((c) => c.ok)) {
      const a = await secoesPeloAcompanhamento(cdMun);
      if (a) { res.secoes = a.secoes; res.eleitorado = res.eleitorado || a.eleitorado; }
    }
    dados.set(cdMun, res);
  }

  function atualizar() {
    if (carregando) return carregando;
    const cd = ui.mun;
    carregando = atualizarMunicipio(cd)
      .then(() => { ui.erro = ''; })
      .catch((e) => { ui.erro = e.message; })
      .finally(() => { carregando = null; if (ctx && !ctx.el.hidden && ui.mun === cd) render(); });
    render();
    return carregando;
  }

  // ---------- render ----------
  function render() {
    if (!ctx) return;
    const cd = ui.mun;
    const d = dados.get(cd);
    const rapidos = cfg.municipios.map((m) => '<button type="button" class="' + (m === cd ? 'ativo' : '') + '" data-tse="mun" data-valor="' + esc(m) + '">' + esc(nomeMun(m)) + '</button>').join('');
    const outros = '<select class="tse-sel" data-tse="sel" aria-label="Outro município"><option value="">Outro município…</option>' +
      (ctx.municipios || []).slice().sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
        .map((m) => '<option value="' + esc(m.cd) + '"' + (m.cd === cd && !cfg.municipios.includes(cd) ? ' selected' : '') + '>' + esc(titulo(m.nome)) + '</option>').join('') + '</select>';
    const algum = d && Object.values(d.cargos).find((c) => c.ok);
    const gerado = algum && algum.dg ? 'Dados do TSE de ' + algum.dg + ' às ' + algum.hg : '';
    let status = carregando && !d ? 'Lendo os arquivos do TSE…' : (d ? 'Lido às ' + d.lidoEm.toLocaleTimeString('pt-BR') + (gerado ? ' · ' + gerado : '') : '');
    if (d) status += ' · atualiza sozinho a cada ' + cfg.intervalo / 1000 + ' s';
    let corpo = '';
    if (ui.erro) {
      corpo = '<section class="painel la-aviso la-erro-sync ap-erro-leitura"><span>Não foi possível ler o TSE: ' + esc(ui.erro) +
        '. A divulgação oficial abre no dia da eleição e os resultados começam a sair depois das 17h. Se continuar, confira em <a href="https://resultados.tse.jus.br" target="_blank" rel="noopener">resultados.tse.jus.br</a>.</span></section>';
    } else if (d) {
      const sec = d.secoes;
      const gov = d.cargos[3] && d.cargos[3].ok ? d.cargos[3] : null;
      corpo = '<div class="ap-grandes">' +
        '<div class="ap-grande"><span class="rotulo">Seções totalizadas</span>' +
          (sec ? '<strong>' + fmtInt(sec.totalizadas) + '/' + fmtInt(sec.total) + '</strong><span class="ap-progresso"><span style="width:' + pct(sec.totalizadas, sec.total).toFixed(1) + '%"></span></span><span class="dica">' + fmtPct(pct(sec.totalizadas, sec.total)) + '</span>'
            : '<strong>—</strong><span class="dica">o TSE não informou neste arquivo</span>') + '</div>' +
        '<div class="ap-grande"><span class="rotulo">Votos válidos para governador</span><strong>' + (gov ? fmtInt(gov.vv) : '—') + '</strong>' +
          '<span class="dica">' + (d.eleitorado ? 'comparecimento ' + fmtInt(d.eleitorado.comparecimento) + ' de ' + fmtInt(d.eleitorado.total) + ' eleitores' : (gov && gov.tv ? fmtInt(gov.tv) + ' votos apurados' : '')) + '</span></div>' +
      '</div>' +
      '<div class="ap-cargos">' + CARGOS.map((c) => listaCargo(c, d.cargos[c.cd])).join('') + '</div>';
    } else {
      corpo = '<div class="vazio">Lendo os arquivos do TSE…</div>';
    }
    ctx.el.innerHTML = '<div class="la-status ap-status"><span class="ap-hora dica">' + esc(status) + '</span>' +
        '<button type="button" class="btn btn-mini" data-tse="atualizar"' + (carregando ? ' disabled' : '') + '>' + (carregando ? 'Atualizando…' : 'Atualizar agora') + '</button></div>' +
      '<section class="painel ap-topo"><div class="ap-cabecalho"><div><h2>Resultado oficial (TSE) · ' + esc(nomeMun(cd)) + '</h2>' +
        '<span class="dica">Arquivos públicos de divulgação do TSE. Oficiais, mas parciais até 100% das seções totalizadas. Percentual sobre os votos válidos.</span></div></div>' +
        '<div class="tse-municipios"><div class="segmentado la-abas ap-abas">' + rapidos + '</div>' + outros + '</div>' + corpo + '</section>';
  }

  function listaCargo(cargo, r) {
    if (!r || !r.ok) {
      const msg = !r ? 'Lendo…' : r.naoPublicado ? 'Ainda sem dados publicados (a divulgação começa às 17h).' : 'Erro: ' + r.erro;
      return '<section class="ap-cargo-bloco"><div class="ap-cargo-titulo"><h3>' + esc(cargo.nome) + '</h3></div><div class="vazio">' + esc(msg) + '</div></section>';
    }
    const chave = ui.mun + '|' + cargo.cd;
    const aberta = ui.abertos.has(chave);
    const limitada = r.cands.length > cargo.top;
    let html = '';
    let pulou = false;
    r.cands.forEach((c, i) => {
      const nosso = chapa.has(c.n) && chapa.get(c.n).cargo === cargo.nome;
      if (limitada && !aberta && i >= cargo.top && !nosso) { pulou = true; return; }
      if (pulou) { html += '<div class="ap-reticencias" aria-hidden="true">⋯</div>'; pulou = false; }
      html += linhaCandidato(c, cargo, r.vv, i + 1);
    });
    const escondidos = limitada && !aberta ? r.cands.filter((c, i) => i >= cargo.top && !(chapa.has(c.n) && chapa.get(c.n).cargo === cargo.nome)).length : 0;
    const botao = limitada && (aberta || escondidos)
      ? '<button type="button" class="btn btn-mini ap-ver-mais" data-tse="ver-mais" data-chave="' + esc(chave) + '">' + (aberta ? 'Ver menos' : 'Ver mais (' + escondidos + ')') + '</button>' : '';
    return '<section class="ap-cargo-bloco"><div class="ap-cargo-titulo"><h3>' + esc(cargo.nome) + '</h3><span class="dica">' + fmtInt(r.vv) + ' votos válidos</span></div>' +
      '<div class="ap-cargo-lista">' + (html || '<div class="vazio">Nenhum candidato no arquivo.</div>') + '</div>' + botao + '</section>';
  }

  function linhaCandidato(c, cargo, vv, posicao) {
    const info = chapa.get(c.n);
    const nosso = info && info.cargo === cargo.nome;
    const classe = nosso ? (info.chapa ? 'chapa' : 'adversario') : 'outro';
    const cad = cadastro.get(cargo.nome + '|' + c.n) || {};
    const p = pct(c.votos, vv);
    return '<div class="ap-cand ' + classe + '"><span class="ap-foto">' + avatar(c.nome, cad.foto, 40) + (c.votos > 0 ? '<span class="ap-pos">' + posicao + 'º</span>' : '') + '</span>' +
      '<div class="ap-cand-info"><strong>' + esc(c.nome) + (c.situacao && /eleito|turno/i.test(c.situacao) ? '<span class="selo eleito">' + esc(c.situacao) + '</span>' : '') + '</strong>' +
        '<span class="dica">' + esc(c.n) + (c.partido || cad.partido ? ' · ' + esc(c.partido || cad.partido) : '') + (nosso && info.chapa ? ' · nossa chapa' : '') + (/anulad/i.test(c.destino) ? ' · votos anulados' : '') + '</span></div>' +
      '<div class="ap-cand-num"><strong>' + (vv ? fmtPct(p) : '—') + '</strong><span>' + fmtInt(c.votos) + ' votos</span></div>' +
      '<span class="ap-barra"><span style="width:' + p.toFixed(1) + '%"></span></span></div>';
  }

  // ---------- eventos ----------
  function aoClicar(ev) {
    const alvo = ev.target.closest('[data-tse]');
    if (!alvo || !ctx.el.contains(alvo)) return;
    const acao = alvo.dataset.tse;
    if (acao === 'mun') trocarMunicipio(alvo.dataset.valor);
    else if (acao === 'atualizar') atualizar();
    else if (acao === 'ver-mais') {
      const k = alvo.dataset.chave;
      if (ui.abertos.has(k)) ui.abertos.delete(k); else ui.abertos.add(k);
      render();
    }
  }

  function aoMudar(ev) {
    if (ev.target.matches('[data-tse="sel"]') && ev.target.value) trocarMunicipio(ev.target.value);
  }

  function trocarMunicipio(cd) {
    ui.mun = cd;
    try { localStorage.setItem('eleicoes-ce-tse-mun', cd); } catch (e) { /* sem localStorage */ }
    render();
    if (!dados.has(cd) || Date.now() - dados.get(cd).lidoEm > 15000) atualizar();
  }

  let ligado = false;
  async function mostrar(contexto) {
    ctx = contexto;
    if (!ligado) {
      ligado = true;
      ctx.el.addEventListener('click', aoClicar);
      ctx.el.addEventListener('change', aoMudar);
      document.addEventListener('visibilitychange', () => { if (!document.hidden && ctx && !ctx.el.hidden && cfg) atualizar(); });
    }
    if (!cfg) {
      ctx.el.innerHTML = '<section class="painel"><div class="vazio">Carregando…</div></section>';
      try { await carregarConfig(); } catch (e) { ctx.el.innerHTML = '<section class="painel"><div class="vazio">Não foi possível abrir: ' + esc(e.message) + '</div></section>'; return; }
      let salvo = '';
      try { salvo = localStorage.getItem('eleicoes-ce-tse-mun') || ''; } catch (e) { /* sem localStorage */ }
      ui.mun = (salvo && (ctx.municipios || []).some((m) => m.cd === salvo)) ? salvo : (cfg.municipios[0] || '15997');
    }
    render();
    const d = dados.get(ui.mun);
    if (!d || Date.now() - d.lidoEm > 15000) atualizar();
    if (!timer) timer = setInterval(() => { if (ctx && !ctx.el.hidden && !document.hidden) atualizar(); }, cfg.intervalo);
  }

  global.ResultadoTse = { mostrar };
})(window);
