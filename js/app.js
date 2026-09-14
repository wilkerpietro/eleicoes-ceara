/* Eleições Ceará — consulta de votação por município, bairro, local e seção.
   Sem build: carrega os CSVs em data/ e monta as telas no navegador.
   O mapa usa Leaflet (carregado no index.html) e as coordenadas de data/bairros.json. */
(function () {
  'use strict';

  const ORDEM_CARGOS = ['Presidente', 'Governador', 'Senador', 'Deputado Federal', 'Deputado Estadual', 'Prefeito', 'Vereador'];
  const ICONE_CARGO = { Presidente: 'i-flag', Governador: 'i-building', Senador: 'i-users', 'Deputado Federal': 'i-users', 'Deputado Estadual': 'i-users', Prefeito: 'i-building', Vereador: 'i-users' };
  const REPO_URL = 'https://github.com/wilkerpietro/eleicoes-ceara';
  const TELAS = ['tabela', 'mapa', 'liderancas', 'estimativa', 'candidatos26', 'usuarios'];
  const TELAS_2026 = { liderancas: 'liderancas', estimativa: 'estimativa', candidatos26: 'candidatos', usuarios: 'usuarios' }; // tela do app -> tela do módulo
  const NOME_TELA = { mapa: 'Mapa', liderancas: 'Lideranças', estimativa: 'Estimativa 2026', candidatos26: 'Candidatos 2026', usuarios: 'Usuários' };
  const NOME_POR = { bairro: 'bairro', local: 'local de votação', secao: 'seção' };
  const NOME_POR_CAB = { bairro: 'Bairro', local: 'Local de votação', secao: 'Seção' };
  const TILES_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const TILES_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  // Paleta categórica (ordem fixa, validada para daltonismo) usada na pizza de bairros da tela de tabelas.
  const CORES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'];
  const COR_OUTROS = '#c9ccd1';
  const COR_SELECAO = '#b45309';
  // Cores fixas por partido (sigla como aparece nos dados do TSE).
  const CORES_PARTIDO = {
    'PT': '#d0021b', 'PL': '#1a3c8f', 'PDT': '#f07f1c', 'MDB': '#1e8e3e', 'PSD': '#f2c500', 'UNIÃO': '#5ab4f0',
    'PP': '#00acc1', 'PSB': '#e4488f', 'REPUBLICANOS': '#00695c', 'PSDB': '#0b6fd1', 'AVANTE': '#a0522d',
    'PSOL': '#8e24aa', 'NOVO': '#ffa000', 'PC DO B': '#8b0000', 'PV': '#9ccc65', 'CIDADANIA': '#ba68c8',
    'PTB': '#37474f', 'PMN': '#6d4c41', 'PODE': '#5c6bc0', 'SOLIDARIEDADE': '#ff7043', 'PSC': '#2e7d32',
    'PATRIOTA': '#283593', 'DC': '#1565c0', 'PSTU': '#b71c1c', 'PCB': '#880e4f', 'PCO': '#4e342e',
    'PMB': '#f48fb1', 'PRTB': '#455a64', 'AGIR': '#ffca28', 'PROS': '#ff8a65', 'UP': '#6a1b9a', 'REDE': '#66bb6a',
    'PRD': '#3f51b5', 'MOBILIZA': '#795548', 'MISSÃO': '#0097a7', 'DEMOCRATA': '#7b1fa2',
  };
  const CORES_PARTIDO_RESERVA = ['#90a4ae', '#78909c', '#8d6e63', '#a1887f', '#bdbdbd', '#9e9e9e'];

  const $ = (sel) => document.querySelector(sel);
  const el = {
    navEleicoes: $('#nav-eleicoes'),
    municipio: $('#sel-municipio'),
    navTelas: $('#nav-telas'),
    candidato: $('#sel-candidato'),
    bairro: $('#sel-bairro'),
    busca: $('#inp-busca'),
    campoPor: $('#campo-por'),
    limpar: $('#btn-limpar'),
    voltar: $('#btn-voltar'),
    avancar: $('#btn-avancar'),
    trilha: $('#trilha'),
    status: $('#status'),
    resumo: $('#resumo'),
    gradeTabela: $('#grade-tabela'),
    gradeMapa: $('#grade-mapa'),
    telaLiderancas: $('#tela-liderancas'),
    filtros: $('.filtros'),
    titulo: $('#titulo-tabela'),
    dica: $('#dica-tabela'),
    thead: $('#tabela thead'),
    tbody: $('#tabela tbody'),
    tfoot: $('#tabela tfoot'),
    rodapeTabela: $('#rodape-tabela'),
    rodapeMapa: $('#rodape-mapa'),
    tituloMapa: $('#titulo-mapa'),
    dicaMapa: $('#dica-mapa'),
    mapa: $('#mapa'),
    mapaAviso: $('#mapa-aviso'),
    legendaMapa: $('#legenda-mapa'),
    tituloBairro: $('#titulo-bairro'),
    detalheBairro: $('#detalhe-bairro'),
    fonte: $('#fonte'),
    linkRepo: $('#link-repo'),
  };

  const estado = { eleicao: '', mun: '', cargo: '', cand: '', bairro: '', por: 'bairro', busca: '', tela: 'tabela' };
  let manifesto = null;
  let menuRecolhido = false; // cargos da eleição ativa recolhidos no menu lateral
  let cargosNomes = {}; // código do cargo -> nome
  let partidosPorAno = {}; // ano -> {número -> sigla}
  let geoTodos = {}; // cd_municipio -> [{nome, lat, lng}]
  let malhaCeara = null; // GeoJSON com o contorno dos 184 municípios (mapa do agregado estadual)
  let geo = new Map(); // nome do bairro -> {lat, lng} (município atual)
  const TODOS = 'todos'; // código do agregado estadual
  const nomeMun = () => (db && db.mun ? (db.mun.cd === TODOS ? 'Ceará' : titulo(db.mun.nome)) : '');
  const noEstado = () => !!(db && db.mun && db.mun.cd === TODOS);
  const emMun = () => (noEstado() ? 'no Ceará' : 'em ' + nomeMun());
  let db = null; // dados da eleição carregada
  const mapa = { obj: null, camada: null, marcadores: new Map(), ajustado: false };
  const expandido = { tabela: false, mapa: false }; // listas de candidatos com "ver todos" aberto

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
    estado.mun = p.get('m') || estado.mun;
    estado.cargo = p.get('cargo') || '';
    estado.cand = p.get('cand') || '';
    estado.bairro = p.get('bairro') || '';
    estado.por = ['bairro', 'local', 'secao'].includes(p.get('por')) ? p.get('por') : 'bairro';
    estado.busca = p.get('q') || '';
    estado.tela = TELAS.includes(p.get('tela')) ? p.get('tela') : 'tabela';
  }

  function hashAtual() {
    const p = new URLSearchParams();
    if (estado.eleicao) p.set('e', estado.eleicao);
    if (estado.mun) p.set('m', estado.mun);
    if (estado.tela !== 'tabela') p.set('tela', estado.tela);
    if (estado.cargo) p.set('cargo', estado.cargo);
    if (estado.cand) p.set('cand', estado.cand);
    if (estado.bairro) p.set('bairro', estado.bairro);
    if (estado.por !== 'bairro') p.set('por', estado.por);
    if (estado.busca) p.set('q', estado.busca);
    return '#' + p.toString();
  }

  let ignorarPopstate = false;
  function gravarHash(empilhar) {
    const novo = hashAtual();
    if (novo === location.hash) return;
    ignorarPopstate = true;
    if (empilhar) history.pushState(null, '', novo); else history.replaceState(null, '', novo);
    setTimeout(() => { ignorarPopstate = false; }, 0);
  }

  // ---------- carga de dados ----------
  async function carregarJson(url, padrao) {
    try {
      const resp = await fetch(url, { cache: 'no-cache' });
      if (!resp.ok) throw new Error(url + ' (' + resp.status + ')');
      return await resp.json();
    } catch (e) {
      console.warn('Arquivo auxiliar indisponível:', e);
      return padrao;
    }
  }

  /** Tabelas auxiliares: cargos, partidos e geolocalização dos bairros (por município). */
  async function carregarAuxiliares() {
    const [cargos, partidos, bairros, malha] = await Promise.all([
      carregarJson('data/cargos.json', {}), carregarJson('data/partidos.json', {}), carregarJson('data/bairros.json', {}),
      carregarJson('data/ceara-municipios.geojson', null),
    ]);
    cargosNomes = cargos;
    partidosPorAno = partidos;
    geoTodos = bairros.municipios || {};
    malhaCeara = malha && malha.features ? malha : null;
  }

  function selecionarGeo(cd) {
    geo = new Map((geoTodos[cd] || []).filter((b) => b.lat != null && b.lng != null).map((b) => [b.nome, { lat: b.lat, lng: b.lng }]));
  }

  const CARGOS_PROPORCIONAIS = new Set(['Deputado Federal', 'Deputado Estadual', 'Vereador']);

  /** Lista de municípios de uma eleição (carregada uma vez por eleição). */
  async function municipiosDe(cfg) {
    if (!cfg._municipios) {
      const lista = await carregarJson(cfg.municipios, []);
      cfg._municipios = lista.slice().sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    }
    return cfg._municipios;
  }

  async function carregarEleicao(id, cd) {
    const cfg = manifesto.eleicoes.find((e) => e.id === id) || manifesto.eleicoes[0];
    estado.eleicao = cfg.id;
    el.status.textContent = 'Carregando ' + cfg.nome + '…';
    el.status.classList.remove('erro');

    const municipios = await municipiosDe(cfg);
    let mun = null;
    if (cd === TODOS && cfg.agregado_estado) mun = { cd: TODOS, nome: 'TODOS OS MUNICÍPIOS' };
    else mun = municipios.find((m) => m.cd === cd) || municipios.find((m) => m.cd === manifesto.municipio_padrao) || municipios[0];
    if (!mun) throw new Error('nenhum município disponível em ' + cfg.nome);
    estado.mun = mun.cd;
    const pasta = cfg.pasta + mun.cd + '/';
    // no agregado estadual, o "bairro" é o município
    NOME_POR.bairro = mun.cd === TODOS ? 'município' : 'bairro';
    NOME_POR_CAB.bairro = mun.cd === TODOS ? 'Município' : 'Bairro';
    const ano = String(cfg.ano);
    const partidos = partidosPorAno[ano] || {};

    const [secoesCsv, votosCsv, cadastroCsv] = await Promise.all([
      Csv.carregarCsv(pasta + 'secoes.csv'),
      Csv.carregarCsv(pasta + 'votos.csv'),
      Csv.carregarCsv(pasta + 'candidatos.csv').catch((e) => { console.warn('Cadastro de candidatos indisponível:', e); return []; }),
    ]);
    // cadastro (nome de urna, partido, situação, foto) indexado por cargo|numero
    const cadastro = new Map();
    for (const c of cadastroCsv) {
      cadastro.set(c.cargo + '|' + c.numero, {
        sq: c.sq, nome: c.nome, nome_urna: c.nome_urna || c.nome, partido: c.partido, situacao: c.situacao || '',
        genero: c.genero || '', ocupacao: c.ocupacao || '', foto: c.foto ? (cfg.fotos || '') + c.foto : '',
      });
    }

    const secoes = new Map();
    for (const s of secoesCsv) {
      secoes.set(s.secao, {
        secao: s.secao, zona: s.zona, cod_local: s.cod_local, local: s.local, endereco: s.endereco,
        bairro: s.bairro || '', cep: s.cep, aptos: parseInt(s.aptos, 10) || 0, agregadas: s.agregadas || '',
      });
    }
    const temBairros = Array.from(secoes.values()).some((s) => s.bairro);
    if (!temBairros) for (const s of secoes.values()) s.bairro = '';

    const votos = [];
    const cargosSet = new Set();
    for (const v of votosCsv) {
      const cargo = cargosNomes[v.cargo] || v.cargo;
      const numero = v.numero;
      const reg = { secao: v.secao, cargo, numero, votos: parseInt(v.votos, 10) || 0, coligacao: '' };
      const cad = cadastro.get(cargo + '|' + numero);
      if (numero === '95') { reg.tipo = 'branco'; reg.nome = 'BRANCOS'; reg.partido = ''; }
      else if (numero === '96') { reg.tipo = 'nulo'; reg.nome = 'NULOS'; reg.partido = ''; }
      else if (CARGOS_PROPORCIONAIS.has(cargo) && numero.length <= 2) { reg.tipo = 'legenda'; reg.partido = partidos[numero] || numero; reg.nome = 'LEGENDA ' + reg.partido; }
      else {
        reg.tipo = 'nominal';
        reg.nome = cad ? cad.nome_urna : (v.nome || 'CANDIDATO ' + numero);
        reg.partido = cad && cad.partido ? cad.partido : (v.partido || partidos[numero.slice(0, 2)] || numero.slice(0, 2));
      }
      if (!secoes.has(reg.secao)) {
        secoes.set(reg.secao, { secao: reg.secao, zona: v.zona, cod_local: '', local: 'Local não informado', endereco: '', bairro: temBairros ? 'BAIRRO NÃO INFORMADO' : '', cep: '', aptos: 0, agregadas: '' });
      }
      votos.push(reg);
      cargosSet.add(cargo);
    }

    // candidatos por cargo (apenas votos nominais)
    const candidatos = new Map(); // cargo -> Map(numero -> candidato)
    for (const v of votos) {
      if (v.tipo !== 'nominal') continue;
      if (!candidatos.has(v.cargo)) candidatos.set(v.cargo, new Map());
      const m = candidatos.get(v.cargo);
      if (!m.has(v.numero)) m.set(v.numero, { numero: v.numero, nome: v.nome, partido: v.partido, coligacao: '', total: 0, cadastro: cadastro.get(v.cargo + '|' + v.numero) || null });
      m.get(v.numero).total += v.votos;
    }

    const bairros = temBairros
      ? Array.from(new Set(Array.from(secoes.values()).map((s) => s.bairro))).sort((a, b) => a.localeCompare(b, 'pt-BR'))
      : [];
    const temAptos = Array.from(secoes.values()).some((s) => s.aptos > 0);

    selecionarGeo(mun.cd);
    db = { cfg, mun, municipios, secoes, votos, cargos: ordenarCargos(Array.from(cargosSet)), candidatos, bairros, temBairros, temAptos };
    mapa.ajustado = false;
    if (!temBairros) { estado.bairro = ''; if (estado.por === 'bairro') estado.por = 'local'; }
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

  /** Votos do candidato selecionado agrupados por bairro / local / seção (dentro do escopo). */
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

  /** Resumo de todos os bairros do município para o cargo atual (usado pelo mapa). */
  function resumoBairros() {
    const porBairro = new Map();
    for (const s of db.secoes.values()) {
      if (!porBairro.has(s.bairro)) porBairro.set(s.bairro, { bairro: s.bairro, aptos: 0, nSecoes: 0, nominal: 0, legenda: 0, branco: 0, nulo: 0, votosCand: 0, cands: new Map(), legendas: new Map() });
      const r = porBairro.get(s.bairro);
      r.aptos += s.aptos;
      r.nSecoes += 1;
    }
    for (const v of db.votos) {
      if (v.cargo !== estado.cargo) continue;
      const r = porBairro.get(db.secoes.get(v.secao).bairro);
      r[v.tipo] += v.votos;
      if (v.tipo === 'legenda') r.legendas.set(v.partido, (r.legendas.get(v.partido) || 0) + v.votos);
      if (v.tipo !== 'nominal') continue;
      if (v.numero === estado.cand) r.votosCand += v.votos;
      if (!r.cands.has(v.numero)) r.cands.set(v.numero, { numero: v.numero, nome: v.nome, partido: v.partido, votos: 0 });
      r.cands.get(v.numero).votos += v.votos;
    }
    for (const r of porBairro.values()) {
      r.validos = r.nominal + r.legenda;
      r.comparecimento = r.validos + r.branco + r.nulo;
      r.ranking = Array.from(r.cands.values()).sort((a, b) => b.votos - a.votos || a.nome.localeCompare(b.nome, 'pt-BR'));
      r.ranking.forEach((c, i) => { c.posicao = i + 1; });
      r.posicaoCand = estado.cand ? (r.ranking.findIndex((c) => c.numero === estado.cand) + 1) || null : null;
    }
    return porBairro;
  }

  // ---------- render dos controles ----------
  function opcao(valor, texto, selecionado) {
    return '<option value="' + esc(valor) + '"' + (selecionado ? ' selected' : '') + '>' + esc(texto) + '</option>';
  }

  function renderControles() {
    if (!db.cargos.includes(estado.cargo)) estado.cargo = db.cargos[0] || '';

    // eleições como itens de menu; os cargos da eleição atual aparecem aninhados abaixo dela
    el.navEleicoes.innerHTML = manifesto.eleicoes.map((e) => {
      const ativa = e.id === estado.eleicao;
      const aberta = ativa && !menuRecolhido;
      const destacada = ativa && !(estado.tela in TELAS_2026); // nas telas de 2026 o destaque vai para "Candidatos 2026"
      let html = '<button type="button" class="nav-item nav-eleicao' + (destacada ? ' ativo' : '') + (aberta ? ' aberta' : '') + '" data-eleicao="' + esc(e.id) + '" aria-expanded="' + aberta + '" title="' + (ativa ? (aberta ? 'Recolher os cargos' : 'Mostrar os cargos') : 'Abrir esta eleição') + '">' +
        icone('i-vote') + '<span>' + esc(e.nome_curto || e.nome) + '</span>' + icone('i-right', 'seta') + '</button>';
      if (aberta) {
        html += '<div class="nav-sub">' + db.cargos.map((c) => {
          const n = (db.candidatos.get(c) || new Map()).size;
          return '<button type="button" class="nav-item' + (c === estado.cargo ? ' ativo' : '') + '" data-cargo="' + esc(c) + '">' +
            icone(ICONE_CARGO[c] || 'i-users') + '<span>' + esc(c) + '</span><span class="contagem">' + n + '</span></button>';
        }).join('') + '</div>';
      }
      return html;
    }).join('') +
      // o cadastro de candidatos de 2026 fica ao lado das eleições, no mesmo padrão visual
      '<button type="button" class="nav-item nav-eleicao" data-tela="candidatos26" title="Candidatos registrados no TSE para 2026">' +
      icone('i-vote') + '<span>Candidatos 2026</span></button>';

    const temTodos = !!db.cfg.agregado_estado;
    el.municipio.innerHTML = '<option value="' + TODOS + '"' + (estado.mun === TODOS ? ' selected' : '') + (temTodos ? '' : ' disabled') + '>' +
      'Todos os municípios (Ceará)' + (temTodos ? '' : ' — indisponível: candidatos diferentes em cada município') + '</option>' +
      db.municipios.map((m) => opcao(m.cd, titulo(m.nome), m.cd === estado.mun)).join('');
    document.title = 'Eleições ' + nomeMun() + ' · Votação por ' + (noEstado() ? 'município' : 'bairro e seção');

    // sem bairros cadastrados, esconde o filtro e a opção "Bairro"; no agregado estadual só existe "Município"
    el.bairro.parentElement.hidden = !db.temBairros || noEstado();
    el.bairro.previousElementSibling && (el.bairro.previousElementSibling.textContent = NOME_POR_CAB.bairro);
    document.querySelectorAll('input[name="por"]').forEach((r) => {
      const rotulo = r.nextElementSibling;
      if (r.value === 'bairro') { r.parentElement.hidden = !db.temBairros; if (rotulo) rotulo.textContent = NOME_POR_CAB.bairro; }
      else r.parentElement.hidden = noEstado();
    });
    if (!db.temBairros && estado.por === 'bairro') estado.por = 'local';
    if (noEstado()) estado.por = 'bairro';
    document.querySelectorAll('.lateral [data-tela]').forEach((b) => b.classList.toggle('ativo', b.dataset.tela === estado.tela));

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
    el.campoPor.hidden = estado.tela !== 'tabela';
    if (el.busca.value !== estado.busca) el.busca.value = estado.busca;
  }

  function renderTrilha() {
    const partes = [{ texto: db.cfg.nome, acao: 'inicio' }, { texto: nomeMun(), acao: 'inicio' }];
    if (estado.tela === 'mapa') partes.push({ texto: 'Mapa', acao: 'tela', valor: 'mapa' });
    if (estado.tela in TELAS_2026) {
      partes.push({ texto: NOME_TELA[estado.tela], acao: 'tela', valor: estado.tela });
      el.trilha.innerHTML = partes.map((p, i) => (i ? '<span class="sep">›</span>' : '') + (i === partes.length - 1
        ? '<span class="crumb atual">' + esc(p.texto) + '</span>'
        : '<button type="button" class="crumb" data-acao="' + p.acao + '" data-valor="' + esc(p.valor || '') + '">' + esc(p.texto) + '</button>')).join('');
      return;
    }
    partes.push({ texto: estado.cargo, acao: 'cargo' });
    if (estado.bairro) partes.push({ texto: titulo(estado.bairro), acao: 'bairro', valor: estado.bairro });
    if (estado.cand) {
      const c = db.candidatos.get(estado.cargo).get(estado.cand);
      partes.push({ texto: c.nome, acao: 'cand', valor: c.numero });
    }
    el.trilha.innerHTML = partes.map((p, i) => {
      const ultimo = i === partes.length - 1;
      const item = ultimo ? '<span class="crumb atual">' + esc(p.texto) + '</span>'
        : '<button type="button" class="crumb" data-acao="' + p.acao + '" data-valor="' + esc(p.valor || '') + '">' + esc(p.texto) + '</button>';
      return (i ? '<span class="sep">›</span>' : '') + item;
    }).join('');
  }

  // ---------- componentes ----------
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
    const capa = opts.foto ? '<div class="card-icone card-foto">' + opts.foto + '</div>' : '<div class="card-icone">' + icone(opts.icone) + '</div>';
    return '<div class="card"><div class="card-topo">' + capa +
      '<div><div class="card-rotulo">' + esc(opts.rotulo) + '</div><div class="card-valor">' + esc(opts.valor) + (opts.selo || '') + '</div></div></div>' +
      linha + rodape + '</div>';
  }

  function destaque(opts) {
    const tag = opts.acao ? 'button type="button"' : 'div';
    const fecha = opts.acao ? 'button' : 'div';
    return '<' + tag + ' class="destaque"' + (opts.acao ? ' data-acao="' + esc(opts.acao) + '" data-valor="' + esc(opts.valor) + '"' : '') + '>' +
      '<div class="destaque-icone">' + (opts.icone ? icone(opts.icone) : esc(opts.pos)) + '</div>' +
      '<div class="destaque-texto"><div class="destaque-rotulo" title="' + esc(opts.rotulo) + '">' +
      (opts.cor ? '<span class="ponto-cor" style="background:' + opts.cor + '"></span>' : '') + esc(opts.rotulo) + '</div>' +
      '<div class="destaque-valor">' + esc(opts.numero) + (opts.sub ? '<small>' + esc(opts.sub) + '</small>' : '') + '</div></div></' + fecha + '>';
  }

  function barra(valor, maximo) {
    return '<td class="barra-celula"><span class="barra" style="width:' + ((100 * valor) / maximo).toFixed(1) + '%"></span></td>';
  }

  /** Cadastro (nome completo, situação, foto) de um candidato do cargo atual, se houver. */
  function cadastroDe(numero, cargo) {
    const c = (db.candidatos.get(cargo || estado.cargo) || new Map()).get(numero);
    return c && c.cadastro ? c.cadastro : null;
  }

  /** Foto do candidato com iniciais como reserva (a imagem some se não carregar). */
  function avatar(nome, numero, tamanho, cargo) {
    const cad = cadastroDe(numero, cargo);
    const iniciais = String(nome || '').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
    const img = cad && cad.foto ? '<img src="' + esc(cad.foto) + '" alt="" loading="lazy" onerror="this.remove()">' : '';
    return '<span class="avatar" style="width:' + tamanho + 'px;height:' + tamanho + 'px">' + img + '<span class="iniciais">' + esc(iniciais) + '</span></span>';
  }

  /** Selo de situação (Eleito / Suplente) a partir da totalização do TSE. */
  function seloSituacao(numero, cargo) {
    const cad = cadastroDe(numero, cargo);
    if (!cad || !cad.situacao) return '';
    const s = cad.situacao.toUpperCase();
    if (s.startsWith('ELEITO')) return '<span class="selo eleito" title="' + esc(cad.situacao) + '">Eleito</span>';
    if (s.includes('SUPLENTE')) return '<span class="selo suplente">Suplente</span>';
    if (s.includes('2º TURNO') || s.includes('2O TURNO')) return '<span class="selo turno">2º turno</span>';
    return '';
  }

  /** Gráfico de pizza em SVG. fatias: [{valor, cor}]; opts: {anel, titulo}. */
  function svgPizza(fatias, diametro, opts) {
    opts = opts || {};
    const total = fatias.reduce((s, f) => s + Math.max(0, f.valor), 0);
    const cx = diametro / 2;
    const cy = diametro / 2;
    const margem = opts.anel ? 3 : 1;
    const r = diametro / 2 - margem;
    const traco = opts.traco == null ? 1.5 : opts.traco;
    const borda = traco > 0 ? ' stroke="#fff" stroke-width="' + traco + '" stroke-linejoin="round"' : '';
    let html = '<svg width="' + diametro + '" height="' + diametro + '" viewBox="0 0 ' + diametro + ' ' + diametro + '" role="img" aria-label="' + esc(opts.titulo || 'Gráfico de pizza') + '">';
    if (total <= 0) {
      html += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="#e9eaec" stroke="#fff" stroke-width="1.5"/>';
    } else {
      const visiveis = fatias.filter((f) => f.valor > 0);
      if (visiveis.length === 1) {
        html += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + visiveis[0].cor + '"' + borda + '/>';
      } else {
        let ang = -Math.PI / 2;
        for (const f of visiveis) {
          const delta = (2 * Math.PI * f.valor) / total;
          const x1 = cx + r * Math.cos(ang);
          const y1 = cy + r * Math.sin(ang);
          const x2 = cx + r * Math.cos(ang + delta);
          const y2 = cy + r * Math.sin(ang + delta);
          const grande = delta > Math.PI ? 1 : 0;
          html += '<path d="M' + cx + ',' + cy + ' L' + x1.toFixed(2) + ',' + y1.toFixed(2) +
            ' A' + r + ',' + r + ' 0 ' + grande + ',1 ' + x2.toFixed(2) + ',' + y2.toFixed(2) + ' Z" fill="' + f.cor + '"' + borda + '>' +
            '<title>' + esc(f.rotulo || '') + ': ' + fmtInt(f.valor) + ' (' + fmtPct(pct(f.valor, total)) + ')</title></path>';
          ang += delta;
        }
      }
    }
    if (opts.anel) html += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (r + 1.5) + '" fill="none" stroke="' + COR_SELECAO + '" stroke-width="3"/>';
    return html + '</svg>';
  }

  /** Cores fixas por partido, para os partidos com votos válidos no cargo atual (ordenados por votos no município). */
  function coresPartidos() {
    const totais = new Map();
    for (const v of db.votos) {
      if (v.cargo !== estado.cargo || (v.tipo !== 'nominal' && v.tipo !== 'legenda')) continue;
      totais.set(v.partido, (totais.get(v.partido) || 0) + v.votos);
    }
    const mapa = new Map();
    let reserva = 0;
    const lista = Array.from(totais.entries()).sort((a, b) => b[1] - a[1]).map(([sigla, votos]) => {
      let cor = CORES_PARTIDO[String(sigla).toUpperCase()];
      if (!cor) { cor = CORES_PARTIDO_RESERVA[reserva % CORES_PARTIDO_RESERVA.length]; reserva++; }
      mapa.set(sigla, cor);
      return { sigla, votos, cor };
    });
    return { lista, mapa, cor: (sigla) => mapa.get(sigla) || COR_OUTROS };
  }

  /** Fatias da pizza: todos os candidatos (e votos de legenda) com a cor do partido; ou candidato x demais. */
  function fatiasVotos(ranking, legendas, validos, cores, cand, votosCand) {
    if (cand) {
      return [
        { rotulo: cand.nome, valor: votosCand, cor: cores.cor(cand.partido) },
        { rotulo: 'Demais votos válidos', valor: Math.max(0, validos - votosCand), cor: COR_OUTROS },
      ];
    }
    const fatias = ranking.map((c) => ({ rotulo: c.nome, valor: c.votos, cor: cores.cor(c.partido), partido: c.partido }));
    for (const [partido, v] of legendas) fatias.push({ rotulo: 'Legenda ' + partido, valor: v, cor: cores.cor(partido), partido });
    return fatias;
  }

  /** Bloco com a pizza (todos os candidatos, cor do partido) e a lista de votos e % por candidato. */
  function blocoPizzaPartidos(ranking, legendas, validos, cores, tituloTxt) {
    const fatias = fatiasVotos(ranking, legendas, validos, cores, null, 0);
    return '<div class="pizza-bloco">' + svgPizza(fatias, 132, { titulo: tituloTxt, traco: fatias.length > 40 ? 0.5 : 1 }) +
      '<div class="pizza-lista">' + fatias.map((f) => '<div class="item"><span class="ponto" style="background:' + f.cor + '"></span>' +
        '<span class="nome" title="' + esc(f.rotulo) + ' (' + esc(f.partido) + ')">' + esc(f.rotulo) + ' <small>' + esc(f.partido) + '</small></span>' +
        '<span class="num"><b>' + fmtPct(pct(f.valor, validos)) + '</b>' + fmtInt(f.valor) + '</span></div>').join('') + '</div></div>';
  }

  /** Lista de candidatos com cor do partido: 5 primeiros e botão para ver todos. */
  function listaCandidatos(ranking, validos, cores, chave) {
    const todos = !!expandido[chave];
    const itens = todos ? ranking : ranking.slice(0, 5);
    let html = '<div class="detalhe-lista">' + itens.map((c) => '<button type="button" class="detalhe-item' + (c.numero === estado.cand ? ' atual' : '') + '" data-acao="cand" data-valor="' + esc(c.numero) + '">' +
      '<span class="pos">' + c.posicao + 'º</span>' + avatar(c.nome, c.numero, 30) + '<span class="ponto-cor" style="background:' + cores.cor(c.partido) + '"></span>' +
      '<span class="nome">' + esc(c.nome) + '<small>' + esc(c.partido) + '</small>' + seloSituacao(c.numero) + '</span>' +
      '<span class="num">' + fmtInt(c.votos) + '<small>' + fmtPct(pct(c.votos, validos)) + '</small></span></button>').join('') + '</div>';
    if (ranking.length > 5) {
      html += '<button type="button" class="btn btn-vermais" data-acao="vermais" data-valor="' + chave + '">' +
        (todos ? 'Ver menos' : 'Ver todos os ' + ranking.length + ' candidatos') + '</button>';
    }
    return html;
  }

  /** Marcador do mapa: mini gráfico de barras com os 3 mais votados do bairro (foto, % e barra na cor do partido). */
  function htmlBarras(r, cores, cand, selecionado, nome) {
    const ALTURA_BARRA = 44;
    const itens = cand
      ? [{ numero: cand.numero, nome: cand.nome, partido: cand.partido, votos: r.votosCand }]
      : r.ranking.slice(0, 3);
    const maxVotos = Math.max(1, ...itens.map((i) => i.votos));
    const cols = itens.map((i) => {
      const p = pct(i.votos, r.validos);
      // com candidato selecionado a altura é a fatia dele nos válidos; no ranking, relativa ao 1º do bairro
      const h = Math.max(4, Math.round(ALTURA_BARRA * (cand ? p / 100 : i.votos / maxVotos)));
      return '<div class="col" title="' + esc(i.nome) + ' (' + esc(i.partido) + ') · ' + fmtInt(i.votos) + ' votos · ' + fmtPct(p) + '">' +
        avatar(i.nome, i.numero, 26) + '<span class="pct">' + fmtInt(i.votos) + '</span>' +
        '<span class="barra" style="height:' + h + 'px;background:' + cores.cor(i.partido) + '"></span></div>';
    }).join('');
    const largura = 12 + 36 * Math.max(1, itens.length);
    const altura = 26 + 14 + ALTURA_BARRA + 16 + 10;
    return {
      html: '<div class="mini-barras' + (selecionado ? ' selecionado' : '') + '"><div class="cols">' + cols + '</div><div class="rotulo-b">' + esc(titulo(nome)) + '</div></div>',
      largura, altura,
    };
  }

  function renderLegendaMapa(cores, cand) {
    const itens = cand
      ? [{ rotulo: cand.nome + ' (' + cand.partido + ')', cor: cores.cor(cand.partido) }]
      : cores.lista.map((p) => ({ rotulo: p.sigla, cor: p.cor }));
    el.legendaMapa.innerHTML = itens.map((i) => '<span class="legenda-item"><span class="amostra" style="background:' + i.cor + '"></span>' + esc(i.rotulo) + '</span>').join('') +
      '<span class="legenda-item"><span class="amostra anel"></span>' + NOME_POR.bairro + ' selecionado</span>' +
      '<span class="legenda-nota">' + (cand
        ? 'Cada barra mostra os votos do candidato no ' + NOME_POR.bairro + ' (altura = fatia dele nos votos válidos).'
        : 'Cada quadro mostra os 3 mais votados do ' + NOME_POR.bairro + ': foto, votos e barra na cor do partido (altura relativa ao 1º colocado).') + '</span>';
  }

  // ---------- cartões de resumo ----------
  function renderResumoCandidato(cand, d, ranking, escopo) {
    // um único cartão em destaque: nome e votos em evidência; abaixo, nome completo e partido
    const cad = cand.cadastro;
    const nomeCompleto = cad && cad.nome && titulo(cad.nome) !== titulo(cand.nome) ? titulo(cad.nome) : '';
    const partido = cand.partido + (cand.coligacao && cand.coligacao !== cand.partido ? ' · ' + cand.coligacao : '');
    el.resumo.innerHTML = '<div class="card card-heroi">' +
      '<div class="heroi-foto">' + avatar(cand.nome, cand.numero, 96) + '</div>' +
      '<div class="heroi-texto">' +
        '<div class="heroi-nome">' + esc(cand.nome) + seloSituacao(cand.numero) + '</div>' +
        '<div class="heroi-sub">' + (nomeCompleto ? esc(nomeCompleto) + ' · ' : '') + esc(partido) + ' · nº ' + esc(cand.numero) + '</div>' +
      '</div>' +
      '<div class="heroi-votos"><div class="heroi-numero">' + fmtInt(d.totalCand) + '</div><div class="heroi-rotulo">votos ' + esc(escopo) + '</div></div>' +
      '</div>';
  }

  /** Totais do ranking em texto pequeno (rodapé da tabela e do mapa), no lugar dos antigos cartões. */
  function htmlRodapeTotais(r) {
    const t = r.totais;
    const semAptos = !db.temAptos;
    const item = (rotulo, valor) => '<span class="rodape-item">' + rotulo + ' <b>' + valor + '</b></span>';
    return [
      item('Eleitores aptos', semAptos ? 'não disponível nesta base' : fmtInt(r.aptos)),
      item('Comparecimento', fmtInt(t.comparecimento) + (semAptos ? '' : ' <small>(' + fmtPct(pct(t.comparecimento, r.aptos)) + ')</small>')),
      semAptos ? '' : item('Abstenção', fmtPct(pct(r.aptos - t.comparecimento, r.aptos))),
      item('Válidos', fmtInt(t.validos) + ' <small>(nominais ' + fmtInt(t.nominal) + ' · legenda ' + fmtInt(t.legenda) + ')</small>'),
      item('Brancos', fmtInt(t.branco)),
      item('Nulos', fmtInt(t.nulo) + ' <small>(brancos e nulos: ' + fmtPct(pct(t.branco + t.nulo, t.comparecimento)) + ' do comparecimento)</small>'),
      item('Seções', fmtInt(r.nSecoes)),
      db.cfg.data ? item('Votação em', db.cfg.data.split('-').reverse().join('/')) : '',
      estado.bairro ? '<button type="button" class="link" data-acao="bairro" data-valor="">Ver todo o município</button>' : '',
    ].filter(Boolean).join('');
  }

  // ---------- tela de tabelas ----------
  function renderCandidato() {
    const cand = db.candidatos.get(estado.cargo).get(estado.cand);
    const d = distribuicaoCandidato(estado.por);
    const escopo = estado.bairro ? 'em ' + titulo(estado.bairro) : emMun();
    renderResumoCandidato(cand, d, rankingCandidatos(), escopo);
    el.resumo.hidden = false;
    el.rodapeTabela.hidden = true;

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
    const escopo = estado.bairro ? 'em ' + titulo(estado.bairro) : emMun();
    // na tela de tabelas o ranking não tem cartões: os totais viram uma linha discreta no rodapé da tabela
    el.resumo.innerHTML = '';
    el.resumo.hidden = true;

    const cores = coresPartidos();

    el.titulo.textContent = 'Ranking · ' + estado.cargo + ' ' + escopo;
    el.dica.textContent = 'Clique em um candidato para ver os votos por ' + NOME_POR[estado.por] + '.';
    el.thead.innerHTML = '<tr><th class="pos">#</th><th>Candidato</th><th>Partido</th>' +
      '<th class="num">Votos</th><th class="num">% dos válidos</th><th class="barra-celula"></th></tr>';

    const q = normalizar(estado.busca);
    const linhas = q ? r.linhas.filter((l) => normalizar(l.numero + ' ' + l.nome + ' ' + l.partido).includes(q)) : r.linhas;
    const maxVotos = Math.max(1, ...r.linhas.map((l) => l.votos));
    let html = linhas.map((l) => '<tr class="clicavel" data-cand="' + esc(l.numero) + '">' +
      '<td class="pos">' + l.posicao + '</td>' +
      '<td class="texto"><span class="cand-linha">' + avatar(l.nome, l.numero, 32) + '<span><strong>' + esc(l.nome) + '</strong><span class="mono">' + esc(l.numero) + '</span>' + seloSituacao(l.numero) + '</span></span></td>' +
      '<td><span class="ponto-cor" style="background:' + cores.cor(l.partido) + '"></span>' + esc(l.partido) + '</td><td class="num"><strong>' + fmtInt(l.votos) + '</strong></td>' +
      '<td class="num">' + fmtPct(pct(l.votos, t.validos)) + '</td>' + barra(l.votos, maxVotos) + '</tr>').join('');
    if (!q && r.legendas.size) {
      html += Array.from(r.legendas.entries()).sort((a, b) => b[1] - a[1]).map(([partido, v]) =>
        '<tr class="secundario"><td class="pos"></td><td class="texto">Votos de legenda</td><td><span class="ponto-cor" style="background:' + cores.cor(partido) + '"></span>' + esc(partido) + '</td>' +
        '<td class="num">' + fmtInt(v) + '</td><td class="num">' + fmtPct(pct(v, t.validos)) + '</td><td></td></tr>').join('');
    }
    el.tbody.innerHTML = html || '<tr><td colspan="6" class="vazio">Nenhum candidato encontrado para "' + esc(estado.busca) + '".</td></tr>';
    el.tfoot.innerHTML = '<tr><td colspan="3">Válidos ' + esc(escopo) + '</td><td class="num">' + fmtInt(t.validos) + '</td>' +
      '<td class="num">100,0%</td><td></td></tr>';

    el.rodapeTabela.innerHTML = htmlRodapeTotais(r);
    el.rodapeTabela.hidden = false;
  }

  // ---------- tela de mapa ----------
  function garantirMapa() {
    if (mapa.obj) return true;
    if (typeof L === 'undefined') {
      el.mapa.innerHTML = '<div class="vazio">Não foi possível carregar a biblioteca do mapa (Leaflet). Verifique a conexão com a internet.</div>';
      return false;
    }
    mapa.obj = L.map(el.mapa, { scrollWheelZoom: true, zoomControl: true });
    L.tileLayer(TILES_URL, { attribution: TILES_ATTR, maxZoom: 19 }).addTo(mapa.obj);
    mapa.camada = L.layerGroup().addTo(mapa.obj);
    mapa.obj.setView([-3.43, -39.17], 12);
    return true;
  }

  /**
   * Mapa do Ceará (agregado estadual): cada município é desenhado pelo seu contorno e pintado com a cor
   * do partido do candidato mais votado; com candidato selecionado, a intensidade da cor é a fatia dele nos válidos.
   */
  function renderMapaCeara(resumo, cores, cand) {
    el.tituloMapa.textContent = cand ? cand.nome + ' — votos por município' : 'Mapa do Ceará · ' + estado.cargo;
    el.dicaMapa.textContent = cand
      ? 'Quanto mais forte a cor, maior a fatia do candidato nos votos válidos do município. Clique para abrir o município.'
      : 'Cada município tem a cor do partido do candidato mais votado. Clique para abrir o município.';
    el.mapaAviso.hidden = true;
    el.mapa.hidden = false;
    el.legendaMapa.hidden = false;
    if (!garantirMapa()) { renderDetalheBairro(resumo, cand, cores); return; }
    mapa.camada.clearLayers();
    mapa.marcadores.clear();

    const CINZA = '#d5d8dc';
    const corCand = cand ? cores.cor(cand.partido) : '';
    const maxPct = cand ? Math.max(1, ...Array.from(resumo.values()).map((r) => pct(r.votosCand, r.validos))) : 0;
    const vitorias = new Map(); // partido -> nº de municípios em que foi o mais votado
    if (!cand) for (const r of resumo.values()) { const v = r.ranking[0]; if (v) vitorias.set(v.partido, (vitorias.get(v.partido) || 0) + 1); }

    const estilo = (nome) => {
      const r = resumo.get(nome);
      const base = { color: '#fff', weight: 1, opacity: 1 };
      if (!r || !r.validos) return Object.assign(base, { fillColor: CINZA, fillOpacity: 0.6 });
      if (cand) return Object.assign(base, { fillColor: corCand, fillOpacity: 0.12 + 0.83 * pct(r.votosCand, r.validos) / maxPct });
      const v = r.ranking[0];
      return Object.assign(base, { fillColor: v ? cores.cor(v.partido) : CINZA, fillOpacity: 0.85 });
    };
    const rotulo = (nome) => {
      const r = resumo.get(nome);
      if (!r) return '<b>' + esc(titulo(nome)) + '</b>sem dados';
      const linha2 = cand
        ? fmtInt(r.votosCand) + ' votos · ' + fmtPct(pct(r.votosCand, r.validos)) + ' dos válidos' + (r.posicaoCand ? ' · ' + r.posicaoCand + 'º no município' : '')
        : r.ranking.slice(0, 3).map((c) => esc(c.nome) + ' (' + esc(c.partido) + ') ' + fmtPct(pct(c.votos, r.validos))).join(' · ') + '<br>' + fmtInt(r.validos) + ' votos válidos' + (r.aptos ? ' · ' + fmtInt(r.aptos) + ' aptos' : '');
      return '<b>' + esc(titulo(nome)) + '</b>' + linha2;
    };

    const camada = L.geoJSON(malhaCeara, {
      style: (f) => estilo(f.properties.nome),
      onEachFeature: (f, layer) => {
        const nome = f.properties.nome;
        layer.bindTooltip(rotulo(nome), { className: 'rotulo-bairro', sticky: true, direction: 'top', opacity: 1 });
        layer.on({
          mouseover: (e) => { e.target.setStyle({ weight: 2.5, color: '#1f2328' }); e.target.bringToFront(); },
          mouseout: (e) => camada.resetStyle(e.target),
          click: () => executarAcao('bairro', nome),
        });
      },
    });
    camada.addTo(mapa.camada);

    // legenda: partidos vencedores (com nº de municípios) ou degradê da fatia do candidato
    if (cand) {
      el.legendaMapa.innerHTML = '<span class="legenda-item">' + esc(cand.nome) + ' (' + esc(cand.partido) + ')</span>' +
        '<span class="legenda-item legenda-degrade"><span>0%</span><span class="degrade" style="--cor:' + corCand + '"></span><span>' + fmtPct(maxPct) + '</span></span>' +
        '<span class="legenda-nota">Fatia do candidato nos votos válidos de cada município.</span>';
    } else {
      el.legendaMapa.innerHTML = Array.from(vitorias.entries()).sort((a, b) => b[1] - a[1]).map(([sigla, n]) =>
        '<span class="legenda-item"><span class="amostra" style="background:' + cores.cor(sigla) + '"></span>' + esc(sigla) + ' <small>' + n + (n === 1 ? ' município' : ' municípios') + '</small></span>').join('') +
        '<span class="legenda-nota">Cor do partido do candidato mais votado em cada município (' + estado.cargo + ').</span>';
    }

    setTimeout(() => {
      mapa.obj.invalidateSize();
      if (!mapa.ajustado) {
        mapa.obj.fitBounds(camada.getBounds(), { padding: [8, 8] });
        mapa.ajustado = true;
      }
    }, 0);

    renderDetalheBairro(resumo, cand, cores);
  }

  function renderMapa() {
    const cand = estado.cand ? db.candidatos.get(estado.cargo).get(estado.cand) : null;
    const escopo = estado.bairro ? 'em ' + titulo(estado.bairro) : emMun();

    // modo candidato: cartão herói; ranking: os totais viram uma linha discreta no rodapé do mapa
    const rk = rankingCandidatos();
    el.resumo.hidden = !cand;
    el.rodapeMapa.hidden = !!cand;
    if (cand) renderResumoCandidato(cand, distribuicaoCandidato('bairro'), rk, escopo);
    else { el.resumo.innerHTML = ''; el.rodapeMapa.innerHTML = htmlRodapeTotais(rk); }

    const resumo = resumoBairros();
    const cores = coresPartidos();
    if (noEstado() && malhaCeara) { renderMapaCeara(resumo, cores, cand); return; }
    const metrica = cand ? 'votosCand' : 'validos';
    el.tituloMapa.textContent = cand ? cand.nome + ' — votos por ' + NOME_POR.bairro : 'Votos por ' + NOME_POR.bairro + ' · ' + estado.cargo;
    el.dicaMapa.textContent = cand
      ? 'Cada ' + NOME_POR.bairro + ' mostra a barra do candidato com a foto e a quantidade de votos. Clique para ver os detalhes.'
      : 'Cada ' + NOME_POR.bairro + ' mostra os 3 mais votados, com foto, quantidade de votos e barra na cor do partido. Clique para ver os detalhes.';
    renderLegendaMapa(cores, cand);

    const semGeo = !db.temBairros || geo.size === 0;
    el.mapaAviso.hidden = !semGeo;
    el.mapa.hidden = semGeo;
    el.legendaMapa.hidden = semGeo;
    if (semGeo) {
      el.mapaAviso.textContent = db.temBairros
        ? 'Os bairros de ' + nomeMun() + ' ainda não têm coordenadas em data/bairros.json.'
        : 'Os dados do TSE para ' + nomeMun() + ' não trazem o bairro de cada local de votação; o mapa depende dessa informação. Os totais do município continuam ao lado.';
      renderDetalheBairro(resumo, cand, cores);
      return;
    }
    if (!garantirMapa()) { renderDetalheBairro(resumo, cand, cores); return; }

    mapa.camada.clearLayers();
    mapa.marcadores.clear();
    const valores = Array.from(resumo.values()).map((r) => r[metrica]);
    const maximo = Math.max(1, ...valores);
    const pontos = [];
    for (const [nome, r] of resumo) {
      const g = geo.get(nome);
      if (!g) continue;
      const valor = r[metrica];
      const selecionado = nome === estado.bairro;
      const barras = htmlBarras(r, cores, cand, selecionado, nome);
      const marcador = L.marker([g.lat, g.lng], {
        icon: L.divIcon({
          html: barras.html,
          className: 'marcador-barras',
          iconSize: [barras.largura, barras.altura],
          iconAnchor: [Math.round(barras.largura / 2), Math.round(barras.altura / 2)],
        }),
        zIndexOffset: selecionado ? 1000 : Math.round(100 * valor / maximo),
        keyboard: false,
      });
      const top3 = r.ranking.slice(0, 3);
      const linha2 = cand
        ? fmtInt(r.votosCand) + ' votos · ' + fmtPct(pct(r.votosCand, r.validos)) + ' dos válidos' + (r.posicaoCand ? ' · ' + r.posicaoCand + 'º no bairro' : '')
        : top3.map((c) => esc(c.nome) + ' (' + esc(c.partido) + ') ' + fmtPct(pct(c.votos, r.validos))).join(' · ') + '<br>' + fmtInt(r.validos) + ' votos válidos' + (r.aptos ? ' · ' + fmtInt(r.aptos) + ' aptos' : '');
      marcador.bindTooltip('<b>' + esc(titulo(nome)) + '</b>' + linha2, { className: 'rotulo-bairro', direction: 'top', offset: [0, -Math.round(barras.altura / 2)], opacity: 1 });
      marcador.on('click', () => executarAcao('bairro', nome === estado.bairro ? '' : nome));
      marcador.base = L.latLng(g.lat, g.lng);
      marcador.addTo(mapa.camada);
      mapa.marcadores.set(nome, marcador);
      mapa.dim = { w: barras.largura, h: barras.altura };
      pontos.push([g.lat, g.lng]);
    }

    setTimeout(() => {
      mapa.obj.invalidateSize();
      if (!mapa.ajustado && pontos.length) {
        mapa.obj.fitBounds(L.latLngBounds(pontos), { padding: [40, 40] });
        mapa.ajustado = true;
      }
    }, 0);

    renderDetalheBairro(resumo, cand, cores);
  }

  /** Totais do município no mesmo formato de um bairro (para "Detalhes gerais"). */
  function resumoMunicipio(cand) {
    const rk = rankingCandidatos();
    const item = cand ? rk.linhas.find((l) => l.numero === cand.numero) : null;
    return {
      bairro: '', aptos: rk.aptos, nSecoes: rk.nSecoes, comparecimento: rk.totais.comparecimento, validos: rk.totais.validos,
      legenda: rk.totais.legenda, branco: rk.totais.branco, nulo: rk.totais.nulo, ranking: rk.linhas, legendas: rk.legendas,
      votosCand: item ? item.votos : 0, posicaoCand: item ? item.posicao : null,
    };
  }

  function renderDetalheBairro(resumo, cand, cores) {
    const geral = !estado.bairro || !resumo.has(estado.bairro);
    const r = geral ? resumoMunicipio(cand) : resumo.get(estado.bairro);
    const lugar = geral ? nomeMun() : titulo(estado.bairro);
    const onde = geral ? (noEstado() ? 'no Ceará' : 'no município') : 'no ' + NOME_POR.bairro;
    el.tituloBairro.textContent = geral ? 'Detalhes gerais · ' + nomeMun() : titulo(estado.bairro);
    const stat = (rotulo, valor, sub) => '<div class="detalhe-stat"><span class="rotulo">' + esc(rotulo) + '</span><span class="valor">' + esc(valor) + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span></div>';

    let html = geral ? '<div class="dica">Clique em um bairro no mapa (ou escolha no filtro) para ver os detalhes daquele bairro.</div>' : '';
    if (cand) {
      const fatias = fatiasVotos(r.ranking, r.legendas, r.validos, cores, cand, r.votosCand);
      html += '<div class="pizza-bloco">' + svgPizza(fatias, 132, { titulo: 'Votos de ' + cand.nome + ' em ' + lugar }) +
        '<div class="pizza-lista">' + fatias.map((f) => '<div class="item"><span class="ponto" style="background:' + f.cor + '"></span><span class="nome" title="' + esc(f.rotulo) + '">' + esc(f.rotulo) + '</span>' +
          '<span class="num"><b>' + fmtPct(pct(f.valor, r.validos)) + '</b>' + fmtInt(f.valor) + '</span></div>').join('') + '</div></div>';
    } else {
      html += blocoPizzaPartidos(r.ranking, r.legendas, r.validos, cores, 'Divisão dos votos válidos em ' + lugar);
    }

    html += '<div class="detalhe-stats">' +
      stat('Eleitores aptos', db.temAptos ? fmtInt(r.aptos) : '—', r.nSecoes + ' seções') +
      stat('Comparecimento', fmtInt(r.comparecimento), db.temAptos ? fmtPct(pct(r.comparecimento, r.aptos)) : 'apurados') +
      stat('Válidos · ' + estado.cargo, fmtInt(r.validos), 'legenda ' + fmtInt(r.legenda)) +
      stat('Brancos e nulos', fmtInt(r.branco + r.nulo), fmtPct(pct(r.branco + r.nulo, r.comparecimento))) +
      '</div>';

    if (cand) {
      html += '<div class="detalhe-stats">' +
        stat('Votos de ' + cand.nome, fmtInt(r.votosCand), fmtPct(pct(r.votosCand, r.validos)) + ' dos válidos') +
        stat('Posição ' + onde, r.posicaoCand ? r.posicaoCand + 'º' : '—', 'entre ' + r.ranking.length) +
        '</div>';
    }

    html += '<div class="detalhe-sub">Mais votados ' + onde + ' · ' + r.ranking.length + ' candidatos</div>' +
      listaCandidatos(r.ranking, r.validos, cores, 'mapa');
    if (cand && r.posicaoCand && r.posicaoCand > 5 && !expandido.mapa) {
      const c = r.ranking[r.posicaoCand - 1];
      html += '<div class="detalhe-lista"><div class="detalhe-item atual"><span class="pos">' + c.posicao + 'º</span>' + avatar(c.nome, c.numero, 30) + '<span class="nome">' + esc(c.nome) + '<small>' + esc(c.partido) + '</small></span>' +
        '<span class="num">' + fmtInt(c.votos) + '<small>' + fmtPct(pct(c.votos, r.validos)) + '</small></span></div></div>';
    }
    html += '<div class="detalhe-acoes">' + (geral
      ? '<button type="button" class="btn" data-acao="tela" data-valor="tabela">Ver tabelas do município</button>'
      : '<button type="button" class="btn" data-acao="secoes" data-valor="' + esc(estado.bairro) + '">Ver seções do bairro</button>' +
        '<button type="button" class="btn" data-acao="bairro" data-valor="">Limpar seleção</button>') + '</div>';
    el.detalheBairro.innerHTML = html;
  }

  // ---------- render geral ----------
  function render(empilhar) {
    if (!db) return;
    renderControles();
    renderTrilha();
    const noMapa = estado.tela === 'mapa';
    const naLideranca = estado.tela in TELAS_2026;
    el.gradeTabela.hidden = noMapa || naLideranca;
    el.gradeMapa.hidden = !noMapa;
    el.telaLiderancas.hidden = !naLideranca;
    el.filtros.hidden = naLideranca;
    el.resumo.hidden = naLideranca;
    if (naLideranca) {
      if (window.Liderancas) {
        Liderancas.mostrar({
          el: el.telaLiderancas, tela: TELAS_2026[estado.tela], cdMun: estado.mun, nomeMun: nomeMun(), municipios: db.municipios,
          candidatos2026: manifesto.candidatos2026, fotos2026: manifesto.fotos2026,
          irPara: (t) => { const app = Object.keys(TELAS_2026).find((k) => TELAS_2026[k] === t); if (app) executarAcao('tela', app); },
          verVotos: abrirVotos2024,
        });
      } else el.telaLiderancas.innerHTML = '<section class="painel"><div class="vazio">Módulo de lideranças não carregado.</div></section>';
    }
    else if (noMapa) renderMapa();
    else if (estado.cand) renderCandidato();
    else renderRanking();
    gravarHash(empilhar);
  }

  function mostrarErro(e) {
    el.status.textContent = 'Erro ao carregar os dados: ' + e.message + '. Abra a página por um servidor HTTP (veja o README).';
    el.status.classList.add('erro');
    console.error(e);
  }

  async function trocarEleicao(id, cd) {
    try {
      await carregarEleicao(id, cd);
      render(false);
    } catch (e) {
      mostrarErro(e);
    }
  }

  /** Abre a tela Tabelas nas Eleições 2024 com o candidato (vereador ou prefeito) filtrado. Chamada pela ficha da liderança. */
  function abrirVotos2024(info) {
    const cfg = manifesto.eleicoes.find((e) => String(e.ano) === '2024') || manifesto.eleicoes.find((e) => e.id === '2024-1');
    if (!cfg) return;
    estado.tela = 'tabela';
    estado.cargo = info.cargo;
    estado.cand = String(info.numero);
    estado.bairro = '';
    estado.busca = '';
    estado.por = 'bairro';
    const mun = info.cdMun || estado.mun;
    if (estado.eleicao !== cfg.id || estado.mun !== mun) trocarEleicao(cfg.id, mun);
    else render(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /** Ações de navegação usadas por cartões, trilha, tabela e mapa. */
  function executarAcao(acao, valor) {
    if (acao === 'vermais') { expandido[valor] = !expandido[valor]; render(false); return; }
    if (acao === 'inicio') { estado.cand = ''; estado.bairro = ''; estado.busca = ''; estado.tela = 'tabela'; }
    else if (acao === 'tela') { estado.tela = TELAS.includes(valor) ? valor : 'tabela'; }
    else if (acao === 'cargo') { estado.cand = ''; estado.busca = ''; }
    else if (acao === 'ranking') { estado.cand = ''; }
    else if (acao === 'cand') { estado.cand = valor; estado.busca = ''; }
    else if (acao === 'bairro' && noEstado() && valor) {
      // no agregado estadual, escolher um "bairro" (município) abre a página daquele município
      const m = db.municipios.find((x) => x.nome === valor);
      if (m) { estado.bairro = ''; trocarEleicao(estado.eleicao, m.cd); return; }
      estado.bairro = valor;
    }
    else if (acao === 'bairro') { estado.bairro = valor; expandido.mapa = false; expandido.tabela = false; if (estado.cand && valor && estado.tela === 'tabela') estado.por = 'secao'; }
    else if (acao === 'secoes') { estado.bairro = valor; estado.tela = 'tabela'; estado.por = 'secao'; }
    render(true);
    if (acao === 'cand' && estado.tela === 'tabela') window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ---------- eventos ----------
  el.municipio.addEventListener('change', () => { estado.cand = ''; estado.bairro = ''; estado.busca = ''; trocarEleicao(estado.eleicao, el.municipio.value); });
  el.navEleicoes.addEventListener('click', (ev) => {
    const cargo = ev.target.closest('[data-cargo]');
    if (cargo) { estado.cargo = cargo.dataset.cargo; estado.cand = ''; estado.busca = ''; render(true); return; }
    const eleicao = ev.target.closest('[data-eleicao]');
    if (!eleicao) return;
    if (eleicao.dataset.eleicao === estado.eleicao) { menuRecolhido = !menuRecolhido; renderControles(); return; } // recolhe/expande os cargos
    menuRecolhido = false;
    estado.cand = ''; estado.bairro = ''; estado.busca = ''; estado.cargo = '';
    const cfg = manifesto.eleicoes.find((e) => e.id === eleicao.dataset.eleicao);
    const mun = (estado.mun === TODOS && cfg && !cfg.agregado_estado) ? manifesto.municipio_padrao : estado.mun;
    trocarEleicao(eleicao.dataset.eleicao, mun);
  });
  document.querySelector('.lateral').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-tela]');
    if (b) executarAcao('tela', b.dataset.tela);
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

  // menu sanduíche (celular): a barra lateral vira uma gaveta aberta pelo botão da barra do topo
  const btnMenu = $('#btn-menu');
  function abrirMenu(aberto) {
    document.body.classList.toggle('menu-aberto', aberto);
    btnMenu.setAttribute('aria-expanded', String(aberto));
    btnMenu.setAttribute('aria-label', aberto ? 'Fechar menu' : 'Abrir menu');
  }
  btnMenu.addEventListener('click', () => abrirMenu(!document.body.classList.contains('menu-aberto')));
  $('#btn-fechar-menu').addEventListener('click', () => abrirMenu(false));
  $('#menu-fundo').addEventListener('click', () => abrirMenu(false));
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') abrirMenu(false); });
  // escolher uma tela, um cargo ou outra eleição fecha a gaveta; recolher os cargos da eleição ativa não fecha
  document.querySelector('.lateral').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-tela], [data-cargo], [data-eleicao]');
    if (!b || (b.dataset.eleicao && b.dataset.eleicao === estado.eleicao && !ev.target.closest('[data-cargo]'))) return;
    abrirMenu(false);
  });
  el.municipio.addEventListener('change', () => abrirMenu(false));

  document.addEventListener('click', (ev) => {
    const alvo = ev.target.closest('[data-acao]');
    if (alvo) { executarAcao(alvo.dataset.acao, alvo.dataset.valor || ''); return; }
    const tr = ev.target.closest('#tabela tbody tr.clicavel');
    if (!tr) return;
    if (tr.dataset.cand) executarAcao('cand', tr.dataset.cand);
    else if (tr.dataset.bairro) executarAcao('bairro', tr.dataset.bairro);
  });

  window.addEventListener('popstate', () => {
    if (ignorarPopstate) return;
    const anterior = estado.eleicao + '|' + estado.mun;
    lerHash();
    if (estado.eleicao + '|' + estado.mun !== anterior) trocarEleicao(estado.eleicao, estado.mun); else render(false);
  });

  // ---------- início ----------
  (async function init() {
    el.linkRepo.href = REPO_URL;
    try {
      const resp = await fetch('data/eleicoes.json', { cache: 'no-cache' });
      if (!resp.ok) throw new Error('data/eleicoes.json (' + resp.status + ')');
      manifesto = await resp.json();
      estado.eleicao = manifesto.eleicoes[0].id;
      estado.mun = manifesto.municipio_padrao || '';
      // link de convite/acesso do Supabase (tokens no hash): estabelece a sessão antes de mexer na URL e abre Lideranças
      let veioDoLinkDeAcesso = false;
      if (window.Sync && /access_token=|type=(invite|magiclink|recovery|signup)/.test(location.hash)) {
        await Sync.iniciar();
        veioDoLinkDeAcesso = true;
        history.replaceState(null, '', location.pathname + location.search);
      }
      lerHash();
      if (veioDoLinkDeAcesso) estado.tela = 'liderancas';
      await carregarAuxiliares();
      await trocarEleicao(estado.eleicao, estado.mun);
    } catch (e) {
      mostrarErro(e);
    }
  })();
})();
