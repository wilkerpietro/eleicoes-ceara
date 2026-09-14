/* Eleições Paraipaba — consulta de votação por bairro, local e seção.
   Sem dependências: carrega os CSVs em data/ e monta as telas no navegador. */
(function () {
  'use strict';

  const ORDEM_CARGOS = ['Presidente', 'Governador', 'Senador', 'Deputado Federal', 'Deputado Estadual', 'Prefeito', 'Vereador'];
  const ICONE_CARGO = { Presidente: 'i-flag', Governador: 'i-building', Senador: 'i-users', 'Deputado Federal': 'i-users', 'Deputado Estadual': 'i-users', Prefeito: 'i-building', Vereador: 'i-users' };
  const REPO_URL = 'https://github.com/wilkerpietro/eleicoes-paraipaba';
  const NOME_POR = { bairro: 'bairro', local: 'local de votação', secao: 'seção' };
  const NOME_POR_CAB = { bairro: 'Bairro', local: 'Local de votação', secao: 'Seção' };

  const $ = (sel) => document.querySelector(sel);
  const el = {
    eleicao: $('#sel-eleicao'),
    navCargos: $('#nav-cargos'),
    candidato: $('#sel-candidato'),
    bairro: $('#sel-bairro'),
    busca: $('#inp-busca'),
    limpar: $('#btn-limpar'),
    voltar: $('#btn-voltar'),
    avancar: $('#btn-avancar'),
    trilha: $('#trilha'),
    status: $('#status'),
    resumo: $('#resumo'),
    tituloDestaques: $('#titulo-destaques'),
    destaques: $('#destaques'),
    titulo: $('#titulo-tabela'),
    dica: $('#dica-tabela'),
    thead: $('#tabela thead'),
    tbody: $('#tabela tbody'),
    tfoot: $('#tabela tfoot'),
    fonte: $('#fonte'),
    linkRepo: $('#link-repo'),
  };

  const estado = { eleicao: '', cargo: '', cand: '', bairro: '', por: 'bairro', busca: '' };
  let manifesto = null;
  let db = null; // dados da eleição carregada

  // ---------- utilidades ----------
  const fmtInt = (n) => (n || 0).toLocaleString('pt-BR');
  const fmtPct = (n) => (isFinite(n) ? n : 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
  const pct = (a, b) => (b > 0 ? (100 * a) / b : 0);
  const MAPA_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => MAPA_ESC[c]);
  const normalizar = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const icone = (id, cls) => '<svg class="icone ' + (cls || '') + '" aria-hidden="true"><use href="#' + id + '"/></svg>';
  const titulo = (s) => String(s || '').toLowerCase()
    .replace(/(^|[\s\-\/(])(\S)/g, (m, p, c) => p + c.toUpperCase())
    .replace(/ (De|Do|Da|Dos|Das|E) /g, (m) => m.toLowerCase());

  function tipoVoto(reg) {
    const nome = reg.nome.toUpperCase();
    if (nome === 'BRANCOS' || reg.numero === '95') return 'branco';
    if (nome === 'NULOS' || reg.numero === '96') return 'nulo';
    if (nome.startsWith('LEGENDA')) return 'legenda';
    return 'nominal';
  }

  function ordenarCargos(cargos) {
    return cargos.slice().sort((a, b) => {
      const ia = ORDEM_CARGOS.indexOf(a);
      const ib = ORDEM_CARGOS.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b, 'pt-BR');
    });
  }

  // ---------- estado <-> URL ----------
  function lerHash() {
    const p = new URLSearchParams(location.hash.replace(/^#/, ''));
    estado.eleicao = p.get('e') || estado.eleicao;
    estado.cargo = p.get('cargo') || '';
    estado.cand = p.get('cand') || '';
    estado.bairro = p.get('bairro') || '';
    estado.por = ['bairro', 'local', 'secao'].includes(p.get('por')) ? p.get('por') : 'bairro';
    estado.busca = p.get('q') || '';
  }

  function hashAtual() {
    const p = new URLSearchParams();
    if (estado.eleicao) p.set('e', estado.eleicao);
    if (estado.cargo) p.set('cargo', estado.cargo);
    if (estado.cand) p.set('cand', estado.cand);
    if (estado.bairro) p.set('bairro', estado.bairro);
    if (estado.por !== 'bairro') p.set('por', estado.por);
    if (estado.busca) p.set('q', estado.busca);
    return '#' + p.toString();
  }

  let ignorarHashchange = false;
  function gravarHash(empilhar) {
    const novo = hashAtual();
    if (novo === location.hash) return;
    ignorarHashchange = true;
    if (empilhar) history.pushState(null, '', novo); else history.replaceState(null, '', novo);
    setTimeout(() => { ignorarHashchange = false; }, 0);
  }

  // ---------- carga de dados ----------
  async function carregarEleicao(id) {
    const cfg = manifesto.eleicoes.find((e) => e.id === id) || manifesto.eleicoes[0];
    estado.eleicao = cfg.id;
    el.status.textContent = 'Carregando ' + cfg.nome + '…';
    el.status.classList.remove('erro');

    const [secoesCsv, votosCsv] = await Promise.all([Csv.carregarCsv(cfg.secoes), Csv.carregarCsv(cfg.votos)]);

    const secoes = new Map();
    for (const s of secoesCsv) {
      secoes.set(s.secao, {
        secao: s.secao, zona: s.zona, cod_local: s.cod_local, local: s.local, endereco: s.endereco,
        bairro: s.bairro, cep: s.cep, aptos: parseInt(s.aptos, 10) || 0, agregadas: s.agregadas || '',
      });
    }

    const votos = [];
    const cargosSet = new Set();
    for (const v of votosCsv) {
      const reg = {
        secao: v.secao, cargo: v.cargo, numero: v.numero, nome: v.nome, partido: v.partido,
        coligacao: v.coligacao || '', votos: parseInt(v.votos, 10) || 0,
      };
      reg.tipo = tipoVoto(reg);
      if (!secoes.has(reg.secao)) {
        secoes.set(reg.secao, {
          secao: reg.secao, zona: v.zona, cod_local: '', local: 'Local não informado', endereco: '',
          bairro: 'BAIRRO NÃO INFORMADO', cep: '', aptos: 0, agregadas: '',
        });
      }
      votos.push(reg);
      cargosSet.add(reg.cargo);
    }

    // candidatos por cargo (apenas votos nominais)
    const candidatos = new Map(); // cargo -> Map(numero -> candidato)
    for (const v of votos) {
      if (v.tipo !== 'nominal') continue;
      if (!candidatos.has(v.cargo)) candidatos.set(v.cargo, new Map());
      const m = candidatos.get(v.cargo);
      if (!m.has(v.numero)) m.set(v.numero, { numero: v.numero, nome: v.nome, partido: v.partido, coligacao: v.coligacao, total: 0 });
      m.get(v.numero).total += v.votos;
    }

    const bairros = Array.from(new Set(Array.from(secoes.values()).map((s) => s.bairro)))
      .sort((a, b) => a.localeCompare(b, 'pt-BR'));

    db = { cfg, secoes, votos, cargos: ordenarCargos(Array.from(cargosSet)), candidatos, bairros };
    el.status.textContent = '';
    el.fonte.textContent = 'Fonte: ' + (cfg.fonte || 'TSE/TRE-CE') + '.';
  }

  // ---------- agregações ----------
  function secoesNoEscopo() {
    const lista = Array.from(db.secoes.values());
    return estado.bairro ? lista.filter((s) => s.bairro === estado.bairro) : lista;
  }

  function chaveGrupo(s, por) {
    if (por === 'secao') return s.secao;
    if (por === 'local') return s.cod_local + '|' + s.local;
    return s.bairro;
  }

  function totaisCargo(votosFiltrados) {
    const t = { nominal: 0, legenda: 0, branco: 0, nulo: 0 };
    for (const v of votosFiltrados) t[v.tipo] += v.votos;
    t.validos = t.nominal + t.legenda;
    t.comparecimento = t.validos + t.branco + t.nulo;
    return t;
  }

  /** Votos do candidato selecionado agrupados por bairro / local / seção. */
  function distribuicaoCandidato(por) {
    const secoes = secoesNoEscopo();
    const secaoSet = new Set(secoes.map((s) => s.secao));
    const grupos = new Map();
    for (const s of secoes) {
      const k = chaveGrupo(s, por);
      if (!grupos.has(k)) {
        grupos.set(k, { chave: k, rotulo: por === 'secao' ? 'Seção ' + s.secao : por === 'local' ? s.local : s.bairro, votos: 0, validos: 0, aptos: 0, bairro: s.bairro, local: s.local, secao: s.secao, agregadas: s.agregadas });
      }
      grupos.get(k).aptos += s.aptos;
    }
    let totalCand = 0;
    let totalValidos = 0;
    for (const v of db.votos) {
      if (v.cargo !== estado.cargo || !secaoSet.has(v.secao)) continue;
      const g = grupos.get(chaveGrupo(db.secoes.get(v.secao), por));
      if (v.tipo === 'nominal' || v.tipo === 'legenda') { g.validos += v.votos; totalValidos += v.votos; }
      if (v.tipo === 'nominal' && v.numero === estado.cand) { g.votos += v.votos; totalCand += v.votos; }
    }
    const linhas = Array.from(grupos.values())
      .sort((a, b) => b.votos - a.votos || a.chave.localeCompare(b.chave, 'pt-BR', { numeric: true }));
    return { linhas, totalCand, totalValidos, aptos: secoes.reduce((s, x) => s + x.aptos, 0) };
  }

  /** Ranking dos candidatos do cargo no escopo (município ou bairro). */
  function rankingCandidatos() {
    const secoes = secoesNoEscopo();
    const secaoSet = new Set(secoes.map((s) => s.secao));
    const votosCargo = db.votos.filter((v) => v.cargo === estado.cargo && secaoSet.has(v.secao));
    const porCand = new Map();
    const legendas = new Map();
    for (const v of votosCargo) {
      if (v.tipo === 'legenda') {
        legendas.set(v.partido, (legendas.get(v.partido) || 0) + v.votos);
        continue;
      }
      if (v.tipo !== 'nominal') continue;
      if (!porCand.has(v.numero)) porCand.set(v.numero, { numero: v.numero, nome: v.nome, partido: v.partido, coligacao: v.coligacao, votos: 0 });
      porCand.get(v.numero).votos += v.votos;
    }
    const linhas = Array.from(porCand.values())
      .sort((a, b) => b.votos - a.votos || a.nome.localeCompare(b.nome, 'pt-BR'));
    linhas.forEach((l, i) => { l.posicao = i + 1; });
    return { linhas, totais: totaisCargo(votosCargo), legendas, aptos: secoes.reduce((s, x) => s + x.aptos, 0), nSecoes: secoes.length };
  }

  // ---------- render dos controles ----------
  function opcao(valor, texto, selecionado) {
    return '<option value="' + esc(valor) + '"' + (selecionado ? ' selected' : '') + '>' + esc(texto) + '</option>';
  }

  function renderControles() {
    el.eleicao.innerHTML = manifesto.eleicoes.map((e) => opcao(e.id, e.nome, e.id === estado.eleicao)).join('');

    if (!db.cargos.includes(estado.cargo)) estado.cargo = db.cargos[0] || '';
    el.navCargos.innerHTML = db.cargos.map((c) => {
      const n = (db.candidatos.get(c) || new Map()).size;
      return '<button type="button" class="nav-item' + (c === estado.cargo ? ' ativo' : '') + '" data-cargo="' + esc(c) + '">' +
        icone(ICONE_CARGO[c] || 'i-users') + '<span>' + esc(c) + '</span><span class="contagem">' + n + '</span></button>';
    }).join('');

    if (estado.bairro && !db.bairros.includes(estado.bairro)) estado.bairro = '';
    el.bairro.innerHTML = opcao('', 'Todo o município', !estado.bairro) +
      db.bairros.map((b) => opcao(b, titulo(b), b === estado.bairro)).join('');

    const cands = Array.from((db.candidatos.get(estado.cargo) || new Map()).values()).sort((a, b) => b.total - a.total);
    if (estado.cand && !cands.some((c) => c.numero === estado.cand)) estado.cand = '';
    const q = normalizar(estado.busca);
    const filtrados = q ? cands.filter((c) => normalizar(c.numero + ' ' + c.nome + ' ' + c.partido).includes(q)) : cands;
    const rotuloTodos = 'Todos (ranking de candidatos)' + (q ? ' · ' + filtrados.length + ' encontrados' : '');
    el.candidato.innerHTML = opcao('', rotuloTodos, !estado.cand) +
      filtrados.map((c) => opcao(c.numero, c.numero + ' · ' + c.nome + ' (' + c.partido + ') — ' + fmtInt(c.total) + ' votos', c.numero === estado.cand)).join('');

    document.querySelectorAll('input[name="por"]').forEach((r) => { r.checked = r.value === estado.por; });
    if (el.busca.value !== estado.busca) el.busca.value = estado.busca;
  }

  function renderTrilha() {
    const partes = [{ texto: db.cfg.nome, acao: 'inicio' }, { texto: estado.cargo, acao: 'cargo' }];
    if (estado.bairro) partes.push({ texto: titulo(estado.bairro), acao: 'bairro' });
    if (estado.cand) {
      const c = db.candidatos.get(estado.cargo).get(estado.cand);
      partes.push({ texto: c.nome, acao: 'cand' });
    }
    el.trilha.innerHTML = partes.map((p, i) => {
      const ultimo = i === partes.length - 1;
      const item = ultimo ? '<span class="crumb atual">' + esc(p.texto) + '</span>'
        : '<button type="button" class="crumb" data-acao="' + p.acao + '">' + esc(p.texto) + '</button>';
      return (i ? '<span class="sep">›</span>' : '') + item;
    }).join('');
  }

  // ---------- render de resultados ----------
  function card(opts) {
    const linha = opts.linha
      ? '<div class="card-linha"><span class="ponto ' + (opts.linha.cor || '') + '"></span><span>' + esc(opts.linha.rotulo) + '</span>' +
        '<span class="card-valor-sec ' + (opts.linha.cor || '') + '">' + esc(opts.linha.valor) + '</span></div>'
      : '';
    const rodape = opts.rodape
      ? (opts.rodape.acao
        ? '<button type="button" class="card-rodape" data-acao="' + esc(opts.rodape.acao) + '" data-valor="' + esc(opts.rodape.valor || '') + '"><span>' + esc(opts.rodape.texto) + '</span>' + icone('i-arrow') + '</button>'
        : '<div class="card-rodape"><span>' + esc(opts.rodape.texto) + '</span></div>')
      : '';
    return '<div class="card"><div class="card-topo"><div class="card-icone">' + icone(opts.icone) + '</div>' +
      '<div><div class="card-rotulo">' + esc(opts.rotulo) + '</div><div class="card-valor">' + esc(opts.valor) + '</div></div></div>' +
      linha + rodape + '</div>';
  }

  function destaque(opts) {
    const tag = opts.acao ? 'button type="button"' : 'div';
    const fecha = opts.acao ? 'button' : 'div';
    return '<' + tag + ' class="destaque"' + (opts.acao ? ' data-acao="' + esc(opts.acao) + '" data-valor="' + esc(opts.valor) + '"' : '') + '>' +
      '<div class="destaque-icone">' + (opts.icone ? icone(opts.icone) : esc(opts.pos)) + '</div>' +
      '<div class="destaque-texto"><div class="destaque-rotulo" title="' + esc(opts.rotulo) + '">' + esc(opts.rotulo) + '</div>' +
      '<div class="destaque-valor">' + esc(opts.numero) + (opts.sub ? '<small>' + esc(opts.sub) + '</small>' : '') + '</div></div></' + fecha + '>';
  }

  function barra(valor, maximo) {
    return '<td class="barra-celula"><span class="barra" style="width:' + ((100 * valor) / maximo).toFixed(1) + '%"></span></td>';
  }

  function renderCandidato() {
    const cand = db.candidatos.get(estado.cargo).get(estado.cand);
    const d = distribuicaoCandidato(estado.por);
    const ranking = rankingCandidatos();
    const posicao = ranking.linhas.find((l) => l.numero === estado.cand);
    const escopo = estado.bairro ? 'em ' + titulo(estado.bairro) : 'em Paraipaba';
    const porBairro = estado.bairro ? null : distribuicaoCandidato('bairro');
    const maiorBairro = porBairro && porBairro.linhas[0];

    el.resumo.innerHTML = [
      card({
        icone: 'i-vote', rotulo: 'Votos ' + escopo, valor: fmtInt(d.totalCand),
        linha: { rotulo: 'Dos válidos para ' + estado.cargo + ':', valor: fmtPct(pct(d.totalCand, d.totalValidos)), cor: 'verde' },
        rodape: { texto: cand.numero + ' · ' + cand.partido + (cand.coligacao && cand.coligacao !== cand.partido ? ' · ' + cand.coligacao : '') },
      }),
      card({
        icone: 'i-trophy', rotulo: 'Posição no ranking ' + escopo, valor: posicao ? posicao.posicao + 'º' : '—',
        linha: { rotulo: 'Candidatos com votos:', valor: fmtInt(ranking.linhas.length), cor: '' },
        rodape: { texto: 'Ver ranking completo', acao: 'ranking' },
      }),
      maiorBairro && maiorBairro.votos > 0
        ? card({
          icone: 'i-pin', rotulo: 'Bairro com mais votos', valor: titulo(maiorBairro.bairro),
          linha: { rotulo: 'Votos no bairro:', valor: fmtInt(maiorBairro.votos) + ' (' + fmtPct(pct(maiorBairro.votos, maiorBairro.validos)) + ')', cor: 'verde' },
          rodape: { texto: 'Ver seções do bairro', acao: 'bairro', valor: maiorBairro.bairro },
        })
        : card({
          icone: 'i-pin', rotulo: 'Seções ' + escopo, valor: fmtInt(secoesNoEscopo().length),
          linha: { rotulo: 'Eleitores aptos:', valor: fmtInt(d.aptos), cor: '' },
          rodape: { texto: 'Ver todo o município', acao: 'bairro', valor: '' },
        }),
      card({
        icone: 'i-chart', rotulo: 'Votos válidos ' + escopo, valor: fmtInt(d.totalValidos),
        linha: { rotulo: 'Eleitores aptos:', valor: fmtInt(d.aptos), cor: 'laranja' },
        rodape: { texto: 'Comparecimento e brancos/nulos no ranking', acao: 'ranking' },
      }),
    ].join('');

    // destaques laterais: top 5 do agrupamento atual
    el.tituloDestaques.textContent = 'Top ' + NOME_POR[estado.por] + (estado.por === 'local' ? 'is' : 's');
    const top = d.linhas.filter((g) => g.votos > 0).slice(0, 5);
    el.destaques.innerHTML = top.map((g, i) => destaque({
      pos: i + 1, rotulo: estado.por === 'secao' ? g.rotulo + ' · ' + titulo(g.bairro) : titulo(g.rotulo),
      numero: fmtInt(g.votos), sub: fmtPct(pct(g.votos, g.validos)) + ' dos válidos',
      acao: estado.por !== 'secao' ? 'bairro' : '', valor: g.bairro,
    })).join('') || '<div class="vazio">Sem votos neste recorte.</div>';

    const nomePor = NOME_POR_CAB[estado.por];
    el.titulo.textContent = cand.nome + ' — votos por ' + nomePor.toLowerCase() + ' ' + escopo;
    el.dica.textContent = estado.por === 'secao' ? '' : 'Clique em uma linha para ver as seções do bairro.';

    const extrasCab = estado.por === 'secao' ? '<th>Local</th><th>Bairro</th>' : estado.por === 'local' ? '<th>Bairro</th>' : '';
    el.thead.innerHTML = '<tr><th class="pos">#</th><th>' + nomePor + '</th>' + extrasCab +
      '<th class="num">Votos</th><th class="num">% dos válidos</th><th class="num">% do candidato</th>' +
      '<th class="barra-celula"></th><th class="num">Válidos</th><th class="num">Aptos</th></tr>';

    const maxVotos = Math.max(1, ...d.linhas.map((l) => l.votos));
    const clicavel = estado.por !== 'secao';
    el.tbody.innerHTML = d.linhas.map((g, i) => {
      const extras = estado.por === 'secao'
        ? '<td class="texto">' + esc(titulo(g.local)) + '</td><td>' + esc(titulo(g.bairro)) + '</td>'
        : estado.por === 'local' ? '<td>' + esc(titulo(g.bairro)) + '</td>' : '';
      const rotulo = estado.por === 'secao'
        ? esc(g.rotulo) + (g.agregadas ? ' <span class="tag">agrega ' + esc(g.agregadas) + '</span>' : '')
        : esc(titulo(g.rotulo));
      return '<tr class="' + (clicavel ? 'clicavel' : '') + '" data-bairro="' + esc(g.bairro) + '">' +
        '<td class="pos">' + (i + 1) + '</td><td class="texto">' + rotulo + '</td>' + extras +
        '<td class="num"><strong>' + fmtInt(g.votos) + '</strong></td>' +
        '<td class="num">' + fmtPct(pct(g.votos, g.validos)) + '</td>' +
        '<td class="num">' + fmtPct(pct(g.votos, d.totalCand)) + '</td>' +
        barra(g.votos, maxVotos) +
        '<td class="num">' + fmtInt(g.validos) + '</td><td class="num">' + fmtInt(g.aptos) + '</td></tr>';
    }).join('') || '<tr><td colspan="9" class="vazio">Nenhum resultado.</td></tr>';

    const colspan = 2 + (estado.por === 'secao' ? 2 : estado.por === 'local' ? 1 : 0);
    el.tfoot.innerHTML = '<tr><td colspan="' + colspan + '">Total ' + esc(escopo) + '</td>' +
      '<td class="num">' + fmtInt(d.totalCand) + '</td><td class="num">' + fmtPct(pct(d.totalCand, d.totalValidos)) + '</td>' +
      '<td class="num">100,0%</td><td></td><td class="num">' + fmtInt(d.totalValidos) + '</td><td class="num">' + fmtInt(d.aptos) + '</td></tr>';
  }

  function renderRanking() {
    const r = rankingCandidatos();
    const t = r.totais;
    const escopo = estado.bairro ? 'em ' + titulo(estado.bairro) : 'em Paraipaba';

    el.resumo.innerHTML = [
      card({
        icone: 'i-users', rotulo: 'Eleitores aptos ' + escopo, valor: fmtInt(r.aptos),
        linha: { rotulo: 'Seções eleitorais:', valor: fmtInt(r.nSecoes), cor: '' },
        rodape: estado.bairro ? { texto: 'Ver todo o município', acao: 'bairro', valor: '' } : { texto: db.cfg.data ? 'Votação em ' + db.cfg.data.split('-').reverse().join('/') : '' },
      }),
      card({
        icone: 'i-check', rotulo: 'Comparecimento', valor: fmtInt(t.comparecimento),
        linha: { rotulo: 'Abstenção:', valor: fmtPct(pct(r.aptos - t.comparecimento, r.aptos)), cor: 'vermelho' },
        rodape: { texto: fmtPct(pct(t.comparecimento, r.aptos)) + ' dos aptos compareceram' },
      }),
      card({
        icone: 'i-vote', rotulo: 'Votos válidos · ' + estado.cargo, valor: fmtInt(t.validos),
        linha: { rotulo: 'Votos de legenda:', valor: fmtInt(t.legenda), cor: '' },
        rodape: { texto: 'Nominais: ' + fmtInt(t.nominal) },
      }),
      card({
        icone: 'i-flag', rotulo: 'Brancos e nulos', valor: fmtInt(t.branco + t.nulo),
        linha: { rotulo: 'Do comparecimento:', valor: fmtPct(pct(t.branco + t.nulo, t.comparecimento)), cor: 'laranja' },
        rodape: { texto: 'Brancos ' + fmtInt(t.branco) + ' · nulos ' + fmtInt(t.nulo) },
      }),
    ].join('');

    el.tituloDestaques.textContent = 'Mais votados ' + escopo;
    el.destaques.innerHTML = r.linhas.slice(0, 5).map((l) => destaque({
      pos: l.posicao + 'º', rotulo: l.nome + ' · ' + l.partido, numero: fmtInt(l.votos), sub: fmtPct(pct(l.votos, t.validos)),
      acao: 'cand', valor: l.numero,
    })).join('') || '<div class="vazio">Sem votos neste recorte.</div>';

    el.titulo.textContent = 'Ranking · ' + estado.cargo + ' ' + escopo;
    el.dica.textContent = 'Clique em um candidato para ver os votos por ' + NOME_POR[estado.por] + '.';
    el.thead.innerHTML = '<tr><th class="pos">#</th><th>Candidato</th><th>Partido</th>' +
      '<th class="num">Votos</th><th class="num">% dos válidos</th><th class="barra-celula"></th></tr>';

    const q = normalizar(estado.busca);
    const linhas = q ? r.linhas.filter((l) => normalizar(l.numero + ' ' + l.nome + ' ' + l.partido).includes(q)) : r.linhas;
    const maxVotos = Math.max(1, ...r.linhas.map((l) => l.votos));
    let html = linhas.map((l) => '<tr class="clicavel" data-cand="' + esc(l.numero) + '">' +
      '<td class="pos">' + l.posicao + '</td>' +
      '<td class="texto"><strong>' + esc(l.nome) + '</strong><span class="mono">' + esc(l.numero) + '</span></td>' +
      '<td>' + esc(l.partido) + '</td><td class="num"><strong>' + fmtInt(l.votos) + '</strong></td>' +
      '<td class="num">' + fmtPct(pct(l.votos, t.validos)) + '</td>' + barra(l.votos, maxVotos) + '</tr>').join('');
    if (!q && r.legendas.size) {
      html += Array.from(r.legendas.entries()).sort((a, b) => b[1] - a[1]).map(([partido, v]) =>
        '<tr class="secundario"><td class="pos"></td><td class="texto">Votos de legenda</td><td>' + esc(partido) + '</td>' +
        '<td class="num">' + fmtInt(v) + '</td><td class="num">' + fmtPct(pct(v, t.validos)) + '</td><td></td></tr>').join('');
    }
    el.tbody.innerHTML = html || '<tr><td colspan="6" class="vazio">Nenhum candidato encontrado para "' + esc(estado.busca) + '".</td></tr>';
    el.tfoot.innerHTML = '<tr><td colspan="3">Válidos ' + esc(escopo) + '</td><td class="num">' + fmtInt(t.validos) + '</td>' +
      '<td class="num">100,0%</td><td></td></tr>';
  }

  function render(empilhar) {
    if (!db) return;
    renderControles();
    renderTrilha();
    if (estado.cand) renderCandidato(); else renderRanking();
    gravarHash(empilhar);
  }

  function mostrarErro(e) {
    el.status.textContent = 'Erro ao carregar os dados: ' + e.message + '. Abra a página por um servidor HTTP (veja o README).';
    el.status.classList.add('erro');
    console.error(e);
  }

  async function trocarEleicao(id) {
    try {
      await carregarEleicao(id);
      render(false);
    } catch (e) {
      mostrarErro(e);
    }
  }

  /** Ações de navegação usadas por cartões, destaques, trilha e tabela. */
  function executarAcao(acao, valor) {
    if (acao === 'inicio') { estado.cand = ''; estado.bairro = ''; estado.busca = ''; }
    else if (acao === 'cargo') { estado.cand = ''; estado.busca = ''; }
    else if (acao === 'ranking') { estado.cand = ''; }
    else if (acao === 'cand') { estado.cand = valor; estado.busca = ''; }
    else if (acao === 'bairro') { estado.bairro = valor; if (estado.cand && valor) estado.por = 'secao'; }
    render(true);
    if (acao === 'cand') window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ---------- eventos ----------
  el.eleicao.addEventListener('change', () => { estado.cand = ''; trocarEleicao(el.eleicao.value); });
  el.navCargos.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-cargo]');
    if (!b) return;
    estado.cargo = b.dataset.cargo; estado.cand = ''; estado.busca = '';
    render(true);
  });
  el.candidato.addEventListener('change', () => { estado.cand = el.candidato.value; render(true); });
  el.bairro.addEventListener('change', () => { estado.bairro = el.bairro.value; render(true); });
  el.busca.addEventListener('input', () => { estado.busca = el.busca.value; render(false); });
  document.querySelectorAll('input[name="por"]').forEach((r) => {
    r.addEventListener('change', () => { if (r.checked) { estado.por = r.value; render(true); } });
  });
  el.limpar.addEventListener('click', () => { estado.cand = ''; estado.bairro = ''; estado.busca = ''; estado.por = 'bairro'; render(true); });
  el.voltar.addEventListener('click', () => history.back());
  el.avancar.addEventListener('click', () => history.forward());

  document.addEventListener('click', (ev) => {
    const alvo = ev.target.closest('[data-acao]');
    if (alvo) { executarAcao(alvo.dataset.acao, alvo.dataset.valor || ''); return; }
    const tr = ev.target.closest('#tabela tbody tr.clicavel');
    if (!tr) return;
    if (tr.dataset.cand) executarAcao('cand', tr.dataset.cand);
    else if (tr.dataset.bairro) executarAcao('bairro', tr.dataset.bairro);
  });

  window.addEventListener('popstate', () => {
    if (ignorarHashchange) return;
    const anterior = estado.eleicao;
    lerHash();
    if (estado.eleicao !== anterior) trocarEleicao(estado.eleicao); else render(false);
  });

  // ---------- início ----------
  (async function init() {
    el.linkRepo.href = REPO_URL;
    try {
      const resp = await fetch('data/eleicoes.json', { cache: 'no-cache' });
      if (!resp.ok) throw new Error('data/eleicoes.json (' + resp.status + ')');
      manifesto = await resp.json();
      estado.eleicao = manifesto.eleicoes[0].id;
      lerHash();
      await trocarEleicao(estado.eleicao);
    } catch (e) {
      mostrarErro(e);
    }
  })();
})();
