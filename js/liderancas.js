/* Mapeamento de lideranças municipais.
   Cadastro de lideranças por município (candidatos a vereador de 2024 entram automaticamente),
   apoios em 2022/2024/2026 e grupos por candidato de 2026 com estimativa de votos.
   Os dados ficam no navegador (localStorage) e podem ser exportados/importados em JSON;
   um arquivo data/liderancas.json, se existir, serve de base inicial. */
(function (global) {
  'use strict';

  const CHAVE = 'eleicoes-ce-liderancas-v1';
  const ARQUIVO_BASE = 'data/liderancas.json';
  const CARGOS_2026 = ['Deputado Estadual', 'Deputado Federal'];
  const CHAVE_CARGO = { 'Deputado Estadual': 'estadual', 'Deputado Federal': 'federal' };

  let dados = null; // { versao, liderancas: [], candidatos2026: [], importados: {}, atualizadoEm }
  let ctx = null;   // contexto passado pelo app (município atual, utilitários)
  const cache = {}; // por município: listas de referência (vereadores/prefeitos 2024, deputados 2022)
  const ui = { aba: 'liderancas', candidato: '', editando: null, busca: '', novoCandidato: false };

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
        if (!confirm('Substituir o cadastro atual pelo arquivo importado (' + json.liderancas.length + ' lideranças, ' + (json.candidatos2026 || []).length + ' candidatos 2026)?')) return;
        dados = Object.assign(vazio(), json);
        salvar();
        render();
      } catch (e) { alert('Arquivo inválido: ' + e.message); }
    };
    leitor.readAsText(arquivo);
  }

  // ---------- referência: candidatos do município em 2022 e 2024 ----------
  async function referencias(cd) {
    if (cache[cd]) return cache[cd];
    const [c24, v24, c22] = await Promise.all([
      lerCsv('data/2024-1/' + cd + '/candidatos.csv'),
      lerCsv('data/2024-1/' + cd + '/votos.csv'),
      lerCsv('data/2022-1/' + cd + '/candidatos.csv'),
    ]);
    const votos = new Map(); // cargo|numero -> votos
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
        apoio2026: { estadual: null, federal: null }, obs: '', criadoEm: agora(),
      });
      n++;
    }
    dados.importados[cd] = true;
    salvar();
    return n;
  }

  // ---------- consultas ----------
  const doMunicipio = (cd) => dados.liderancas.filter((l) => l.cd_mun === cd);
  const candidato2026 = (id) => dados.candidatos2026.find((c) => c.id === id) || null;
  const porId = (id) => dados.liderancas.find((l) => l.id === id) || null;

  function apoioTexto(l, chave) {
    const a = l.apoio2026 && l.apoio2026[chave];
    if (!a || !a.candidato_id) return '';
    const c = candidato2026(a.candidato_id);
    return c ? c.nome + (a.estimativa ? ' · ' + fmtInt(a.estimativa) : '') : '';
  }

  function grupo(candId, cd) {
    const c = candidato2026(candId);
    if (!c) return { itens: [], total: 0 };
    const chave = CHAVE_CARGO[c.cargo];
    const itens = dados.liderancas
      .filter((l) => (!cd || l.cd_mun === cd) && l.apoio2026 && l.apoio2026[chave] && l.apoio2026[chave].candidato_id === candId)
      .map((l) => ({ l, estimativa: Number(l.apoio2026[chave].estimativa) || 0 }))
      .sort((a, b) => b.estimativa - a.estimativa || (b.l.votos2024 || 0) - (a.l.votos2024 || 0));
    return { itens, total: itens.reduce((s, i) => s + i.estimativa, 0), chave };
  }

  // ---------- render ----------
  function render() {
    if (!ctx || !dados) return;
    const raiz = ctx.el;
    if (!ctx.cdMun || ctx.cdMun === 'todos') {
      raiz.innerHTML = '<section class="painel"><div class="vazio">Escolha um município na barra lateral para mapear as lideranças dele.</div></section>';
      return;
    }
    const cd = ctx.cdMun;
    const lista = doMunicipio(cd);
    const cab = '<section class="painel la-cabecalho">' +
      '<div class="painel-cabecalho"><h2>Lideranças · ' + esc(ctx.nomeMun) + '</h2><span class="dica">' + lista.length + ' lideranças cadastradas · dados salvos neste navegador</span></div>' +
      '<div class="la-barra">' +
        '<div class="segmentado la-abas">' +
          '<button type="button" class="' + (ui.aba === 'liderancas' ? 'ativo' : '') + '" data-la="aba" data-valor="liderancas">Lideranças</button>' +
          '<button type="button" class="' + (ui.aba === 'grupos' ? 'ativo' : '') + '" data-la="aba" data-valor="grupos">Grupos 2026</button>' +
        '</div>' +
        '<div class="la-acoes">' +
          '<button type="button" class="btn" data-la="nova">+ Nova liderança</button>' +
          '<button type="button" class="btn" data-la="exportar" title="Baixa um arquivo JSON com todo o cadastro">Exportar</button>' +
          '<label class="btn">Importar<input type="file" accept="application/json,.json" data-la="importar" hidden></label>' +
        '</div>' +
      '</div></section>';
    raiz.innerHTML = cab + (ui.aba === 'grupos' ? renderGrupos(cd, lista) : renderLiderancas(cd, lista));
  }

  function renderLiderancas(cd, lista) {
    const q = normalizar(ui.busca);
    const filtradas = (q ? lista.filter((l) => normalizar(l.nome + ' ' + (l.nomeCompleto || '') + ' ' + l.partido + ' ' + l.apoio2022_estadual + ' ' + l.apoio2022_federal + ' ' + apoioTexto(l, 'estadual') + ' ' + apoioTexto(l, 'federal')).includes(q)) : lista)
      .slice().sort((a, b) => (b.votos2024 || 0) - (a.votos2024 || 0) || a.nome.localeCompare(b.nome, 'pt-BR'));

    let html = '';
    if (ui.editando !== null) html += renderFormulario(cd, ui.editando === 'nova' ? null : porId(ui.editando));

    html += '<section class="painel"><div class="painel-cabecalho"><h2>Cadastro</h2>' +
      '<input type="search" class="la-busca" placeholder="Buscar liderança, partido ou apoio" value="' + esc(ui.busca) + '" data-la="busca"></div>' +
      '<div class="tabela-scroll"><table class="la-tabela"><thead><tr>' +
      '<th>Liderança</th><th>Partido</th><th class="num">Votos 2024</th><th>2022 · Dep. Estadual</th><th>2022 · Dep. Federal</th><th>2024 · apoiou</th><th>2026 · Dep. Estadual</th><th>2026 · Dep. Federal</th><th></th>' +
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
        '<td class="la-td-acoes"><button type="button" class="btn btn-mini" data-la="editar" data-id="' + l.id + '">Editar</button>' +
          '<button type="button" class="btn btn-mini" data-la="excluir" data-id="' + l.id + '" title="Excluir">×</button></td>' +
        '</tr>').join('') || '<tr><td colspan="9" class="vazio">Nenhuma liderança' + (q ? ' encontrada para "' + esc(ui.busca) + '"' : ' cadastrada') + '.</td></tr>') +
      '</tbody></table></div></section>';
    return html;
  }

  function opcoesCandidatos(cargo, selecionado) {
    const lista = dados.candidatos2026.filter((c) => c.cargo === cargo).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    return '<option value="">— nenhum —</option>' + lista.map((c) => '<option value="' + c.id + '"' + (c.id === selecionado ? ' selected' : '') + '>' + esc(c.nome) + (c.partido ? ' (' + esc(c.partido) + ')' : '') + '</option>').join('') +
      '<option value="__novo__">+ cadastrar candidato…</option>';
  }

  function renderFormulario(cd, l) {
    const ref = cache[cd] || { prefeitos: [], vereadores: [], estaduais2022: [], federais2022: [] };
    const v = (k) => esc(l ? (l[k] || '') : '');
    const ap = (chave) => (l && l.apoio2026 && l.apoio2026[chave]) || { candidato_id: '', estimativa: '' };
    const datalist = (id, itens) => '<datalist id="' + id + '">' + itens.map((i) => '<option value="' + esc(i) + '">').join('') + '</datalist>';
    const ehVer = l && l.origem === 'vereador2024';
    return '<section class="painel la-form"><div class="painel-cabecalho"><h2>' + (l ? 'Editar liderança' : 'Nova liderança') + '</h2>' +
      (ehVer ? '<span class="dica">Candidato a vereador em 2024 · ' + fmtInt(l.votos2024) + ' votos · ' + esc(l.situacao2024 || '') + '</span>' : '') + '</div>' +
      '<form data-la="form" data-id="' + (l ? l.id : '') + '" class="la-grid">' +
      '<label class="campo"><span>Nome</span><input name="nome" required value="' + v('nome') + '"' + (ehVer ? ' readonly' : '') + '></label>' +
      '<label class="campo"><span>Partido / grupo</span><input name="partido" value="' + v('partido') + '"></label>' +
      '<label class="campo"><span>2022 · trabalhou para (Dep. Estadual)</span><input name="apoio2022_estadual" list="la-est22" value="' + v('apoio2022_estadual') + '"></label>' + datalist('la-est22', ref.estaduais2022) +
      '<label class="campo"><span>2022 · trabalhou para (Dep. Federal)</span><input name="apoio2022_federal" list="la-fed22" value="' + v('apoio2022_federal') + '"></label>' + datalist('la-fed22', ref.federais2022) +
      '<label class="campo"><span>2024 · apoiou para Prefeito</span><input name="apoio2024_prefeito" list="la-pref24" value="' + v('apoio2024_prefeito') + '"></label>' + datalist('la-pref24', ref.prefeitos.map((p) => p.nome + ' (' + p.partido + ')')) +
      (ehVer ? '' : '<label class="campo"><span>2024 · apoiou para Vereador</span><input name="apoio2024_vereador" list="la-ver24" value="' + v('apoio2024_vereador') + '"></label>' + datalist('la-ver24', ref.vereadores.map((p) => p.nome + ' (' + p.partido + ')'))) +
      '<div class="la-2026"><span class="rotulo">2026 · Deputado Estadual</span><div class="la-linha">' +
        '<select name="cand_estadual" data-la="sel-cand" data-cargo="Deputado Estadual">' + opcoesCandidatos('Deputado Estadual', ap('estadual').candidato_id) + '</select>' +
        '<input name="est_estadual" type="number" min="0" step="1" placeholder="votos estimados" value="' + esc(ap('estadual').estimativa || '') + '"></div></div>' +
      '<div class="la-2026"><span class="rotulo">2026 · Deputado Federal</span><div class="la-linha">' +
        '<select name="cand_federal" data-la="sel-cand" data-cargo="Deputado Federal">' + opcoesCandidatos('Deputado Federal', ap('federal').candidato_id) + '</select>' +
        '<input name="est_federal" type="number" min="0" step="1" placeholder="votos estimados" value="' + esc(ap('federal').estimativa || '') + '"></div></div>' +
      '<label class="campo la-obs"><span>Observações</span><textarea name="obs" rows="2">' + v('obs') + '</textarea></label>' +
      '<div class="la-form-acoes"><button type="submit" class="btn btn-primario">Salvar</button><button type="button" class="btn" data-la="cancelar">Cancelar</button></div>' +
      '</form>' + renderNovoCandidato() + '</section>';
  }

  function renderNovoCandidato() {
    if (!ui.novoCandidato) return '';
    return '<form data-la="form-cand" class="la-novo-cand">' +
      '<strong>Novo candidato 2026</strong>' +
      '<input name="nome" required placeholder="Nome (ex.: Yury do Paredão)">' +
      '<select name="cargo">' + CARGOS_2026.map((c) => '<option value="' + c + '"' + (c === ui.novoCandidato ? ' selected' : '') + '>' + c + '</option>').join('') + '</select>' +
      '<input name="partido" placeholder="Partido">' +
      '<button type="submit" class="btn btn-primario">Adicionar</button><button type="button" class="btn" data-la="cancelar-cand">Cancelar</button></form>';
  }

  function renderGrupos(cd, lista) {
    const cands = dados.candidatos2026.slice().sort((a, b) => a.cargo.localeCompare(b.cargo) || a.nome.localeCompare(b.nome, 'pt-BR'));
    if (ui.candidato && !candidato2026(ui.candidato)) ui.candidato = '';
    let html = '<section class="painel"><div class="painel-cabecalho"><h2>Grupo por candidato 2026</h2><span class="dica">Escolha o candidato para ver e montar o grupo de lideranças de ' + esc(ctx.nomeMun) + '.</span></div>' +
      '<div class="la-linha"><select data-la="sel-grupo" class="la-sel-grupo"><option value="">— escolha o candidato —</option>' +
      cands.map((c) => '<option value="' + c.id + '"' + (c.id === ui.candidato ? ' selected' : '') + '>' + esc(c.nome) + ' · ' + esc(c.cargo) + (c.partido ? ' (' + esc(c.partido) + ')' : '') + '</option>').join('') +
      '</select><button type="button" class="btn" data-la="novo-cand-grupo">+ Novo candidato 2026</button></div>' + renderNovoCandidato() + '</section>';
    if (!ui.candidato) return html;

    const c = candidato2026(ui.candidato);
    const g = grupo(c.id, cd);
    const gTodos = grupo(c.id, null);
    const municipios = new Set(gTodos.itens.map((i) => i.l.cd_mun));
    const nomeMun = (cdm) => { const m = (ctx.municipios || []).find((x) => x.cd === cdm); return m ? titulo(m.nome) : cdm; };
    const disponiveis = lista.filter((l) => !g.itens.some((i) => i.l.id === l.id)).sort((a, b) => (b.votos2024 || 0) - (a.votos2024 || 0));
    const base2024 = g.itens.reduce((s, i) => s + (i.l.votos2024 || 0), 0);

    html += '<section class="cards">' +
      card(fmtInt(g.total), 'Expectativa de votos em ' + ctx.nomeMun, g.itens.length + ' lideranças no grupo') +
      card(fmtInt(base2024), 'Votos das lideranças em 2024', 'soma dos votos para vereador (referência)') +
      card(fmtInt(gTodos.total), 'Expectativa total no Ceará', municipios.size + ' município' + (municipios.size === 1 ? '' : 's') + ' com grupo') +
      '</section>';

    html += '<section class="painel"><div class="painel-cabecalho"><h2>' + esc(c.nome) + ' · ' + esc(c.cargo) + ' · ' + esc(ctx.nomeMun) + '</h2><span class="dica">A estimativa é editável na própria linha; o total soma as estimativas.</span></div>' +
      '<div class="tabela-scroll"><table class="la-tabela"><thead><tr><th class="pos">#</th><th>Liderança</th><th>Partido</th><th class="num">Votos 2024</th><th>2022 · apoiou</th><th class="num">Estimativa 2026</th><th></th></tr></thead><tbody>' +
      (g.itens.map((i, idx) => '<tr><td class="pos">' + (idx + 1) + '</td>' +
        '<td class="texto"><span class="cand-linha">' + avatar(i.l.nome, i.l.foto, 30) + '<span><strong>' + esc(i.l.nome) + '</strong></span></span></td>' +
        '<td>' + esc(i.l.partido || '') + '</td>' +
        '<td class="num">' + (i.l.origem === 'vereador2024' ? fmtInt(i.l.votos2024) : '—') + '</td>' +
        '<td class="texto">' + esc(g.chave === 'estadual' ? i.l.apoio2022_estadual : i.l.apoio2022_federal) + '</td>' +
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
    for (const chave of ['estadual', 'federal']) {
      const cid = String(f.get('cand_' + chave) || '');
      const est = parseInt(f.get('est_' + chave), 10);
      reg.apoio2026[chave] = cid && cid !== '__novo__' ? { candidato_id: cid, estimativa: isNaN(est) ? 0 : est } : null;
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
    else if (acao === 'nova') { ui.aba = 'liderancas'; ui.editando = 'nova'; render(); ctx.el.querySelector('.la-form input[name="nome"]').focus(); }
    else if (acao === 'editar') { ui.aba = 'liderancas'; ui.editando = alvo.dataset.id; render(); ctx.el.querySelector('.la-form').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    else if (acao === 'cancelar') { ui.editando = null; ui.novoCandidato = false; render(); }
    else if (acao === 'cancelar-cand') { ui.novoCandidato = false; render(); }
    else if (acao === 'excluir') {
      const l = porId(alvo.dataset.id);
      if (l && confirm('Excluir a liderança "' + l.nome + '"?')) { dados.liderancas = dados.liderancas.filter((x) => x.id !== l.id); salvar(); render(); }
    }
    else if (acao === 'exportar') exportar();
    else if (acao === 'novo-cand-grupo') { ui.novoCandidato = CARGOS_2026[0]; render(); }
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
    else if (acao === 'sel-cand' && alvo.value === '__novo__') { ui.novoCandidato = alvo.dataset.cargo; alvo.value = ''; render(); ctx.el.querySelector('.la-novo-cand input[name="nome"]').focus(); }
    else if (acao === 'estimativa') {
      const l = porId(alvo.dataset.id);
      if (l && l.apoio2026 && l.apoio2026[alvo.dataset.chave]) { l.apoio2026[alvo.dataset.chave].estimativa = parseInt(alvo.value, 10) || 0; salvar(); render(); }
    }
  }

  function aoDigitar(ev) {
    const alvo = ev.target.closest('[data-la="busca"]');
    if (!alvo) return;
    ui.busca = alvo.value;
    const pos = alvo.selectionStart;
    render();
    const novo = ctx.el.querySelector('[data-la="busca"]');
    if (novo) { novo.focus(); try { novo.setSelectionRange(pos, pos); } catch (e) { /* ignora */ } }
  }

  function aoSubmeter(ev) {
    const form = ev.target.closest('form[data-la]');
    if (!form) return;
    ev.preventDefault();
    const tipo = form.dataset.la;
    if (tipo === 'form') salvarFormulario(form);
    else if (tipo === 'form-cand') {
      const c = criarCandidato(form);
      ui.novoCandidato = false;
      if (c && ui.aba === 'grupos') ui.candidato = c.id;
      // se estava editando uma liderança, mantém o formulário aberto e já seleciona o novo candidato
      if (ui.editando !== null) {
        render();
        const sel = ctx.el.querySelector('select[name="cand_' + CHAVE_CARGO[c.cargo] + '"]');
        if (sel) sel.value = c.id;
        return;
      }
      render();
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

  /** Ponto de entrada chamado pelo app: contexto = { el, cdMun, nomeMun, municipios }. */
  async function mostrar(contexto) {
    ctx = contexto;
    ligarEventos(ctx.el);
    await carregar();
    if (ctx.cdMun && ctx.cdMun !== 'todos') {
      ctx.el.innerHTML = '<section class="painel"><div class="vazio">Carregando lideranças de ' + esc(ctx.nomeMun) + '…</div></section>';
      await referencias(ctx.cdMun);
      await importarVereadores(ctx.cdMun);
    }
    render();
  }

  global.Liderancas = { mostrar, exportar };
})(window);
