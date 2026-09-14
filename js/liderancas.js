/* Mapeamento de lideranças municipais.
   Cadastro de lideranças por município (candidatos a vereador de 2024 entram automaticamente),
   apoios em 2022/2024/2026 e grupos por candidato de 2026 com estimativa de votos.
   Os candidatos de 2026 vêm do cadastro do TSE (data/2026-1/candidatos.csv, com foto); também é
   possível cadastrar candidatos manualmente. Os dados do mapeamento ficam no navegador
   (localStorage) e podem ser exportados/importados em JSON; data/liderancas.json é a base inicial. */
(function (global) {
  'use strict';

  const CHAVE = 'eleicoes-ce-liderancas-v1';
  const ARQUIVO_BASE = 'data/liderancas.json';
  const CANDIDATOS_2026 = 'data/2026-1/candidatos.csv';
  const FOTOS_2026 = 'data/2026-1/fotos/';
  const CARGOS_2026 = ['Presidente', 'Governador', 'Senador', 'Deputado Federal', 'Deputado Estadual'];
  const CHAVE_CARGO = { Presidente: 'presidente', Governador: 'governador', Senador: 'senador', 'Deputado Federal': 'federal', 'Deputado Estadual': 'estadual' };
  const CARGO_DA_CHAVE = Object.fromEntries(Object.entries(CHAVE_CARGO).map(([c, k]) => [k, c]));

  let dados = null;     // { versao, liderancas: [], candidatos2026: [] (manuais), importados: {}, atualizadoEm }
  let tse2026 = null;   // candidatos de 2026 do TSE: [{ id: 'tse:'+sq, nome, cargo, partido, numero, foto, nomeCompleto, ocupacao }]
  let ctx = null;       // contexto passado pelo app (município atual, utilitários)
  const cache = {};     // por município: listas de referência (vereadores/prefeitos 2024, deputados 2022)
  const ui = { aba: 'liderancas', candidato: '', editando: null, busca: '', novoCandidato: false, cargo26: '', busca26: '' };

  // ---------- utilidades ----------
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtInt = (n) => (Number(n) || 0).toLocaleString('pt-BR');
  const titulo = (s) => String(s || '').toLowerCase().replace(/(^|[\s\-\/(])(\S)/g, (m, p, c) => p + c.toUpperCase()).replace(/ (De|Do|Da|Dos|Das|E) /g, (m) => m.toLowerCase());
  const normalizar = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const novoId = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const agora = () => new Date().toISOString();

  function avatar(nome, foto, tam) {
    const iniciais = String(nome || '').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
    const img = foto ? '<img src="' + esc(foto) + '" alt="" loading="lazy" onerror="this.remove()">' : '';
    return '<span class="avatar" style="width:' + tam + 'px;height:' + tam + 'px">' + img + '<span class="iniciais">' + esc(iniciais) + '</span></span>';
  }

  async function lerCsv(url) {
    try { return await global.Csv.carregarCsv(url); } catch (e) { console.warn('Indisponível:', url, e); return []; }
  }

  // ---------- persistência ----------
  function vazio() { return { versao: 1, liderancas: [], candidatos2026: [], importados: {}, atualizadoEm: agora() }; }

  async function carregar() {
    if (dados) return dados;
    try {
      const salvo = localStorage.getItem(CHAVE);
      if (salvo) { dados = Object.assign(vazio(), JSON.parse(salvo)); return dados; }
    } catch (e) { console.warn('localStorage indisponível:', e); }
    try {
      const resp = await fetch(ARQUIVO_BASE, { cache: 'no-cache' });
      if (resp.ok) { dados = Object.assign(vazio(), await resp.json()); return dados; }
    } catch (e) { /* sem arquivo base */ }
    dados = vazio();
    return dados;
  }

  function salvar() {
    dados.atualizadoEm = agora();
    try { localStorage.setItem(CHAVE, JSON.stringify(dados)); } catch (e) { console.warn('Não foi possível salvar no navegador:', e); }
  }

  function exportar() {
    const blob = new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'liderancas-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function importar(arquivo) {
    const leitor = new FileReader();
    leitor.onload = () => {
      try {
        const json = JSON.parse(leitor.result);
        if (!json || !Array.isArray(json.liderancas)) throw new Error('formato inválido');
        if (!confirm('Substituir o cadastro atual pelo arquivo importado (' + json.liderancas.length + ' lideranças, ' + (json.candidatos2026 || []).length + ' candidatos manuais de 2026)?')) return;
        dados = Object.assign(vazio(), json);
        salvar();
        render();
      } catch (e) { alert('Arquivo inválido: ' + e.message); }
    };
    leitor.readAsText(arquivo);
  }

  // ---------- candidatos de 2026 (TSE + manuais) ----------
  async function carregarTse2026() {
    if (tse2026) return tse2026;
    const url = (ctx && ctx.candidatos2026) || CANDIDATOS_2026;
    const fotos = (ctx && ctx.fotos2026) || FOTOS_2026;
    const lista = await lerCsv(url);
    tse2026 = lista.filter((c) => CARGOS_2026.includes(c.cargo)).map((c) => ({
      id: 'tse:' + c.sq, origem: 'tse', sq: c.sq, nome: c.nome_urna || c.nome, nomeCompleto: c.nome, cargo: c.cargo,
      partido: c.partido, numero: c.numero, genero: c.genero, ocupacao: c.ocupacao, situacao: c.situacao, foto: c.foto ? fotos + c.foto : '',
    }));
    return tse2026;
  }

  const candidatos2026 = () => (tse2026 || []).concat(dados.candidatos2026.map((c) => Object.assign({ origem: 'manual' }, c)));
  const candidato2026 = (id) => candidatos2026().find((c) => c.id === id) || null;
  const rotuloCand = (c) => c.nome + (c.partido ? ' (' + c.partido + ')' : '') + (c.numero ? ' · ' + c.numero : '');

  const chaveNome = (s) => normalizar(s).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

  /** Distância de edição (Levenshtein) entre duas cadeias curtas. */
  function distancia(a, b) {
    if (a === b) return 0;
    const m = a.length; const n = b.length;
    if (!m) return n; if (!n) return m;
    let ant = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) cur[j] = Math.min(ant[j] + 1, cur[j - 1] + 1, ant[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      ant = cur;
    }
    return ant[n];
  }

  /** Nomes manuais que sabidamente correspondem a candidatos do TSE (unificados automaticamente ao abrir). */
  const APELIDOS_TSE = {
    'daniel oliveira': '60002542461',   // DANNIEL OLIVEIRA (MDB, Dep. Estadual)
    'eliseu monteiro': '60002536670',   // ELIZEU MONTEIRO (PSB, Dep. Estadual)
    'emanoel acrisio': '60002532983',   // EMANUEL ACRIZIO (SOLIDARIEDADE, Dep. Federal)
    'yury do paredao': '60002542442',   // YURY DO PAREDÃO (MDB, Dep. Federal)
  };

  /** Une automaticamente os manuais da tabela de apelidos ao candidato do TSE correspondente. */
  function unificarConhecidos() {
    const feitos = [];
    for (const m of dados.candidatos2026.slice()) {
      const sq = APELIDOS_TSE[chaveNome(m.nome)];
      if (!sq) continue;
      const t = candidato2026('tse:' + sq);
      if (!t) continue;
      const n = mesclar(m.id, t.id);
      feitos.push(m.nome + ' → ' + t.nome + ' (' + t.cargo + ', ' + t.partido + ')' + (n ? ', ' + n + ' liderança(s)' : ''));
    }
    return feitos;
  }

  /** Candidatos manuais que parecem repetir alguém do cadastro do TSE: nome igual (ignorando acentos e caixa),
   *  contido no outro, ou muito parecido (até 2 letras de diferença: Daniel/Danniel, Eliseu/Elizeu, Emanoel/Emanuel). */
  function duplicados() {
    const tse = tse2026 || [];
    return dados.candidatos2026.map((m) => {
      const n = chaveNome(m.nome);
      if (!n) return null;
      const iguais = tse.filter((c) => chaveNome(c.nome) === n || chaveNome(c.nomeCompleto) === n);
      let parecidos = [];
      if (!iguais.length) {
        parecidos = tse.filter((c) => {
          const cn = chaveNome(c.nome);
          if (n.length >= 6 && (cn.includes(n) || n.includes(cn))) return true;
          const d = distancia(n, cn);
          return d <= 2 || d <= Math.floor(Math.max(n.length, cn.length) * 0.15);
        });
      }
      const lista = iguais.length ? iguais : parecidos;
      return lista.length ? { manual: Object.assign({ origem: 'manual' }, m), tse: lista, exato: iguais.length > 0 } : null;
    }).filter(Boolean);
  }

  /** Substitui um candidato manual por um do TSE: move os apoios das lideranças e apaga o manual. */
  function mesclar(idManual, idTse) {
    const m = dados.candidatos2026.find((c) => c.id === idManual);
    const t = candidato2026(idTse);
    if (!m || !t) return;
    const chaveDe = CHAVE_CARGO[m.cargo];
    const chavePara = CHAVE_CARGO[t.cargo];
    let movidos = 0;
    for (const l of dados.liderancas) {
      const a = l.apoio2026 && l.apoio2026[chaveDe];
      if (!a || a.candidato_id !== idManual) continue;
      l.apoio2026[chavePara] = { candidato_id: idTse, estimativa: a.estimativa || 0 };
      if (chaveDe !== chavePara) l.apoio2026[chaveDe] = null;
      movidos++;
    }
    dados.candidatos2026 = dados.candidatos2026.filter((c) => c.id !== idManual);
    if (ui.candidato === idManual) ui.candidato = idTse;
    salvar();
    return movidos;
  }

  /** Resolve o texto digitado num campo com datalist para um candidato do cargo. */
  function resolverCandidato(texto, cargo) {
    const t = normalizar(String(texto || '').trim());
    if (!t) return null;
    const lista = candidatos2026().filter((c) => c.cargo === cargo);
    return lista.find((c) => normalizar(rotuloCand(c)) === t) ||
      lista.find((c) => normalizar(c.nome) === t) ||
      lista.find((c) => c.numero && String(c.numero) === t) ||
      lista.find((c) => normalizar(rotuloCand(c)).startsWith(t)) || null;
  }

  // ---------- referência: candidatos do município em 2022 e 2024 ----------
  async function referencias(cd) {
    if (cache[cd]) return cache[cd];
    const [c24, v24, c22] = await Promise.all([
      lerCsv('data/2024-1/' + cd + '/candidatos.csv'),
      lerCsv('data/2024-1/' + cd + '/votos.csv'),
      lerCsv('data/2022-1/' + cd + '/candidatos.csv'),
    ]);
    const votos = new Map();
    for (const v of v24) { const k = v.cargo + '|' + v.numero; votos.set(k, (votos.get(k) || 0) + (parseInt(v.votos, 10) || 0)); }
    const fotos24 = 'data/2024-1/fotos/';
    const ref = {
      vereadores: c24.filter((c) => c.cargo === 'Vereador').map((c) => ({
        numero: c.numero, sq: c.sq, nome: c.nome_urna || c.nome, nomeCompleto: c.nome, partido: c.partido, situacao: c.situacao,
        votos: votos.get('13|' + c.numero) || 0, foto: c.foto ? fotos24 + c.foto : '',
      })).sort((a, b) => b.votos - a.votos),
      prefeitos: c24.filter((c) => c.cargo === 'Prefeito').map((c) => ({ nome: c.nome_urna || c.nome, partido: c.partido, votos: votos.get('11|' + c.numero) || 0, situacao: c.situacao })).sort((a, b) => b.votos - a.votos),
      estaduais2022: c22.filter((c) => c.cargo === 'Deputado Estadual').map((c) => (c.nome_urna || c.nome) + ' (' + c.partido + ')'),
      federais2022: c22.filter((c) => c.cargo === 'Deputado Federal').map((c) => (c.nome_urna || c.nome) + ' (' + c.partido + ')'),
    };
    cache[cd] = ref;
    return ref;
  }

  /** Inclui automaticamente os candidatos a vereador de 2024 do município (uma vez). */
  async function importarVereadores(cd) {
    if (dados.importados[cd]) return 0;
    const ref = await referencias(cd);
    const existentes = new Set(dados.liderancas.filter((l) => l.cd_mun === cd && l.sq).map((l) => l.sq));
    let n = 0;
    for (const v of ref.vereadores) {
      if (existentes.has(v.sq)) continue;
      dados.liderancas.push({
        id: novoId('l'), cd_mun: cd, nome: v.nome, nomeCompleto: v.nomeCompleto, partido: v.partido, origem: 'vereador2024',
        sq: v.sq, numero: v.numero, votos2024: v.votos, situacao2024: v.situacao, foto: v.foto,
        apoio2022_estadual: '', apoio2022_federal: '', apoio2024_prefeito: '', apoio2024_vereador: '',
        apoio2026: {}, obs: '', criadoEm: agora(),
      });
      n++;
    }
    dados.importados[cd] = true;
    salvar();
    return n;
  }

  // ---------- consultas ----------
  const doMunicipio = (cd) => dados.liderancas.filter((l) => l.cd_mun === cd);
  const porId = (id) => dados.liderancas.find((l) => l.id === id) || null;

  function apoio(l, chave) {
    const a = l.apoio2026 && l.apoio2026[chave];
    if (!a || !a.candidato_id) return null;
    const c = candidato2026(a.candidato_id);
    return c ? { c, estimativa: Number(a.estimativa) || 0 } : null;
  }

  function apoioTexto(l, chave) {
    const a = apoio(l, chave);
    return a ? a.c.nome + (a.estimativa ? ' · ' + fmtInt(a.estimativa) : '') : '';
  }

  function grupo(candId, cd) {
    const c = candidato2026(candId);
    if (!c) return { itens: [], total: 0 };
    const chave = CHAVE_CARGO[c.cargo];
    const itens = dados.liderancas
      .filter((l) => (!cd || l.cd_mun === cd) && l.apoio2026 && l.apoio2026[chave] && l.apoio2026[chave].candidato_id === candId)
      .map((l) => ({ l, estimativa: Number(l.apoio2026[chave].estimativa) || 0 }))
      .sort((a, b) => b.estimativa - a.estimativa || (b.l.votos2024 || 0) - (a.l.votos2024 || 0));
    return { itens, total: itens.reduce((s, i) => s + i.estimativa, 0), chave, c };
  }

  // ---------- render ----------
  function render() {
    if (!ctx || !dados) return;
    const raiz = ctx.el;
    const semMun = !ctx.cdMun || ctx.cdMun === 'todos';
    const lista = semMun ? [] : doMunicipio(ctx.cdMun);
    const n26 = candidatos2026().length;
    const cab = '<section class="painel la-cabecalho">' +
      '<div class="painel-cabecalho"><h2>Lideranças · ' + esc(semMun ? 'Ceará' : ctx.nomeMun) + '</h2><span class="dica">' +
        (semMun ? 'Escolha um município na barra lateral para o cadastro de lideranças e os grupos.' : lista.length + ' lideranças cadastradas · dados salvos neste navegador') +
        ' · ' + n26 + ' candidatos de 2026</span></div>' +
      '<div class="la-barra">' +
        '<div class="segmentado la-abas">' +
          '<button type="button" class="' + (ui.aba === 'liderancas' ? 'ativo' : '') + '" data-la="aba" data-valor="liderancas">Lideranças</button>' +
          '<button type="button" class="' + (ui.aba === 'grupos' ? 'ativo' : '') + '" data-la="aba" data-valor="grupos">Grupos 2026</button>' +
          '<button type="button" class="' + (ui.aba === 'candidatos' ? 'ativo' : '') + '" data-la="aba" data-valor="candidatos">Candidatos 2026</button>' +
        '</div>' +
        '<div class="la-acoes">' +
          (semMun ? '' : '<button type="button" class="btn" data-la="nova">+ Nova liderança</button>') +
          '<button type="button" class="btn" data-la="exportar" title="Baixa um arquivo JSON com todo o cadastro">Exportar</button>' +
          '<label class="btn">Importar<input type="file" accept="application/json,.json" data-la="importar" hidden></label>' +
        '</div>' +
      '</div></section>';
    const aviso = ui.aviso ? '<section class="painel la-aviso"><span>' + esc(ui.aviso) + '</span><button type="button" class="btn btn-mini" data-la="fechar-aviso">OK</button></section>' : '';
    let corpo;
    if (ui.aba === 'candidatos') corpo = renderCandidatos2026();
    else if (semMun) corpo = '<section class="painel"><div class="vazio">Escolha um município na barra lateral para mapear as lideranças dele. A aba "Candidatos 2026" funciona sem município.</div></section>';
    else if (ui.aba === 'grupos') corpo = renderGrupos(ctx.cdMun, lista);
    else corpo = renderLiderancas(ctx.cdMun, lista);
    raiz.innerHTML = cab + aviso + corpo;
  }

  function renderLiderancas(cd, lista) {
    const q = normalizar(ui.busca);
    const textoBusca = (l) => [l.nome, l.nomeCompleto, l.partido, l.apoio2022_estadual, l.apoio2022_federal, l.apoio2024_prefeito, l.apoio2024_vereador]
      .concat(Object.keys(CHAVE_CARGO).map((c) => apoioTexto(l, CHAVE_CARGO[c]))).join(' ');
    const filtradas = (q ? lista.filter((l) => normalizar(textoBusca(l)).includes(q)) : lista)
      .slice().sort((a, b) => (b.votos2024 || 0) - (a.votos2024 || 0) || a.nome.localeCompare(b.nome, 'pt-BR'));
    const majoritarios = (l) => ['presidente', 'governador', 'senador'].map((k) => { const a = apoio(l, k); return a ? CARGO_DA_CHAVE[k].slice(0, 3) + '.: ' + a.c.nome + (a.estimativa ? ' · ' + fmtInt(a.estimativa) : '') : ''; }).filter(Boolean).join(' · ');

    let html = '';
    if (ui.editando !== null) html += renderFormulario(cd, ui.editando === 'nova' ? null : porId(ui.editando));

    html += '<section class="painel"><div class="painel-cabecalho"><h2>Cadastro</h2>' +
      '<input type="search" class="la-busca" placeholder="Buscar liderança, partido ou apoio" value="' + esc(ui.busca) + '" data-la="busca"></div>' +
      '<div class="tabela-scroll"><table class="la-tabela"><thead><tr>' +
      '<th>Liderança</th><th>Partido</th><th class="num">Votos 2024</th><th>2022 · Dep. Estadual</th><th>2022 · Dep. Federal</th><th>2024 · apoiou</th><th>2026 · Dep. Estadual</th><th>2026 · Dep. Federal</th><th>2026 · majoritários</th><th></th>' +
      '</tr></thead><tbody>' +
      (filtradas.map((l) => '<tr' + (ui.editando === l.id ? ' class="selecionado"' : '') + '>' +
        '<td class="texto"><span class="cand-linha">' + avatar(l.nome, l.foto, 32) + '<span><strong>' + esc(l.nome) + '</strong>' +
          (l.origem === 'vereador2024' ? '<span class="selo suplente" title="Candidato a vereador em 2024 · ' + esc(l.situacao2024 || '') + '">Ver. 2024</span>' : '<span class="selo turno">Manual</span>') +
          (l.nomeCompleto && l.nomeCompleto !== l.nome ? '<br><small class="dica">' + esc(titulo(l.nomeCompleto)) + '</small>' : '') + '</span></span></td>' +
        '<td>' + esc(l.partido || '') + '</td>' +
        '<td class="num">' + (l.origem === 'vereador2024' ? fmtInt(l.votos2024) : '—') + '</td>' +
        '<td class="texto">' + esc(l.apoio2022_estadual || '') + '</td>' +
        '<td class="texto">' + esc(l.apoio2022_federal || '') + '</td>' +
        '<td class="texto">' + esc([l.apoio2024_prefeito ? 'Pref.: ' + l.apoio2024_prefeito : '', l.apoio2024_vereador ? 'Ver.: ' + l.apoio2024_vereador : ''].filter(Boolean).join(' · ')) + '</td>' +
        '<td class="texto">' + esc(apoioTexto(l, 'estadual')) + '</td>' +
        '<td class="texto">' + esc(apoioTexto(l, 'federal')) + '</td>' +
        '<td class="texto">' + esc(majoritarios(l)) + '</td>' +
        '<td class="la-td-acoes"><button type="button" class="btn btn-mini" data-la="editar" data-id="' + l.id + '">Editar</button>' +
          '<button type="button" class="btn btn-mini" data-la="excluir" data-id="' + l.id + '" title="Excluir">×</button></td>' +
        '</tr>').join('') || '<tr><td colspan="10" class="vazio">Nenhuma liderança' + (q ? ' encontrada para "' + esc(ui.busca) + '"' : ' cadastrada') + '.</td></tr>') +
      '</tbody></table></div></section>';
    return html;
  }

  function datalistCandidatos(id, cargo) {
    const lista = candidatos2026().filter((c) => c.cargo === cargo).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    return '<datalist id="' + id + '">' + lista.map((c) => '<option value="' + esc(rotuloCand(c)) + '">').join('') + '</datalist>';
  }

  function renderFormulario(cd, l) {
    const ref = cache[cd] || { prefeitos: [], vereadores: [], estaduais2022: [], federais2022: [] };
    const v = (k) => esc(l ? (l[k] || '') : '');
    const datalist = (id, itens) => '<datalist id="' + id + '">' + itens.map((i) => '<option value="' + esc(i) + '">').join('') + '</datalist>';
    const ehVer = l && l.origem === 'vereador2024';
    const linha2026 = (cargo) => {
      const chave = CHAVE_CARGO[cargo];
      const a = l ? apoio(l, chave) : null;
      return '<div class="la-2026"><span class="rotulo">2026 · ' + esc(cargo) + '</span><div class="la-linha">' +
        '<input name="cand_' + chave + '" list="la-c26-' + chave + '" placeholder="nome do candidato (lista do TSE)" value="' + (a ? esc(rotuloCand(a.c)) : '') + '" autocomplete="off">' +
        datalistCandidatos('la-c26-' + chave, cargo) +
        '<input name="est_' + chave + '" type="number" min="0" step="1" placeholder="votos estimados" value="' + (a && a.estimativa ? a.estimativa : '') + '"></div></div>';
    };
    return '<section class="painel la-form"><div class="painel-cabecalho"><h2>' + (l ? 'Editar liderança' : 'Nova liderança') + '</h2>' +
      (ehVer ? '<span class="dica">Candidato a vereador em 2024 · ' + fmtInt(l.votos2024) + ' votos · ' + esc(l.situacao2024 || '') + '</span>' : '') + '</div>' +
      '<form data-la="form" data-id="' + (l ? l.id : '') + '" class="la-grid">' +
      '<label class="campo"><span>Nome</span><input name="nome" required value="' + v('nome') + '"' + (ehVer ? ' readonly' : '') + '></label>' +
      '<label class="campo"><span>Partido / grupo</span><input name="partido" value="' + v('partido') + '"></label>' +
      '<label class="campo"><span>2022 · trabalhou para (Dep. Estadual)</span><input name="apoio2022_estadual" list="la-est22" value="' + v('apoio2022_estadual') + '" autocomplete="off"></label>' + datalist('la-est22', ref.estaduais2022) +
      '<label class="campo"><span>2022 · trabalhou para (Dep. Federal)</span><input name="apoio2022_federal" list="la-fed22" value="' + v('apoio2022_federal') + '" autocomplete="off"></label>' + datalist('la-fed22', ref.federais2022) +
      '<label class="campo"><span>2024 · apoiou para Prefeito</span><input name="apoio2024_prefeito" list="la-pref24" value="' + v('apoio2024_prefeito') + '" autocomplete="off"></label>' + datalist('la-pref24', ref.prefeitos.map((p) => p.nome + ' (' + p.partido + ')')) +
      (ehVer ? '' : '<label class="campo"><span>2024 · apoiou para Vereador</span><input name="apoio2024_vereador" list="la-ver24" value="' + v('apoio2024_vereador') + '" autocomplete="off"></label>' + datalist('la-ver24', ref.vereadores.map((p) => p.nome + ' (' + p.partido + ')'))) +
      '<div class="la-bloco-2026"><div class="detalhe-sub">Trabalhará em 2026 para</div>' + CARGOS_2026.map(linha2026).join('') +
        '<div class="dica">Digite e escolha na lista (cadastro do TSE de 2026). Candidato que não estiver na lista: <button type="button" class="btn btn-mini" data-la="novo-cand-form">cadastrar manualmente</button></div>' +
        renderNovoCandidato() + '</div>' +
      '<label class="campo la-obs"><span>Observações</span><textarea name="obs" rows="2">' + v('obs') + '</textarea></label>' +
      '<div class="la-form-acoes"><button type="submit" class="btn btn-primario">Salvar</button><button type="button" class="btn" data-la="cancelar">Cancelar</button></div>' +
      '</form></section>';
  }

  function renderNovoCandidato() {
    if (!ui.novoCandidato) return '';
    return '<form data-la="form-cand" class="la-novo-cand">' +
      '<strong>Novo candidato 2026 (manual)</strong>' +
      '<input name="nome" required placeholder="Nome (ex.: Yury do Paredão)">' +
      '<select name="cargo">' + CARGOS_2026.map((c) => '<option value="' + c + '"' + (c === ui.novoCandidato ? ' selected' : '') + '>' + c + '</option>').join('') + '</select>' +
      '<input name="partido" placeholder="Partido">' +
      '<button type="submit" class="btn btn-primario">Adicionar</button><button type="button" class="btn" data-la="cancelar-cand">Cancelar</button></form>';
  }

  function renderGrupos(cd, lista) {
    const cands = candidatos2026();
    if (ui.candidato && !candidato2026(ui.candidato)) ui.candidato = '';
    let html = '<section class="painel"><div class="painel-cabecalho"><h2>Grupo por candidato 2026</h2><span class="dica">Escolha o candidato para ver e montar o grupo de lideranças de ' + esc(ctx.nomeMun) + '.</span></div>' +
      '<div class="la-linha"><select data-la="sel-grupo" class="la-sel-grupo"><option value="">— escolha o candidato —</option>' +
      CARGOS_2026.map((cargo) => {
        const doCargo = cands.filter((c) => c.cargo === cargo).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
        return doCargo.length ? '<optgroup label="' + esc(cargo) + '">' + doCargo.map((c) => '<option value="' + c.id + '"' + (c.id === ui.candidato ? ' selected' : '') + '>' + esc(rotuloCand(c)) + (c.origem === 'manual' ? ' · manual' : '') + '</option>').join('') + '</optgroup>' : '';
      }).join('') +
      '</select><button type="button" class="btn" data-la="novo-cand-grupo">+ Candidato manual</button></div>' + renderNovoCandidato() + '</section>';
    if (!ui.candidato) return html;

    const c = candidato2026(ui.candidato);
    const g = grupo(c.id, cd);
    const gTodos = grupo(c.id, null);
    const municipios = new Set(gTodos.itens.map((i) => i.l.cd_mun));
    const nomeMun = (cdm) => { const m = (ctx.municipios || []).find((x) => x.cd === cdm); return m ? titulo(m.nome) : cdm; };
    const disponiveis = lista.filter((l) => !g.itens.some((i) => i.l.id === l.id)).sort((a, b) => (b.votos2024 || 0) - (a.votos2024 || 0));
    const base2024 = g.itens.reduce((s, i) => s + (i.l.votos2024 || 0), 0);

    html += '<section class="painel la-cand-topo"><span class="cand-linha">' + avatar(c.nome, c.foto, 56) + '<span><strong>' + esc(c.nome) + '</strong> · ' + esc(c.cargo) + (c.numero ? ' · nº ' + esc(c.numero) : '') + (c.partido ? ' · ' + esc(c.partido) : '') +
      (c.nomeCompleto && c.nomeCompleto !== c.nome ? '<br><small class="dica">' + esc(titulo(c.nomeCompleto)) + (c.ocupacao ? ' · ' + esc(titulo(c.ocupacao)) : '') + '</small>' : '') + '</span></span></section>';

    html += '<section class="cards">' +
      card(fmtInt(g.total), 'Expectativa de votos em ' + ctx.nomeMun, g.itens.length + ' lideranças no grupo') +
      card(fmtInt(base2024), 'Votos das lideranças em 2024', 'soma dos votos para vereador (referência)') +
      card(fmtInt(gTodos.total), 'Expectativa total no Ceará', municipios.size + ' município' + (municipios.size === 1 ? '' : 's') + ' com grupo') +
      '</section>';

    html += '<section class="painel"><div class="painel-cabecalho"><h2>Grupo em ' + esc(ctx.nomeMun) + '</h2><span class="dica">A estimativa é editável na própria linha; o total soma as estimativas.</span></div>' +
      '<div class="tabela-scroll"><table class="la-tabela"><thead><tr><th class="pos">#</th><th>Liderança</th><th>Partido</th><th class="num">Votos 2024</th><th>2022 · apoiou</th><th class="num">Estimativa 2026</th><th></th></tr></thead><tbody>' +
      (g.itens.map((i, idx) => '<tr><td class="pos">' + (idx + 1) + '</td>' +
        '<td class="texto"><span class="cand-linha">' + avatar(i.l.nome, i.l.foto, 30) + '<span><strong>' + esc(i.l.nome) + '</strong></span></span></td>' +
        '<td>' + esc(i.l.partido || '') + '</td>' +
        '<td class="num">' + (i.l.origem === 'vereador2024' ? fmtInt(i.l.votos2024) : '—') + '</td>' +
        '<td class="texto">' + esc(g.chave === 'federal' ? i.l.apoio2022_federal : (g.chave === 'estadual' ? i.l.apoio2022_estadual : '')) + '</td>' +
        '<td class="num"><input type="number" min="0" step="1" class="la-est" value="' + (i.estimativa || '') + '" data-la="estimativa" data-id="' + i.l.id + '" data-chave="' + g.chave + '"></td>' +
        '<td class="la-td-acoes"><button type="button" class="btn btn-mini" data-la="remover-grupo" data-id="' + i.l.id + '" data-chave="' + g.chave + '" title="Tirar do grupo">×</button></td></tr>').join('') ||
        '<tr><td colspan="7" class="vazio">Nenhuma liderança no grupo ainda. Adicione abaixo.</td></tr>') +
      '</tbody><tfoot><tr><td colspan="3">Total em ' + esc(ctx.nomeMun) + '</td><td class="num">' + fmtInt(base2024) + '</td><td></td><td class="num">' + fmtInt(g.total) + '</td><td></td></tr></tfoot></table></div>' +
      '<form data-la="form-add" data-chave="' + g.chave + '" class="la-linha la-add">' +
        '<select name="lideranca" required><option value="">— adicionar liderança de ' + esc(ctx.nomeMun) + ' —</option>' +
        disponiveis.map((l) => '<option value="' + l.id + '">' + esc(l.nome) + (l.partido ? ' (' + esc(l.partido) + ')' : '') + (l.origem === 'vereador2024' ? ' · ' + fmtInt(l.votos2024) + ' votos em 2024' : '') + '</option>').join('') +
        '</select><input name="estimativa" type="number" min="0" step="1" placeholder="estimativa de votos"><button type="submit" class="btn btn-primario">Adicionar ao grupo</button>' +
      '</form></section>';

    if (municipios.size > 1) {
      const porMun = new Map();
      for (const i of gTodos.itens) porMun.set(i.l.cd_mun, (porMun.get(i.l.cd_mun) || 0) + i.estimativa);
      html += '<section class="painel"><div class="painel-cabecalho"><h2>Expectativa por município · ' + esc(c.nome) + '</h2></div>' +
        '<div class="tabela-scroll"><table class="la-tabela"><thead><tr><th>Município</th><th class="num">Lideranças</th><th class="num">Estimativa</th></tr></thead><tbody>' +
        Array.from(porMun.entries()).sort((a, b) => b[1] - a[1]).map(([cdm, total]) => '<tr><td>' + esc(nomeMun(cdm)) + '</td><td class="num">' + gTodos.itens.filter((i) => i.l.cd_mun === cdm).length + '</td><td class="num">' + fmtInt(total) + '</td></tr>').join('') +
        '</tbody><tfoot><tr><td>Total</td><td class="num">' + gTodos.itens.length + '</td><td class="num">' + fmtInt(gTodos.total) + '</td></tr></tfoot></table></div></section>';
    }
    return html;
  }

  function renderCandidatos2026() {
    const q = normalizar(ui.busca26);
    const todos = candidatos2026();
    const lista = todos.filter((c) => (!ui.cargo26 || c.cargo === ui.cargo26) && (!q || normalizar(c.nome + ' ' + (c.nomeCompleto || '') + ' ' + c.partido + ' ' + (c.numero || '')).includes(q)))
      .sort((a, b) => CARGOS_2026.indexOf(a.cargo) - CARGOS_2026.indexOf(b.cargo) || (parseInt(a.numero, 10) || 0) - (parseInt(b.numero, 10) || 0) || a.nome.localeCompare(b.nome, 'pt-BR'));
    const contagem = (cargo) => todos.filter((c) => c.cargo === cargo).length;
    const grupos = (id) => { const g = grupo(id, null); return g.itens.length ? fmtInt(g.total) + ' · ' + g.itens.length + ' lid.' : ''; };
    const manuais = dados.candidatos2026;
    const dups = duplicados();
    let painelManuais = '';
    if (manuais.length) {
      const grupoDe = (id) => grupo(id, null);
      painelManuais = '<section class="painel la-dups"><div class="painel-cabecalho"><h2>Candidatos cadastrados manualmente · ' + manuais.length + '</h2>' +
        '<span class="dica">' + (dups.length ? dups.length + ' com possível duplicidade em relação ao cadastro do TSE.' : 'Nenhum coincide com o cadastro do TSE.') + '</span></div>' +
        '<div class="tabela-scroll"><table class="la-tabela"><thead><tr><th>Manual</th><th>Cargo</th><th>Partido</th><th class="num">Lideranças ligadas</th><th>No cadastro do TSE</th><th></th></tr></thead><tbody>' +
        manuais.map((m) => {
          const d = dups.find((x) => x.manual.id === m.id);
          const g = grupoDe(m.id);
          return '<tr' + (d ? ' class="selecionado"' : '') + '><td class="texto"><strong>' + esc(m.nome) + '</strong></td><td>' + esc(m.cargo) + '</td><td>' + esc(m.partido || '') + '</td>' +
            '<td class="num">' + g.itens.length + (g.total ? ' · ' + fmtInt(g.total) + ' votos' : '') + '</td>' +
            '<td class="texto">' + (d ? d.tse.map((t) => '<div class="la-dup-opcao"><span class="cand-linha">' + avatar(t.nome, t.foto, 28) + '<span>' + esc(t.nome) + ' · ' + esc(t.cargo) + ' · nº ' + esc(t.numero) + ' (' + esc(t.partido) + ')' +
                (t.cargo !== m.cargo ? ' <span class="selo turno">cargo diferente</span>' : '') + '</span></span>' +
                '<button type="button" class="btn btn-mini btn-primario" data-la="mesclar" data-manual="' + m.id + '" data-tse="' + t.id + '">Substituir pelo TSE</button></div>').join('') +
                (d.exato ? '' : '<div class="dica">Nome parecido, não idêntico: confira antes de substituir.</div>')
              : '<span class="dica">sem correspondência</span>') + '</td>' +
            '<td class="la-td-acoes"><button type="button" class="btn btn-mini" data-la="excluir-cand" data-id="' + m.id + '" title="Excluir candidato manual">×</button></td></tr>';
        }).join('') + '</tbody></table></div></section>';
    }
    return painelManuais + '<section class="painel"><div class="painel-cabecalho"><h2>Candidatos de 2026</h2><span class="dica">Cadastro do TSE (Eleições Gerais 2026, Ceará e Presidência), com foto oficial. Registro de candidaturas em análise: a situação pode mudar até a eleição.</span></div>' +
      '<div class="la-barra"><div class="segmentado la-abas">' +
        '<button type="button" class="' + (ui.cargo26 === '' ? 'ativo' : '') + '" data-la="cargo26" data-valor="">Todos (' + todos.length + ')</button>' +
        CARGOS_2026.map((c) => '<button type="button" class="' + (ui.cargo26 === c ? 'ativo' : '') + '" data-la="cargo26" data-valor="' + esc(c) + '">' + esc(c) + ' (' + contagem(c) + ')</button>').join('') +
      '</div><input type="search" class="la-busca" placeholder="Buscar por nome, número ou partido" value="' + esc(ui.busca26) + '" data-la="busca26"></div>' +
      '<div class="tabela-scroll"><table class="la-tabela"><thead><tr><th>Candidato</th><th class="num">Número</th><th>Partido</th><th>Cargo</th><th>Ocupação</th><th class="num">Expectativa (grupos)</th></tr></thead><tbody>' +
      (lista.map((c) => '<tr><td class="texto"><span class="cand-linha">' + avatar(c.nome, c.foto, 36) + '<span><strong>' + esc(c.nome) + '</strong>' + (c.origem === 'manual' ? '<span class="selo turno">Manual</span>' : '') +
        (c.nomeCompleto && c.nomeCompleto !== c.nome ? '<br><small class="dica">' + esc(titulo(c.nomeCompleto)) + '</small>' : '') + '</span></span></td>' +
        '<td class="num">' + esc(c.numero || '') + '</td><td>' + esc(c.partido || '') + '</td><td>' + esc(c.cargo) + '</td><td class="texto">' + esc(titulo(c.ocupacao || '')) + '</td>' +
        '<td class="num">' + (grupos(c.id) ? '<button type="button" class="btn btn-mini" data-la="ver-grupo" data-id="' + c.id + '">' + grupos(c.id) + '</button>' : '') + '</td></tr>').join('') ||
        '<tr><td colspan="6" class="vazio">Nenhum candidato encontrado.</td></tr>') +
      '</tbody></table></div></section>';
  }

  function card(valor, rotulo, detalhe) {
    return '<div class="card"><div class="card-topo"><div><div class="card-rotulo">' + esc(rotulo) + '</div><div class="card-valor">' + esc(valor) + '</div></div></div>' +
      (detalhe ? '<div class="card-rodape"><span>' + esc(detalhe) + '</span></div>' : '') + '</div>';
  }

  // ---------- ações ----------
  function salvarFormulario(form) {
    const f = new FormData(form);
    const id = form.dataset.id;
    const l = id ? porId(id) : null;
    const nome = String(f.get('nome') || '').trim();
    if (!nome) return;
    const reg = l || { id: novoId('l'), cd_mun: ctx.cdMun, origem: 'manual', criadoEm: agora(), apoio2026: {} };
    if (reg.origem !== 'vereador2024') reg.nome = nome;
    reg.partido = String(f.get('partido') || '').trim();
    reg.apoio2022_estadual = String(f.get('apoio2022_estadual') || '').trim();
    reg.apoio2022_federal = String(f.get('apoio2022_federal') || '').trim();
    reg.apoio2024_prefeito = String(f.get('apoio2024_prefeito') || '').trim();
    if (reg.origem !== 'vereador2024') reg.apoio2024_vereador = String(f.get('apoio2024_vereador') || '').trim();
    reg.obs = String(f.get('obs') || '').trim();
    reg.apoio2026 = reg.apoio2026 || {};
    const naoEncontrados = [];
    for (const cargo of CARGOS_2026) {
      const chave = CHAVE_CARGO[cargo];
      const texto = String(f.get('cand_' + chave) || '').trim();
      const est = parseInt(f.get('est_' + chave), 10);
      if (!texto) { reg.apoio2026[chave] = null; continue; }
      const c = resolverCandidato(texto, cargo);
      if (!c) { naoEncontrados.push(cargo + ': "' + texto + '"'); continue; }
      reg.apoio2026[chave] = { candidato_id: c.id, estimativa: isNaN(est) ? 0 : est };
    }
    if (naoEncontrados.length) {
      alert('Candidato não encontrado na lista de 2026 (escolha um nome da lista ou cadastre manualmente):\n' + naoEncontrados.join('\n'));
      return;
    }
    if (!l) dados.liderancas.push(reg);
    ui.editando = null; ui.novoCandidato = false;
    salvar(); render();
  }

  function criarCandidato(form) {
    const f = new FormData(form);
    const nome = String(f.get('nome') || '').trim();
    if (!nome) return null;
    const c = { id: novoId('c'), nome, cargo: String(f.get('cargo') || CARGOS_2026[0]), partido: String(f.get('partido') || '').trim(), criadoEm: agora() };
    dados.candidatos2026.push(c);
    salvar();
    return c;
  }

  function aoClicar(ev) {
    const alvo = ev.target.closest('[data-la]');
    if (!alvo) return;
    const acao = alvo.dataset.la;
    if (acao === 'aba') { ui.aba = alvo.dataset.valor; ui.editando = null; ui.novoCandidato = false; render(); }
    else if (acao === 'cargo26') { ui.cargo26 = alvo.dataset.valor; render(); }
    else if (acao === 'fechar-aviso') { ui.aviso = ''; render(); }
    else if (acao === 'nova') { ui.aba = 'liderancas'; ui.editando = 'nova'; render(); const i = ctx.el.querySelector('.la-form input[name="nome"]'); if (i) i.focus(); }
    else if (acao === 'editar') { ui.aba = 'liderancas'; ui.editando = alvo.dataset.id; render(); const f = ctx.el.querySelector('.la-form'); if (f) f.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    else if (acao === 'cancelar') { ui.editando = null; ui.novoCandidato = false; render(); }
    else if (acao === 'cancelar-cand') { ui.novoCandidato = false; render(); }
    else if (acao === 'excluir') {
      const l = porId(alvo.dataset.id);
      if (l && confirm('Excluir a liderança "' + l.nome + '"?')) { dados.liderancas = dados.liderancas.filter((x) => x.id !== l.id); salvar(); render(); }
    }
    else if (acao === 'exportar') exportar();
    else if (acao === 'novo-cand-grupo' || acao === 'novo-cand-form') { ui.novoCandidato = CARGOS_2026[4]; render(); const i = ctx.el.querySelector('.la-novo-cand input[name="nome"]'); if (i) i.focus(); }
    else if (acao === 'ver-grupo') { ui.aba = 'grupos'; ui.candidato = alvo.dataset.id; render(); }
    else if (acao === 'mesclar') {
      const m = dados.candidatos2026.find((c) => c.id === alvo.dataset.manual);
      const t = candidato2026(alvo.dataset.tse);
      if (!m || !t) return;
      if (!confirm('Substituir o candidato manual "' + m.nome + '" (' + m.cargo + ') por "' + t.nome + '" (' + t.cargo + ', nº ' + t.numero + ', ' + t.partido + ') do TSE? As lideranças ligadas passam para o candidato do TSE' + (m.cargo !== t.cargo ? ', no cargo ' + t.cargo : '') + '.')) return;
      const n = mesclar(m.id, t.id);
      render();
      alert('Feito: ' + n + ' liderança(s) migrada(s) e o cadastro manual removido.');
    }
    else if (acao === 'excluir-cand') {
      const m = dados.candidatos2026.find((c) => c.id === alvo.dataset.id);
      if (!m) return;
      const g = grupo(m.id, null);
      if (!confirm('Excluir o candidato manual "' + m.nome + '"?' + (g.itens.length ? ' ' + g.itens.length + ' liderança(s) perderão esse apoio.' : ''))) return;
      for (const l of dados.liderancas) { const k = CHAVE_CARGO[m.cargo]; if (l.apoio2026 && l.apoio2026[k] && l.apoio2026[k].candidato_id === m.id) l.apoio2026[k] = null; }
      dados.candidatos2026 = dados.candidatos2026.filter((c) => c.id !== m.id);
      if (ui.candidato === m.id) ui.candidato = '';
      salvar(); render();
    }
    else if (acao === 'remover-grupo') {
      const l = porId(alvo.dataset.id);
      if (l && l.apoio2026) { l.apoio2026[alvo.dataset.chave] = null; salvar(); render(); }
    }
  }

  function aoMudar(ev) {
    const alvo = ev.target.closest('[data-la]');
    if (!alvo) return;
    const acao = alvo.dataset.la;
    if (acao === 'importar' && alvo.files && alvo.files[0]) { importar(alvo.files[0]); alvo.value = ''; }
    else if (acao === 'sel-grupo') { ui.candidato = alvo.value; render(); }
    else if (acao === 'estimativa') {
      const l = porId(alvo.dataset.id);
      if (l && l.apoio2026 && l.apoio2026[alvo.dataset.chave]) { l.apoio2026[alvo.dataset.chave].estimativa = parseInt(alvo.value, 10) || 0; salvar(); render(); }
    }
  }

  function aoDigitar(ev) {
    const alvo = ev.target.closest('[data-la="busca"], [data-la="busca26"]');
    if (!alvo) return;
    const campo = alvo.dataset.la;
    if (campo === 'busca') ui.busca = alvo.value; else ui.busca26 = alvo.value;
    const pos = alvo.selectionStart;
    render();
    const novo = ctx.el.querySelector('[data-la="' + campo + '"]');
    if (novo) { novo.focus(); try { novo.setSelectionRange(pos, pos); } catch (e) { /* ignora */ } }
  }

  function aoSubmeter(ev) {
    const form = ev.target.closest('form[data-la]');
    if (!form) return;
    ev.preventDefault();
    const tipo = form.dataset.la;
    if (tipo === 'form') salvarFormulario(form);
    else if (tipo === 'form-cand') {
      // formulário de candidato manual pode estar dentro do formulário de liderança: preserva o que foi digitado
      const formLid = ctx.el.querySelector('form[data-la="form"]');
      const digitado = formLid ? Object.fromEntries(new FormData(formLid).entries()) : null;
      const c = criarCandidato(form);
      ui.novoCandidato = false;
      if (c && ui.aba === 'grupos') ui.candidato = c.id;
      render();
      if (c && digitado) {
        const novoForm = ctx.el.querySelector('form[data-la="form"]');
        if (novoForm) {
          for (const [k, v] of Object.entries(digitado)) { const campo = novoForm.elements[k]; if (campo && !campo.readOnly) campo.value = v; }
          const campo = novoForm.elements['cand_' + CHAVE_CARGO[c.cargo]];
          if (campo) campo.value = rotuloCand(c);
        }
      }
    }
    else if (tipo === 'form-add') {
      const f = new FormData(form);
      const l = porId(String(f.get('lideranca') || ''));
      if (!l) return;
      l.apoio2026 = l.apoio2026 || {};
      l.apoio2026[form.dataset.chave] = { candidato_id: ui.candidato, estimativa: parseInt(f.get('estimativa'), 10) || 0 };
      salvar(); render();
    }
  }

  let eventosLigados = false;
  function ligarEventos(raiz) {
    if (eventosLigados) return;
    eventosLigados = true;
    raiz.addEventListener('click', aoClicar);
    raiz.addEventListener('change', aoMudar);
    raiz.addEventListener('input', aoDigitar);
    raiz.addEventListener('submit', aoSubmeter);
  }

  /** Ponto de entrada chamado pelo app: contexto = { el, cdMun, nomeMun, municipios, candidatos2026?, fotos2026? }. */
  async function mostrar(contexto) {
    ctx = contexto;
    ligarEventos(ctx.el);
    ctx.el.innerHTML = '<section class="painel"><div class="vazio">Carregando lideranças…</div></section>';
    await Promise.all([carregar(), carregarTse2026()]);
    const unificados = unificarConhecidos();
    if (unificados.length) ui.aviso = 'Unificados com o cadastro do TSE: ' + unificados.join('; ') + '.';
    if (ctx.cdMun && ctx.cdMun !== 'todos') {
      await referencias(ctx.cdMun);
      await importarVereadores(ctx.cdMun);
    }
    render();
  }

  global.Liderancas = { mostrar, exportar };
})(window);
