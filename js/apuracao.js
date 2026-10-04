/* Apuração paralela 2026 — boletins de urna lançados seção a seção pela equipe.
   Mostra os votos apurados, as seções apuradas (ex.: 2/96) e, por bairro, o percentual dos candidatos
   configurados em data/apuracao.json (a nossa chapa e os adversários acompanhados).
   Percentual = votos do candidato / votos válidos do cargo na área (comparecimento − brancos − nulos).
   Os boletins ficam no Supabase (tabela apuracao, scripts/supabase-apuracao.sql): qualquer pessoa vê,
   só usuários aprovados lançam. Sem banco configurado, ficam no navegador (localStorage). */
(function (global) {
  'use strict';

  const ARQUIVO_CONFIG = 'data/apuracao.json';
  const CHAVE_LOCAL = 'eleicoes-ce-apuracao-v1';
  const CHAVE_VISTA = 'eleicoes-ce-apuracao-vista';
  const INTERVALO = 20000; // atualização automática, em ms
  const ORDEM_BU = ['Deputado Federal', 'Deputado Estadual', 'Senador', 'Governador', 'Presidente']; // ordem dos cargos no boletim
  const CHAVE_CARGO = { Presidente: 'presidente', Governador: 'governador', Senador: 'senador', 'Deputado Federal': 'federal', 'Deputado Estadual': 'estadual' };
  const CARGO_CURTO = { 'Deputado Federal': 'Dep. federal', 'Deputado Estadual': 'Dep. estadual' };
  // cargos com lista aberta: além dos candidatos do data/apuracao.json, entram os apoiados pelas lideranças dos
  // municípios; no placar aparecem os 3 mais votados (e os da chapa), com "ver mais" para os demais
  const CARGOS_ABERTOS = ['Deputado Federal', 'Deputado Estadual'];
  const CHAVE_APOIO = { 'Deputado Federal': 'federal', 'Deputado Estadual': 'estadual' };
  const TOP = 3;

  let cfg = null;              // data/apuracao.json (+ cfg.cargos na ordem do placar)
  let ctx = null;              // { el, candidatos2026, fotos2026, irPara }
  const base = new Map();      // cd -> [{ secao, zona, bairro, local, aptos }] (lista de seções do arquivo)
  let regs = new Map();        // id -> { id, cd_mun, secao, dados, atualizado_em, atualizado_por }
  const cadastro = new Map();  // cargo|numero -> { sq, cargo, numero, nome, partido, foto } (candidatos 2026 do TSE)
  const cadastroSq = new Map(); // sq -> o mesmo registro (as lideranças guardam o candidato como "tse:<sq>")
  let apoiados = [];           // deputados apoiados por lideranças dos municípios: [{ cargo, numero, nome, chapa: false }]
  let cargaApoiados = null;    // promessa da leitura das lideranças (só para quem lança)
  let perfilAtual = null;
  let carga = null;            // promessa da carga inicial (config, seções, cadastro, perfil)
  let assinatura = null;       // muda quando algum boletim muda (evita redesenhar à toa)
  let ultimaLeitura = null;
  let timer = null;
  const ui = { vista: 'todos', abertos: new Set(), cargosAbertos: new Set(), respAbertos: new Set(), leitura: null, erroApoiados: '', modal: null, form: null, erro: '', erroLogin: '', aviso: '', erroCarga: '', erroLeitura: '', semTabela: false };

  // ---------- utilidades ----------
  const MAPA_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => MAPA_ESC[c]);
  const fmtInt = (n) => (Number(n) || 0).toLocaleString('pt-BR');
  const fmtPct = (n) => (isFinite(n) ? n : 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
  const pct = (a, b) => (b > 0 ? (100 * a) / b : 0);
  const normalizar = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const titulo = (s) => String(s || '').toLowerCase()
    .replace(/(^|[\s\-\/(])([^\s(])/g, (m, p, c) => p + c.toUpperCase())
    .replace(/ (De|Do|Da|Dos|Das|E) /g, (m) => m.toLowerCase());
  const num = (v) => { const n = parseInt(v, 10); return isFinite(n) && n > 0 ? n : 0; };
  const hora = (d) => new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const chaveCargo = (cargo) => CHAVE_CARGO[cargo] || normalizar(cargo).replace(/[^a-z0-9]+/g, '_');
  const chaveBairro = (b) => String(b || '').trim().replace(/\s+/g, ' ').toUpperCase() || 'SEM BAIRRO';
  const normSecao = (s) => { const t = String(s == null ? '' : s).trim(); return /^\d{1,4}$/.test(t) ? String(parseInt(t, 10)) : ''; };
  const idDe = (cd, secao) => cd + '-' + secao;
  const nomeMun = (cd) => { const m = cfg.municipios.find((x) => x.cd === cd); return m ? m.nome : cd; };
  /** Ano da lista de seções em uso no município (a pasta de onde ela veio: data/2026-1/ → 2026). */
  const anoLista = (cd) => { const m = cfg.municipios.find((x) => x.cd === cd); return (m && m.fonte && (m.fonte.match(/(20\d\d)/) || [])[1]) || ''; };
  const aptosTexto = (s) => (s.aptos ? fmtInt(s.aptos) + ' aptos' + (anoLista(s.cd) ? ' em ' + anoLista(s.cd) : '') : '');

  function avatar(nome, foto, tam) {
    const iniciais = String(nome || '').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
    const img = foto ? '<img src="' + esc(foto) + '" alt="" loading="lazy" onerror="this.remove()">' : '';
    return '<span class="avatar" style="width:' + tam + 'px;height:' + tam + 'px">' + img + '<span class="iniciais">' + esc(iniciais) + '</span></span>';
  }

  // ---------- acesso ----------
  const nuvem = () => !!(global.Sync && global.Sync.configurado());
  const usuario = () => (nuvem() ? global.Sync.usuario() : null);
  /** Sem banco, tudo liberado (dados no navegador); com banco, só usuário conectado e aprovado. */
  const podeLancar = () => !nuvem() || (!!usuario() && !!perfilAtual && !!perfilAtual.aprovado);
  // a leitura é pública: grava o nome escolhido no cadastro, nunca o e-mail
  const nomeUsuario = () => (perfilAtual && perfilAtual.nome) || 'equipe';

  // ---------- carga ----------
  async function carregarConfig() {
    const resp = await fetch(ARQUIVO_CONFIG, { cache: 'no-cache' });
    if (!resp.ok) throw new Error(ARQUIVO_CONFIG + ' (' + resp.status + ')');
    cfg = await resp.json();
    cfg.municipios = (cfg.municipios || []).map((m) => ({ cd: String(m.cd), nome: m.nome }));
    cfg.candidatos = (cfg.candidatos || []).map((c) => Object.assign({}, c, { numero: String(c.numero), chapa: c.chapa !== false }));
    cfg.responsaveis = (cfg.responsaveis || []).map((r) => ({ nome: String(r.nome || ''), cd: String(r.cd || ''), areas: (r.areas || []).filter((a) => a && (a.bairro || a.local)) }));
    cfg.cargos = [];
    for (const c of cfg.candidatos) if (!cfg.cargos.includes(c.cargo)) cfg.cargos.push(c.cargo);
    if (!cfg.municipios.length || !cfg.candidatos.length) throw new Error(ARQUIVO_CONFIG + ' sem municípios ou candidatos');
  }

  /** Lista de seções de cada município: a primeira pasta de cfg.secoes que tiver o arquivo (2026; sem ele, 2024). */
  async function carregarSecoes() {
    const pastas = [].concat(cfg.secoes || 'data/2024-1/');
    await Promise.all(cfg.municipios.map(async (m) => {
      for (const pasta of pastas) {
        try {
          const linhas = await global.Csv.carregarCsv(pasta + m.cd + '/secoes.csv');
          base.set(m.cd, linhas.filter((s) => normSecao(s.secao)).map((s) => ({
            secao: normSecao(s.secao), zona: s.zona || '', bairro: chaveBairro(s.bairro), local: s.local || '', aptos: parseInt(s.aptos, 10) || 0,
          })));
          m.fonte = pasta;
          aplicarAjustes(m.cd);
          return;
        } catch (e) { /* tenta a próxima pasta */ }
      }
      base.set(m.cd, []);
    }));
  }

  /** Correções por cima da lista do TRE (cfg.ajustes_secoes): local e/ou bairro de seções específicas. */
  function aplicarAjustes(cd) {
    for (const aj of cfg.ajustes_secoes || []) {
      if (String(aj.cd) !== cd) continue;
      const alvo = new Set((aj.secoes || []).map(normSecao));
      for (const s of base.get(cd) || []) {
        if (!alvo.has(s.secao)) continue;
        if (aj.local) s.local = aj.local;
        if (aj.bairro) s.bairro = chaveBairro(aj.bairro);
      }
    }
  }

  async function carregarCadastro() {
    try {
      const linhas = await global.Csv.carregarCsv(ctx.candidatos2026 || 'data/2026-1/candidatos.csv');
      for (const c of linhas) {
        const reg = { sq: c.sq, cargo: c.cargo, numero: c.numero, nome: titulo(c.nome_urna || c.nome), partido: c.partido || '', foto: c.foto ? (ctx.fotos2026 || 'data/2026-1/fotos/') + c.foto : '' };
        cadastro.set(c.cargo + '|' + c.numero, reg);
        if (c.sq) cadastroSq.set(c.sq, reg);
      }
    } catch (e) { console.warn('Cadastro de candidatos 2026 indisponível:', e); }
  }
  const cadastroDe = (c) => cadastro.get(c.cargo + '|' + c.numero) || { partido: '', foto: '' };

  async function carregarTudo() {
    if (global.Sync) await global.Sync.iniciar();
    // com banco configurado mas sem a biblioteca (CDN bloqueada, internet ruim), não cai para o navegador:
    // a pessoa lançaria boletins que ninguém mais veria
    if (!global.Sync || (global.Sync.esperado() && !global.Sync.configurado())) {
      throw new Error('a conexão com o banco de dados (Supabase) não carregou. Confira a internet e recarregue a página');
    }
    await carregarConfig();
    await Promise.all([carregarSecoes(), carregarCadastro()]);
    if (nuvem()) {
      perfilAtual = usuario() ? await global.Sync.perfil() : null;
      let ultimo = usuario() ? usuario().id : null;
      global.Sync.aoMudarUsuario(async (u) => {
        const id = u ? u.id : null;
        if (id === ultimo) return; // o Supabase repete o evento de sessão; só age quando o usuário muda
        ultimo = id;
        perfilAtual = u ? await global.Sync.perfil() : null;
        cargaApoiados = null; apoiados = []; ui.erroApoiados = '';
        if (ctx && !ctx.el.hidden) { renderCorpo(); if (ui.modal === 'form' && !podeLancar()) fecharModal(); }
      });
    }
    try {
      const v = localStorage.getItem(CHAVE_VISTA);
      if (v && (v === 'todos' || cfg.municipios.some((m) => m.cd === v))) ui.vista = v;
    } catch (e) { /* sem localStorage */ }
  }

  // muda a cada gravação feita nesta tela: a leitura que começou antes dela chega desatualizada e é descartada
  let versaoLocal = 0;

  /** Lê os boletins (nuvem ou navegador). Devolve true se algo mudou desde a última leitura. */
  async function lerBoletins() {
    const versao = versaoLocal;
    let lista;
    if (nuvem()) lista = await global.Sync.carregarApuracao();
    else { try { lista = JSON.parse(localStorage.getItem(CHAVE_LOCAL) || '[]'); } catch (e) { lista = []; } }
    if (versao !== versaoLocal) return false;
    const novo = new Map();
    for (const r of lista || []) if (r && r.id && r.dados) novo.set(r.id, r);
    regs = novo;
    ultimaLeitura = new Date();
    const ass = Array.from(novo.values()).map((r) => r.id + '@' + r.atualizado_em).sort().join('|');
    const mudou = ass !== assinatura;
    assinatura = ass;
    return mudou;
  }

  /**
   * Deputados federais e estaduais apoiados por lideranças de algum dos municípios da apuração (tela Estimativa).
   * As lideranças só podem ser lidas por usuário aprovado, então isto só roda para quem lança boletins; quem
   * só olha a apuração conhece esses candidatos pelos boletins gravados (que guardam todos, com 0 quando vazio).
   */
  function garantirApoiados() {
    if (!podeLancar()) return Promise.resolve(apoiados);
    if (!cargaApoiados) {
      cargaApoiados = (async () => {
        const cds = cfg.municipios.map((m) => m.cd);
        let lids = [];
        let manuais = [];
        if (nuvem()) {
          lids = (await Promise.all(cds.map((cd) => global.Sync.carregarLiderancas(cd)))).flat();
          manuais = await global.Sync.carregarCandidatos().catch(() => []);
        } else {
          try {
            const salvo = JSON.parse(localStorage.getItem('eleicoes-ce-liderancas-v1') || '{}');
            lids = (salvo.liderancas || []).filter((l) => cds.includes(l.cd_mun));
            manuais = salvo.candidatos2026 || [];
          } catch (e) { /* sem lideranças no navegador */ }
        }
        const achados = new Map();
        for (const l of lids) {
          for (const cargo of CARGOS_ABERTOS) {
            const bruto = l.apoio2026 && l.apoio2026[CHAVE_APOIO[cargo]];
            for (const a of (Array.isArray(bruto) ? bruto : bruto ? [bruto] : [])) {
              if (!a || !a.candidato_id) continue;
              const id = String(a.candidato_id);
              let c = id.startsWith('tse:') ? cadastroSq.get(id.slice(4)) : null;
              if (!c) {
                // candidato cadastrado à mão: só entra se tiver número (os votos são gravados pelo número)
                const m = manuais.find((x) => x.id === id);
                if (m && /^\d{4,5}$/.test(String(m.numero || ''))) c = { cargo: m.cargo, numero: String(m.numero), nome: titulo(m.nome), manual: true };
              }
              if (!c || c.cargo !== cargo || achados.has(c.numero)) continue;
              achados.set(c.numero, { cargo: c.cargo, numero: c.numero, nome: c.nome, chapa: false, manual: !!c.manual });
            }
          }
        }
        apoiados = Array.from(achados.values());
        ui.erroApoiados = '';
        return apoiados;
      })().catch((e) => {
        cargaApoiados = null;
        ui.erroApoiados = e.message;
        return apoiados;
      });
    }
    return cargaApoiados;
  }

  /** Cargo de um número que apareceu num boletim: pelo cadastro do TSE; sem cadastro, pelo tamanho (4 = federal, 5 = estadual). */
  function cargoDoNumero(n) {
    for (const cargo of CARGOS_ABERTOS) if (cadastro.has(cargo + '|' + n)) return cargo;
    return n.length === 4 ? 'Deputado Federal' : n.length === 5 ? 'Deputado Estadual' : '';
  }

  /**
   * Candidatos de um cargo: os do data/apuracao.json, os apoiados pelas lideranças e, nos cargos de lista aberta,
   * qualquer outro número gravado nos boletins (com o nome do cadastro do TSE ou o que veio no boletim).
   */
  function candidatosDoCargo(cargo) {
    const lista = new Map();
    for (const c of cfg.candidatos) if (c.cargo === cargo) lista.set(c.numero, c);
    if (!CARGOS_ABERTOS.includes(cargo)) return Array.from(lista.values());
    for (const c of apoiados) if (c.cargo === cargo && !lista.has(c.numero)) lista.set(c.numero, c);
    for (const r of regs.values()) {
      const d = r.dados || {};
      for (const n of Object.keys(d.votos || {})) {
        if (lista.has(n) || !/^\d{4,5}$/.test(n) || cargoDoNumero(n) !== cargo) continue;
        const cad = cadastro.get(cargo + '|' + n);
        lista.set(n, { cargo, numero: n, nome: cad ? cad.nome : ((d.nomes && d.nomes[n]) || 'Candidato ' + n), chapa: false });
      }
    }
    return Array.from(lista.values());
  }

  function tratarErroLeitura(e) {
    const msg = String((e && e.message) || e);
    if (/apuracao/i.test(msg) && /schema cache|does not exist|relation/i.test(msg)) ui.semTabela = true;
    else ui.erroLeitura = msg;
  }

  // ---------- gravação ----------
  function salvarLocal() {
    try { localStorage.setItem(CHAVE_LOCAL, JSON.stringify(Array.from(regs.values()))); }
    catch (e) { throw new Error('Não foi possível salvar neste navegador.'); }
  }

  async function gravar(reg) {
    versaoLocal++;
    if (nuvem()) {
      const salvo = await global.Sync.gravarApuracao(reg, nomeUsuario());
      regs.set(salvo.id, salvo);
    } else {
      regs.set(reg.id, Object.assign({}, reg, { atualizado_em: new Date().toISOString(), atualizado_por: 'este navegador' }));
      salvarLocal();
    }
    assinatura = null;
  }

  async function apagar(id) {
    versaoLocal++;
    if (nuvem()) await global.Sync.excluirApuracao(id);
    regs.delete(id);
    if (!nuvem()) salvarLocal();
    assinatura = null;
  }

  // ---------- consultas ----------
  const situacao = (r) => (!r ? 'pendente' : r.dados.situacao === 'fora' ? 'fora' : r.dados.situacao === 'pendente' ? 'pendente' : 'apurada');

  /** Seções do município: as do arquivo e as incluídas na tela, cada uma com o boletim (se houver) e a situação. */
  function secoesDe(cd) {
    const lista = (base.get(cd) || []).map((s) => Object.assign({}, s, { extra: false }));
    const conhecidas = new Set(lista.map((s) => s.secao));
    for (const r of regs.values()) {
      if (r.cd_mun !== cd || conhecidas.has(r.secao)) continue;
      conhecidas.add(r.secao);
      lista.push({ secao: r.secao, zona: r.dados.zona || '', bairro: chaveBairro(r.dados.bairro), local: r.dados.local || '', aptos: 0, extra: true });
    }
    for (const s of lista) { s.cd = cd; s.reg = regs.get(idDe(cd, s.secao)) || null; s.situacao = situacao(s.reg); }
    return lista.sort((a, b) => parseInt(a.secao, 10) - parseInt(b.secao, 10));
  }

  const validos = (d, k) => Math.max(0, num(d.comparecimento) - num(d.brancos && d.brancos[k]) - num(d.nulos && d.nulos[k]));

  /** Soma as seções apuradas: comparecimento, válidos por cargo e votos de cada candidato acompanhado. */
  function somar(secoes) {
    const t = { total: 0, apuradas: 0, comparecimento: 0, votos: {}, validos: {} };
    for (const s of secoes) {
      if (s.situacao === 'fora') continue;
      t.total++;
      if (s.situacao !== 'apurada') continue;
      t.apuradas++;
      const d = s.reg.dados;
      t.comparecimento += num(d.comparecimento);
      for (const cargo of cfg.cargos) { const k = chaveCargo(cargo); t.validos[k] = (t.validos[k] || 0) + validos(d, k); }
      for (const [n, v] of Object.entries(d.votos || {})) t.votos[n] = (t.votos[n] || 0) + num(v);
    }
    return t;
  }

  /** Quem lidera o cargo entre os acompanhados, só nos cargos com adversário (ex.: Elmano x Ciro). */
  function liderDe(t, cargo) {
    const cands = cfg.candidatos.filter((c) => c.cargo === cargo);
    if (!cands.some((c) => !c.chapa) || !t.apuradas) return '';
    let lider = null;
    for (const c of cands) {
      const v = t.votos[c.numero] || 0;
      if (!lider || v > lider.v) lider = { numero: c.numero, v, empate: false };
      else if (v === lider.v) lider.empate = true;
    }
    return lider && lider.v > 0 && !lider.empate ? lider.numero : '';
  }

  function bairrosDe(secoes) {
    const m = new Map();
    for (const s of secoes) {
      if (!m.has(s.bairro)) m.set(s.bairro, { bairro: s.bairro, secoes: [], aptos: 0 });
      const b = m.get(s.bairro);
      b.secoes.push(s);
      b.aptos += s.aptos;
    }
    // do maior para o menor bairro (eleitorado da lista de seções), como no resto do site
    return Array.from(m.values()).sort((a, b) => b.aptos - a.aptos || b.secoes.length - a.secoes.length || a.bairro.localeCompare(b.bairro, 'pt-BR'));
  }

  function procurarSecao(cd, secao) {
    return secoesDe(cd).find((s) => s.secao === secao) || null;
  }

  // ---------- render ----------
  function render() {
    renderCorpo();
    renderModal();
  }

  function renderCorpo() {
    const alvo = ctx && ctx.el.querySelector('.ap-corpo');
    if (!alvo) return;
    if (ui.erroCarga) {
      alvo.innerHTML = '<section class="painel"><div class="vazio">Não foi possível abrir a apuração: ' + esc(ui.erroCarga) + '</div></section>';
      return;
    }
    if (ui.semTabela) {
      alvo.innerHTML = barraStatus() + '<section class="painel la-bloqueado"><h2>Apuração ainda não ativada no banco</h2>' +
        '<p>Um administrador precisa rodar, uma única vez, o arquivo <strong>scripts/supabase-apuracao.sql</strong> no SQL Editor do Supabase (projeto eleicoes-ceara). Depois, recarregue esta página.</p></section>';
      return;
    }
    const cds = ui.vista === 'todos' ? cfg.municipios.map((m) => m.cd) : [ui.vista];
    const porMun = cds.map((cd) => ({ cd, nome: nomeMun(cd), secoes: secoesDe(cd) }));
    const t = somar(porMun.flatMap((x) => x.secoes));
    alvo.innerHTML = barraStatus() + avisos() + painelPlacar(t, porMun) + painelControle(porMun) + porMun.map(blocoMunicipio).join('') + ultimosLancamentos(porMun);
  }

  function barraStatus() {
    const u = usuario();
    let acesso;
    if (!nuvem()) acesso = '<span><span class="ponto local"></span>Boletins salvos neste navegador (sem banco na nuvem configurado)</span>';
    else if (!u) acesso = '<span><span class="ponto off"></span>Só a equipe autorizada lança boletins</span><button type="button" class="btn btn-mini" data-ap="entrar">Entrar</button>';
    else if (!podeLancar()) acesso = '<span><span class="ponto off"></span>' + esc((perfilAtual && perfilAtual.nome) || u.email) + ' · aguardando autorização para lançar</span><button type="button" class="btn btn-mini" data-ap="sair">Sair</button>';
    else acesso = '<span><span class="ponto"></span>' + esc((perfilAtual && perfilAtual.nome) || u.email) + ' · pode lançar boletins</span><button type="button" class="btn btn-mini" data-ap="sair">Sair</button>';
    const lido = ultimaLeitura ? 'Atualizado às ' + ultimaLeitura.toLocaleTimeString('pt-BR') : '';
    return '<div class="la-status ap-status"><span class="ap-hora dica">' + esc(lido) + (lido ? ' · atualiza sozinho a cada ' + INTERVALO / 1000 + ' s' : '') + '</span>' +
      '<button type="button" class="btn btn-mini" data-ap="atualizar">Atualizar agora</button>' + acesso + '</div>';
  }

  function avisos() {
    return (ui.aviso ? '<section class="painel la-aviso"><span>' + esc(ui.aviso) + '</span><button type="button" class="btn btn-mini" data-ap="fechar-aviso">OK</button></section>' : '') +
      (ui.erroLeitura ? '<section class="painel la-aviso la-erro-sync ap-erro-leitura"><span>' + (ultimaLeitura
        ? 'Não foi possível atualizar (' + esc(ui.erroLeitura) + '). Mostrando a última leitura, das ' + ultimaLeitura.toLocaleTimeString('pt-BR') + '.'
        : 'Não foi possível ler os boletins (' + esc(ui.erroLeitura) + '). Os números abaixo estão incompletos.') + '</span><button type="button" class="btn btn-mini" data-ap="atualizar">Tentar de novo</button></section>' : '');
  }

  function abas() {
    const opcoes = [{ v: 'todos', t: cfg.municipios.map((m) => m.nome).join(' e ') }].concat(cfg.municipios.map((m) => ({ v: m.cd, t: m.nome })));
    return '<div class="segmentado la-abas ap-abas" role="tablist">' + opcoes.map((o) =>
      '<button type="button" role="tab" aria-selected="' + (ui.vista === o.v) + '" class="' + (ui.vista === o.v ? 'ativo' : '') + '" data-ap="vista" data-valor="' + esc(o.v) + '">' + esc(o.t) + '</button>').join('') + '</div>';
  }

  function painelPlacar(t, porMun) {
    const pctSec = pct(t.apuradas, t.total);
    const detalheMun = porMun.length > 1
      ? porMun.map((x) => { const tm = somar(x.secoes); return esc(x.nome) + ' ' + tm.apuradas + '/' + tm.total; }).join(' · ')
      : '';
    return '<section class="painel ap-topo">' +
      '<div class="ap-cabecalho"><div><h2>' + esc(cfg.titulo || 'Apuração paralela') + '</h2>' +
        '<span class="dica">Boletins de urna lançados pela equipe, seção por seção. Percentual sobre os votos válidos do cargo.</span></div>' +
        (podeLancar() ? '<div class="ap-botoes-lancar"><button type="button" class="btn ap-btn-ler" data-ap="ler-bu" title="Lê os QR Codes do boletim e salva sozinho">📄 Ler boletim (PDF ou foto)</button>' +
          '<button type="button" class="btn btn-primario ap-btn-lancar" data-ap="lancar">+ Lançar boletim</button></div>' : '') + '</div>' +
      abas() +
      '<div class="ap-grandes">' +
        '<div class="ap-grande"><span class="rotulo">Votos apurados</span><strong>' + fmtInt(t.comparecimento) + '</strong><span class="dica">eleitores que votaram nas seções apuradas</span></div>' +
        '<div class="ap-grande"><span class="rotulo">Seções apuradas</span><strong>' + t.apuradas + '/' + t.total + '</strong>' +
          '<span class="ap-progresso" role="progressbar" aria-valuemin="0" aria-valuemax="' + t.total + '" aria-valuenow="' + t.apuradas + '"><span style="width:' + pctSec.toFixed(1) + '%"></span></span>' +
          '<span class="dica">' + fmtPct(pctSec) + (detalheMun ? ' · ' + detalheMun : '') + '</span></div>' +
      '</div>' +
      '<div class="ap-cargos">' + cfg.cargos.map((cargo) => listaCargo(cargo, t)).join('') + '</div></section>';
  }

  /**
   * Lista de um cargo no placar, do mais votado para o menos votado. Nos cargos de lista aberta (deputados) aparecem
   * os 3 primeiros e os da nossa chapa que estiverem abaixo deles; "Ver mais" mostra todos.
   */
  function listaCargo(cargo, t) {
    const k = chaveCargo(cargo);
    const val = t.validos[k] || 0;
    const ordemCfg = (c) => { const i = cfg.candidatos.indexOf(c); return i < 0 ? 999 : i; };
    const cands = candidatosDoCargo(cargo).map((c) => ({ c, v: t.votos[c.numero] || 0 }))
      .sort((a, b) => b.v - a.v || (b.c.chapa ? 1 : 0) - (a.c.chapa ? 1 : 0) || ordemCfg(a.c) - ordemCfg(b.c) || a.c.nome.localeCompare(b.c.nome, 'pt-BR'));
    const aberta = ui.cargosAbertos.has(k);
    const limitada = CARGOS_ABERTOS.includes(cargo) && cands.length > TOP;
    const lider = liderDe(t, cargo);
    let html = '';
    let pulou = false;
    cands.forEach((x, i) => {
      const visivel = !limitada || aberta || i < TOP || x.c.chapa;
      if (!visivel) { pulou = true; return; }
      if (pulou) { html += '<div class="ap-reticencias" aria-hidden="true">⋯</div>'; pulou = false; }
      html += linhaCandidato(x.c, x.v, val, CARGOS_ABERTOS.includes(cargo) && x.v > 0 ? i + 1 : 0, lider === x.c.numero);
    });
    const escondidos = limitada && !aberta ? cands.filter((x, i) => !(i < TOP || x.c.chapa)).length : 0;
    const botao = limitada && (aberta || escondidos)
      ? '<button type="button" class="btn btn-mini ap-ver-mais" data-ap="ver-mais" data-cargo="' + esc(k) + '" aria-expanded="' + aberta + '">' +
        (aberta ? 'Ver menos' : 'Ver mais (' + escondidos + ')') + '</button>'
      : '';
    return '<section class="ap-cargo-bloco"><div class="ap-cargo-titulo"><h3>' + esc(cargo) + '</h3>' +
      (t.apuradas ? '<span class="dica">' + fmtInt(val) + ' votos válidos</span>' : '') + '</div>' +
      '<div class="ap-cargo-lista">' + (html || '<div class="vazio">Nenhum candidato.</div>') + '</div>' + botao + '</section>';
  }

  function linhaCandidato(c, v, val, posicao, lider) {
    const p = pct(v, val);
    const cad = cadastroDe(c);
    return '<div class="ap-cand ' + (c.chapa ? 'chapa' : cfg.candidatos.includes(c) ? 'adversario' : 'outro') + '">' +
      '<span class="ap-foto">' + avatar(c.nome, cad.foto, 40) + (posicao ? '<span class="ap-pos">' + posicao + 'º</span>' : '') + '</span>' +
      '<div class="ap-cand-info"><strong>' + esc(c.nome) + (lider ? '<span class="selo ' + (c.chapa ? 'eleito' : 'ap-selo-adv') + '">à frente</span>' : '') + '</strong>' +
        '<span class="dica">' + esc(c.numero) + (cad.partido ? ' · ' + esc(cad.partido) : '') + (c.chapa ? ' · nossa chapa' : '') + '</span></div>' +
      '<div class="ap-cand-num"><strong>' + (val ? fmtPct(p) : '—') + '</strong><span>' + fmtInt(v) + ' votos</span></div>' +
      '<span class="ap-barra"><span style="width:' + p.toFixed(1) + '%"></span></span></div>';
  }

  function celulaCandidato(c, t) {
    const val = t.validos[chaveCargo(c.cargo)] || 0;
    const v = t.votos[c.numero] || 0;
    const lider = liderDe(t, c.cargo);
    const cls = lider && lider === c.numero ? (c.chapa ? ' ap-ganha' : ' ap-perde') : '';
    return '<td class="num ap-pct' + cls + (c.chapa ? '' : ' ap-adv') + '" data-rotulo="' + esc(c.nome) + '">' +
      (t.apuradas && val ? '<b>' + fmtPct(pct(v, val)) + '</b><small>' + fmtInt(v) + ' votos</small>' : '<span class="dica">—</span>') + '</td>';
  }

  function blocoMunicipio(x) {
    const t = somar(x.secoes);
    const bairros = bairrosDe(x.secoes);
    const cols = cfg.candidatos;
    const ncol = 3 + cols.length;
    let linhas = '';
    for (const b of bairros) {
      const tb = somar(b.secoes);
      const chave = x.cd + '|' + b.bairro;
      const aberto = ui.abertos.has(chave);
      linhas += '<tr class="clicavel ap-linha-bairro' + (tb.apuradas ? '' : ' ap-sem') + (aberto ? ' aberto' : '') + '" data-ap="bairro" data-chave="' + esc(chave) + '" aria-expanded="' + aberto + '">' +
        '<td class="texto ap-nome-bairro"><span class="ap-seta" aria-hidden="true">›</span><strong>' + esc(titulo(b.bairro)) + '</strong></td>' +
        '<td class="num" data-rotulo="Seções">' + tb.apuradas + '/' + tb.total + '</td>' +
        '<td class="num" data-rotulo="Votos apurados">' + (tb.apuradas ? fmtInt(tb.comparecimento) : '—') + '</td>' +
        cols.map((c) => celulaCandidato(c, tb)).join('') + '</tr>';
      if (aberto) linhas += '<tr class="ap-linha-secoes"><td colspan="' + ncol + '">' + listaSecoes(b.secoes) + '</td></tr>';
    }
    const ano = anoLista(x.cd);
    const fonte = ano ? 'Lista de seções e bairros de ' + ano + ' (TRE-CE). ' : '';
    return '<section class="painel ap-mun"><div class="painel-cabecalho"><h2>' + esc(x.nome) + ' · por bairro</h2>' +
      '<span class="dica">' + t.apuradas + '/' + t.total + ' seções apuradas · ' + fmtInt(t.comparecimento) + ' votos apurados · clique no bairro para ver as seções</span></div>' +
      '<div class="tabela-scroll"><table class="ap-tabela"><thead><tr><th>Bairro</th><th class="num">Seções</th><th class="num">Votos apurados</th>' +
        cols.map((c) => '<th class="num' + (c.chapa ? '' : ' ap-adv') + '">' + esc(c.nome) + '<small>' + esc(CARGO_CURTO[c.cargo] || c.cargo) + '</small></th>').join('') + '</tr></thead>' +
      '<tbody>' + (linhas || '<tr><td colspan="' + ncol + '" class="vazio">Nenhuma seção cadastrada para ' + esc(x.nome) + '.</td></tr>') + '</tbody>' +
      '<tfoot><tr><td class="texto">Total ' + esc(x.nome) + '</td><td class="num" data-rotulo="Seções">' + t.apuradas + '/' + t.total + '</td>' +
        '<td class="num" data-rotulo="Votos apurados">' + fmtInt(t.comparecimento) + '</td>' + cols.map((c) => celulaCandidato(c, t)).join('') + '</tr></tfoot></table></div>' +
      '<p class="dica ap-nota">' + fonte + 'Seção nova, que não está na lista: lance o boletim informando o número dela. Seção que não existe mais: abra o bairro e marque "Sem urna", para sair da contagem.</p></section>';
  }

  // ---------- controle de envio (só para a equipe) ----------
  const chaveTexto = (t) => normalizar(t).replace(/[^a-z0-9]+/g, ' ').trim();
  const listaTexto = (itens) => (itens.length > 1 ? itens.slice(0, -1).join(', ') + ' e ' + itens[itens.length - 1] : itens.join(''));

  /** Área do responsável que contém a seção: bairro com o mesmo nome ou local de votação que contém o trecho. */
  function areaDe(r, s) {
    for (const a of r.areas) {
      if (a.bairro && chaveTexto(a.bairro) === chaveTexto(s.bairro)) return a;
      if (a.local && chaveTexto(s.local).includes(chaveTexto(a.local))) return a;
    }
    return null;
  }

  /** Divide as seções do município entre os responsáveis (a primeira área que bater vale) e separa as que ficam sem ninguém. */
  function controleDe(cd) {
    const resps = cfg.responsaveis.filter((r) => r.cd === cd).map((r) => ({ r, areas: r.areas.map((a) => ({ a, secoes: [] })) }));
    const sem = [];
    for (const s of secoesDe(cd)) {
      const dono = resps.find((x) => areaDe(x.r, s));
      if (dono) dono.areas[dono.r.areas.indexOf(areaDe(dono.r, s))].secoes.push(s);
      else if (s.situacao !== 'fora') sem.push(s);
    }
    return { resps, sem };
  }

  const pendentes = (x) => x.areas.map((y) => ({ a: y.a, secoes: y.secoes.filter((s) => s.situacao === 'pendente') })).filter((y) => y.secoes.length);

  function painelControle(porMun) {
    if (!podeLancar() || !cfg.responsaveis.length) return '';
    const grupos = porMun.map((x) => Object.assign({ cd: x.cd, nome: x.nome }, controleDe(x.cd))).filter((g) => g.resps.length);
    if (!grupos.length) return '';
    let completos = 0;
    let total = 0;
    let faltam = 0;
    let corpo = '';
    for (const g of grupos) {
      if (grupos.length > 1) corpo += '<div class="ap-resp-mun">' + esc(g.nome) + '</div>';
      for (const x of g.resps) {
        const secs = x.areas.flatMap((y) => y.secoes).filter((s) => s.situacao !== 'fora');
        const ok = secs.filter((s) => s.situacao === 'apurada').length;
        const falta = secs.length - ok;
        total++;
        if (secs.length && !falta) completos++;
        faltam += falta;
        const chave = g.cd + '|' + x.r.nome;
        const aberto = ui.respAbertos.has(chave);
        const estado = !secs.length ? 'vazio' : !falta ? 'completo' : ok ? 'parcial' : 'nada';
        corpo += '<div class="ap-resp ap-resp-' + estado + '">' +
          '<button type="button" class="ap-resp-topo" data-ap="resp" data-chave="' + esc(chave) + '" aria-expanded="' + aberto + '">' +
            '<span class="ap-resp-icone" aria-hidden="true">' + (estado === 'completo' ? '✓' : falta) + '</span>' +
            '<span class="ap-resp-nome"><strong>' + esc(x.r.nome) + '</strong><span class="dica">' + esc(listaTexto(x.r.areas.map((a) => a.rotulo))) + '</span></span>' +
            '<span class="ap-resp-num"><strong>' + ok + '/' + secs.length + '</strong><small>' + (estado === 'completo' ? 'completo' : estado === 'vazio' ? 'sem seções' : 'faltam ' + falta) + '</small></span>' +
            '<span class="ap-progresso"><span style="width:' + pct(ok, secs.length).toFixed(1) + '%"></span></span>' +
          '</button>' + (aberto ? detalheResponsavel(x, chave, falta) : '') + '</div>';
      }
      if (g.sem.length) {
        corpo += '<p class="dica ap-resp-sem">Sem responsável em ' + esc(g.nome) + ': ' + esc(listaTexto(g.sem.map((s) => 'seção ' + s.secao + ' (' + titulo(s.bairro) + ')'))) + '.</p>';
      }
    }
    return '<section class="painel ap-controle"><div class="painel-cabecalho"><h2>Controle de envio</h2>' +
      '<span class="dica">' + completos + ' de ' + total + ' completos · ' + (faltam ? 'faltam ' + faltam + ' boletins' : 'todos os boletins lançados') + ' · só a equipe vê esta parte</span></div>' +
      '<div class="ap-resp-lista">' + corpo + '</div></section>';
  }

  function detalheResponsavel(x, chave, falta) {
    const chip = (s) => {
      if (s.situacao === 'apurada') return '<span class="ap-chip ok" title="Lançada às ' + esc(hora(s.reg.atualizado_em)) + '">' + esc(s.secao) + ' ✓</span>';
      if (s.situacao === 'fora') return '<span class="ap-chip fora" title="Sem urna em 2026">' + esc(s.secao) + '</span>';
      return '<button type="button" class="ap-chip falta" data-ap="lancar" data-cd="' + s.cd + '" data-secao="' + esc(s.secao) + '" title="Lançar o boletim da seção ' + esc(s.secao) + '">' + esc(s.secao) + '</button>';
    };
    return '<div class="ap-resp-detalhe">' + x.areas.map((y) => {
      const vivas = y.secoes.filter((s) => s.situacao !== 'fora');
      const ok = vivas.filter((s) => s.situacao === 'apurada').length;
      return '<div class="ap-resp-area"><div class="ap-resp-area-topo"><strong>' + esc(y.a.rotulo) + '</strong>' +
        '<span class="dica">' + (y.secoes.length ? ok + '/' + vivas.length : 'nenhuma seção encontrada: confira o nome no data/apuracao.json') + '</span></div>' +
        '<div class="ap-chips">' + y.secoes.map(chip).join('') + '</div></div>';
    }).join('') +
    (falta ? '<button type="button" class="btn btn-mini ap-copiar" data-ap="copiar-falta" data-chave="' + esc(chave) + '">Copiar o que falta</button>' : '') + '</div>';
  }

  /** Texto para cobrar no WhatsApp: "Men, faltam 3 boletins: Figueiredo (seções 140 e 141) e Setor B (seção 160)." */
  function textoFalta(chave) {
    const [cd, nome] = chave.split('|');
    const x = controleDe(cd).resps.find((y) => y.r.nome === nome);
    if (!x) return '';
    const p = pendentes(x);
    const n = p.reduce((t, y) => t + y.secoes.length, 0);
    if (!n) return nome + ', todos os seus boletins já foram lançados. Obrigado!';
    return nome + ', falta' + (n > 1 ? 'm ' + n + ' boletins' : ' 1 boletim') + ': ' +
      listaTexto(p.map((y) => y.a.rotulo + ' (seç' + (y.secoes.length > 1 ? 'ões ' : 'ão ') + listaTexto(y.secoes.map((s) => s.secao)) + ')')) + '.';
  }

  function copiarTexto(texto) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(texto);
    return new Promise((ok, falha) => {
      const area = document.createElement('textarea');
      area.value = texto;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      try { if (document.execCommand('copy')) ok(); else falha(new Error('cópia recusada')); } catch (e) { falha(e); }
      area.remove();
    });
  }

  function listaSecoes(secoes) {
    const pode = podeLancar();
    const botao = (acao, s, texto, extra) => '<button type="button" class="btn btn-mini' + (extra || '') + '" data-ap="' + acao + '" data-cd="' + s.cd + '" data-secao="' + esc(s.secao) + '">' + texto + '</button>';
    return '<div class="ap-secoes">' + secoes.map((s) => {
      const d = s.reg && s.reg.dados;
      let selo;
      let acoes = '';
      if (s.situacao === 'apurada') {
        selo = '<span class="selo eleito">Apurada</span>';
        if (pode) acoes = botao('lancar', s, 'Editar');
      } else if (s.situacao === 'fora') {
        selo = '<span class="selo suplente">Sem urna em 2026</span>';
        if (pode) acoes = botao('voltar-contagem', s, 'Voltar à contagem');
      } else {
        selo = '<span class="selo suplente">Aguardando boletim</span>';
        if (pode) acoes = botao('lancar', s, 'Lançar', ' btn-primario') + (s.extra ? botao('remover-secao', s, 'Remover') : botao('sem-urna', s, 'Sem urna'));
      }
      const quem = s.reg && s.situacao === 'apurada'
        ? '<small class="dica">' + (d.origem === 'qrcode' ? 'lida do QR Code às ' : 'lançada às ') + esc(hora(s.reg.atualizado_em)) + (pode && s.reg.atualizado_por ? ' por ' + esc(s.reg.atualizado_por) : '') + '</small>' : '';
      const votos = s.situacao === 'apurada'
        ? '<div class="ap-secao-votos"><span>' + fmtInt(d.comparecimento) + ' votos</span>' + cfg.candidatos.map((c) => {
          const val = validos(d, chaveCargo(c.cargo));
          const v = num(d.votos && d.votos[c.numero]);
          return '<span>' + esc(c.nome) + ' <b>' + fmtInt(v) + '</b>' + (val ? ' <small>' + fmtPct(pct(v, val)) + '</small>' : '') + '</span>';
        }).join('') + '</div>' : '';
      return '<div class="ap-secao ap-' + s.situacao + '"><div class="ap-secao-topo"><strong>Seção ' + esc(s.secao) + '</strong>' +
        '<span class="dica">' + esc(titulo(s.local)) + (s.aptos ? ' · ' + aptosTexto(s) : '') + (s.extra ? ' · incluída na apuração' : '') + '</span>' + selo + quem +
        '<span class="ap-secao-acoes">' + acoes + '</span></div>' + votos +
        (d && d.obs ? '<div class="dica ap-obs">Obs.: ' + esc(d.obs) + '</div>' : '') + '</div>';
    }).join('') + '</div>';
  }

  function ultimosLancamentos(porMun) {
    const lista = porMun.flatMap((x) => x.secoes).filter((s) => s.situacao === 'apurada')
      .sort((a, b) => String(b.reg.atualizado_em).localeCompare(String(a.reg.atualizado_em))).slice(0, 8);
    if (!lista.length) return '';
    return '<section class="painel ap-ultimos"><div class="painel-cabecalho"><h2>Últimos boletins lançados</h2></div><ul>' +
      lista.map((s) => '<li><span class="ap-ult-hora">' + esc(hora(s.reg.atualizado_em)) + '</span><strong>Seção ' + esc(s.secao) + '</strong>' +
        '<span class="dica">' + esc(nomeMun(s.cd)) + ' · ' + esc(titulo(s.bairro)) + ' · ' + fmtInt(s.reg.dados.comparecimento) + ' votos</span></li>').join('') + '</ul></section>';
  }

  // ---------- popups: lançamento e login ----------
  function renderModal() {
    const raiz = ctx && ctx.el.querySelector('.ap-modal-raiz');
    if (!raiz) return;
    if (!ui.modal) { raiz.innerHTML = ''; document.body.classList.remove('la-modal-aberto'); return; }
    raiz.innerHTML = ui.modal === 'login' ? htmlLogin() : ui.modal === 'leitura' ? htmlLeitura() : htmlForm();
    document.body.classList.add('la-modal-aberto');
    if (ui.modal === 'form') { prepararForm(); }
    const foco = raiz.querySelector(ui.modal === 'login' ? 'input[name="email"]' : 'select[name="secao"]');
    if (foco && !(ui.modal === 'form' && ui.form.secao)) foco.focus();
  }

  function fecharModal() {
    if (ui.modal === 'leitura' && ui.leitura && ui.leitura.lendo) return; // espera terminar a leitura
    if (ui.modal === 'leitura') ui.leitura = null;
    ui.modal = null; ui.form = null; ui.erro = ''; ui.erroLogin = '';
    renderModal();
  }

  function htmlLogin() {
    return '<div class="la-modal-fundo" data-ap="fundo"><div class="la-modal ap-modal ap-modal-login" role="dialog" aria-modal="true" aria-labelledby="ap-login-titulo">' +
      '<button type="button" class="la-modal-fechar" data-ap="fechar" aria-label="Fechar">×</button>' +
      '<h2 id="ap-login-titulo" class="ap-modal-titulo">Entrar para lançar boletins</h2>' +
      '<form class="la-login" data-ap="form-login">' +
        '<label class="campo"><span>E-mail</span><input name="email" type="email" required autocomplete="username"></label>' +
        '<label class="campo"><span>Senha</span><input name="senha" type="password" required autocomplete="current-password"></label>' +
        (ui.erroLogin ? '<div class="erro">' + esc(ui.erroLogin) + '</div>' : '') +
        '<div class="la-form-acoes"><button type="submit" class="btn btn-primario">Entrar</button><button type="button" class="btn" data-ap="fechar">Cancelar</button></div>' +
        '<span class="dica">Use a mesma conta do mapeamento de lideranças. Para criar conta ou recuperar a senha, vá à tela ' +
          '<button type="button" class="ap-link" data-ap="ir-liderancas">Lideranças</button>; o administrador precisa autorizar o cadastro.</span>' +
      '</form></div></div>';
  }

  const inputNum = (nome, opcional) => '<input name="' + nome + '" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="5" autocomplete="off" enterkeyhint="next"' +
    (opcional ? ' placeholder="0" data-opcional="1"' : '') + '>';

  function htmlForm() {
    const f = ui.form;
    const cargosBU = cfg.cargos.slice().sort((a, b) => (ORDEM_BU.indexOf(a) + 1 || 99) - (ORDEM_BU.indexOf(b) + 1 || 99));
    // candidatos de cada cargo no formulário: os do data/apuracao.json (obrigatórios) e, nos deputados, os apoiados
    // pelas lideranças e os que já aparecem em boletins (opcionais, em ordem de número, como os partidos no boletim)
    f.cands = {};
    for (const cargo of cfg.cargos) {
      const fixos = cfg.candidatos.filter((c) => c.cargo === cargo);
      const outros = candidatosDoCargo(cargo).filter((c) => !fixos.includes(c)).sort((a, b) => parseInt(a.numero, 10) - parseInt(b.numero, 10));
      f.cands[cargo] = fixos.concat(outros);
    }
    const linhaVoto = (c, opcional) => '<label class="ap-voto"><span class="cand-linha">' + avatar(c.nome, cadastroDe(c).foto, 30) +
      '<span><strong>' + esc(c.nome) + '</strong> <small class="dica">' + esc(c.numero) + (cadastroDe(c).partido ? ' · ' + esc(cadastroDe(c).partido) : '') + '</small></span></span>' +
      inputNum('v_' + c.numero, opcional) + '</label>';
    const blocoCargo = (cargo) => {
      const k = chaveCargo(cargo);
      const opcionais = f.cands[cargo].filter((c) => !cfg.candidatos.includes(c));
      return '<fieldset class="ap-cargo" data-cargo="' + k + '"><legend>' + esc(cargo) + '</legend><div class="ap-votos">' +
        f.cands[cargo].filter((c) => cfg.candidatos.includes(c)).map((c) => linhaVoto(c, false)).join('') +
        '<label class="ap-voto ap-voto-bn"><span>Brancos</span>' + inputNum('b_' + k) + '</label>' +
        '<label class="ap-voto ap-voto-bn"><span>Nulos</span>' + inputNum('n_' + k) + '</label></div>' +
        (opcionais.length ? '<div class="ap-opcionais"><div class="ap-opcionais-titulo">Outros candidatos com lideranças <span class="dica">· opcional: em branco conta como 0</span></div>' +
          '<div class="ap-votos">' + opcionais.map((c) => linhaVoto(c, true)).join('') + '</div></div>' : '') +
        '<div class="ap-conferencia dica" data-conf="' + k + '"></div></fieldset>';
    };
    return '<div class="la-modal-fundo" data-ap="fundo"><div class="la-modal ap-modal" role="dialog" aria-modal="true" aria-labelledby="ap-form-titulo">' +
      '<button type="button" class="la-modal-fechar" data-ap="fechar" aria-label="Fechar">×</button>' +
      '<h2 id="ap-form-titulo" class="ap-modal-titulo">Lançar boletim de urna</h2>' +
      '<form class="ap-form" data-ap="form" novalidate autocomplete="off">' +
        '<div class="ap-form-linha">' +
          '<div class="campo"><span class="rotulo">Município</span><div class="segmentado">' + cfg.municipios.map((m) =>
            '<label><input type="radio" name="cd" value="' + esc(m.cd) + '"' + (m.cd === f.cd ? ' checked' : '') + '><span>' + esc(m.nome) + '</span></label>').join('') + '</div></div>' +
          '<label class="campo ap-campo-secao"><span class="rotulo">Seção</span><select name="secao"></select></label>' +
        '</div>' +
        '<div class="ap-outra" hidden>' +
          '<label class="campo"><span class="rotulo">Número da seção</span><input name="nova_secao" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" enterkeyhint="next"></label>' +
          '<label class="campo"><span class="rotulo">Bairro da seção nova</span><input name="nova_bairro" list="ap-lista-bairros" autocomplete="off"></label>' +
          '<label class="campo"><span class="rotulo">Local de votação (opcional)</span><input name="nova_local" autocomplete="off"></label>' +
          '<datalist id="ap-lista-bairros"></datalist>' +
        '</div>' +
        '<div class="ap-info-secao" aria-live="polite"></div>' +
        '<label class="campo ap-campo-comp"><span class="rotulo">Comparecimento (eleitores que votaram)</span>' + inputNum('comparecimento') + '</label>' +
        (ui.erroApoiados ? '<p class="ap-info-secao alerta">Não foi possível carregar os candidatos das lideranças (' + esc(ui.erroApoiados) + '). Aparecem só os da chapa e os que já estão nos boletins.</p>' : '') +
        cargosBU.map(blocoCargo).join('') +
        '<label class="campo"><span class="rotulo">Observação (opcional)</span><textarea name="obs" rows="2" maxlength="500"></textarea></label>' +
        '<div class="erro ap-erro" role="alert"' + (ui.erro ? '' : ' hidden') + '>' + esc(ui.erro) + '</div>' +
        '<div class="ap-form-acoes"><button type="submit" class="btn btn-primario">Salvar boletim</button>' +
          '<button type="button" class="btn" data-ap="fechar">Cancelar</button>' +
          '<button type="button" class="btn" data-ap="incluir-sem-bu" hidden>Só incluir a seção, sem boletim</button>' +
          '<button type="button" class="btn ap-btn-perigo" data-ap="apagar-bu" hidden>Apagar boletim</button></div>' +
        '<p class="dica">Os campos seguem a ordem do boletim. Sem voto, digite 0.</p>' +
      '</form></div></div>';
  }

  const campoForm = () => ctx.el.querySelector('form[data-ap="form"]');
  const OUTRA = 'outra'; // opção do menu para seção fora da lista

  // nome do local no menu sem a sigla da escola ("EMEIF", "E. M. E. F.", "EEM"…): "Seção 196 - Centro - Francisco Figueiredo…"
  const SIGLA_ESCOLA = /^(?:E\.?\s*M\.?\s*E\.?\s*I\.?\s*F|E\.?\s*M\.?\s*E\.?\s*F|E\.?\s*M\.?\s*T\.?\s*I|E\.?\s*E\.?\s*M\.?\s*T\.?\s*I|E\.?\s*E\.?\s*E\.?\s*P|E\.?\s*E\.?\s*M|C\.?\s*E\.?\s*I)\.?\s+/i;
  const localCurto = (local) => titulo(String(local || '').replace(SIGLA_ESCOLA, '').trim());

  function rotuloSecao(s) {
    const marca = s.situacao === 'apurada' ? '  ✓ lançada' : s.situacao === 'fora' ? '  (sem urna)' : '';
    return 'Seção ' + s.secao + ' - ' + titulo(s.bairro) + (s.local ? ' - ' + localCurto(s.local) : '') + marca;
  }

  function opcoesSecao(cd, escolhida) {
    return '<option value="">Escolha a seção…</option>' +
      secoesDe(cd).map((s) => '<option value="' + esc(s.secao) + '"' + (s.secao === escolhida ? ' selected' : '') + '>' + esc(rotuloSecao(s)) + '</option>').join('') +
      '<option value="' + OUTRA + '"' + (escolhida === OUTRA ? ' selected' : '') + '>Outra seção (não está na lista)…</option>';
  }

  const secaoDoForm = (form) => (form.elements.secao.value === OUTRA ? normSecao(form.elements.nova_secao.value) : normSecao(form.elements.secao.value));
  const campoSecao = (form) => (form.elements.secao.value === OUTRA ? 'nova_secao' : 'secao');
  const CAMPOS_NUM = () => ['comparecimento'].concat(cfg.candidatos.map((c) => 'v_' + c.numero), cfg.cargos.flatMap((cg) => ['b_' + chaveCargo(cg), 'n_' + chaveCargo(cg)]));

  /** Ajusta o formulário à seção escolhida: identifica o bairro, preenche um boletim já lançado, mostra a inclusão de seção nova. */
  function prepararForm() {
    const form = campoForm();
    if (!form) return;
    const cd = form.elements.cd.value;
    const menu = form.elements.secao;
    // primeira vez ou troca de município: o menu passa a listar as seções dele
    if (cd !== ui.form.cdMenu) {
      menu.innerHTML = opcoesSecao(cd, menu.value === OUTRA ? OUTRA : (cd === ui.form.cd ? ui.form.secao : ''));
      ui.form.cdMenu = cd;
    }
    const modoOutra = menu.value === OUTRA;
    const secao = secaoDoForm(form);
    const info = form.querySelector('.ap-info-secao');
    const outra = form.querySelector('.ap-outra');
    const btnIncluir = form.querySelector('[data-ap="incluir-sem-bu"]');
    const btnApagar = form.querySelector('[data-ap="apagar-bu"]');
    const s = secao ? procurarSecao(cd, secao) : null;
    // "outra seção" com um número que já está na lista (deste município ou do outro): escolhe no menu
    if (modoOutra && secao) {
      const destino = s ? cd : (cfg.municipios.find((m) => m.cd !== cd && procurarSecao(m.cd, secao)) || {}).cd;
      if (destino) {
        form.querySelector('input[name="cd"][value="' + destino + '"]').checked = true;
        menu.innerHTML = opcoesSecao(destino, secao);
        ui.form.cdMenu = destino;
        form.elements.nova_secao.value = '';
        return prepararForm();
      }
    }
    ui.form.cd = cd;
    ui.form.secao = secao;
    const reg = s && s.reg && s.situacao === 'apurada' ? s.reg : null;
    if (reg) {
      if (ui.form.preenchidoCom !== reg.id) preencher(form, reg.dados);
      ui.form.preenchidoCom = reg.id;
    } else if (ui.form.preenchidoCom) {
      // trocou de uma seção já lançada para outra: limpa os números que vieram dela
      preencher(form, null);
      ui.form.preenchidoCom = null;
    }
    let texto = '';
    let classe = '';
    if (!secao) texto = modoOutra ? (form.elements.nova_secao.value.trim() ? 'Número de seção inválido.' : 'Digite o número da seção, como está no boletim.') : 'Escolha a seção do boletim.';
    else if (!s) { texto = 'A seção ' + secao + ' não está na lista de ' + nomeMun(cd) + '. Informe o bairro para incluí-la.'; classe = 'alerta'; }
    else {
      texto = 'Seção ' + secao + ' · ' + titulo(s.bairro) + (s.local ? ' · ' + titulo(s.local) : '') + (s.aptos ? ' · ' + aptosTexto(s) : '');
      if (reg) { texto += '. Já lançada às ' + hora(reg.atualizado_em) + (reg.atualizado_por ? ' por ' + reg.atualizado_por : '') + ': salvar substitui os números.'; classe = 'alerta'; }
      else if (s.situacao === 'fora') { texto += '. Estava marcada como sem urna; ao salvar o boletim, volta à contagem.'; classe = 'alerta'; }
    }
    info.textContent = texto;
    info.className = 'ap-info-secao ' + classe;
    outra.hidden = !modoOutra;
    btnIncluir.hidden = !(modoOutra && secao && !s);
    btnApagar.hidden = !reg;
    if (!outra.hidden) {
      const nomes = Array.from(new Set(secoesDe(cd).map((x) => titulo(x.bairro)))).sort((a, b) => a.localeCompare(b, 'pt-BR'));
      form.querySelector('#ap-lista-bairros').innerHTML = nomes.map((n) => '<option value="' + esc(n) + '">').join('');
    }
    conferir();
  }

  // todos os candidatos que estão no formulário aberto: [{ c, cargo, opcional }]
  const candsForm = () => Object.entries(ui.form.cands || {}).flatMap(([cargo, lista]) => lista.map((c) => ({ c, cargo, opcional: !cfg.candidatos.includes(c) })));

  function preencher(form, d) {
    form.elements.comparecimento.value = d ? num(d.comparecimento) : '';
    for (const { c, opcional } of candsForm()) {
      const v = d ? num(d.votos && d.votos[c.numero]) : 0;
      form.elements['v_' + c.numero].value = d && (v || !opcional) ? v : '';
    }
    for (const cg of cfg.cargos) {
      const k = chaveCargo(cg);
      form.elements['b_' + k].value = d ? num(d.brancos && d.brancos[k]) : '';
      form.elements['n_' + k].value = d ? num(d.nulos && d.nulos[k]) : '';
    }
    form.elements.obs.value = d ? (d.obs || '') : '';
  }

  const lerInt = (form, nome) => { const t = String(form.elements[nome].value || '').trim(); return /^\d+$/.test(t) ? parseInt(t, 10) : null; };

  /** Conferência ao vivo de cada cargo: válidos e demais votos; avisa quando a soma passa do comparecimento. */
  function conferir() {
    const form = campoForm();
    if (!form) return;
    const comp = lerInt(form, 'comparecimento');
    for (const cg of cfg.cargos) {
      const k = chaveCargo(cg);
      const alvo = form.querySelector('[data-conf="' + k + '"]');
      if (!alvo) continue;
      const nossos = (ui.form.cands[cg] || []).reduce((s, c) => s + (lerInt(form, 'v_' + c.numero) || 0), 0);
      const bn = (lerInt(form, 'b_' + k) || 0) + (lerInt(form, 'n_' + k) || 0);
      if (comp == null) { alvo.textContent = ''; alvo.classList.remove('excedeu'); continue; }
      const val = comp - bn;
      const demais = val - nossos;
      alvo.classList.toggle('excedeu', demais < 0);
      alvo.textContent = demais < 0
        ? 'A soma passa do comparecimento em ' + fmtInt(-demais) + ' voto(s). Confira os números.'
        : 'Válidos: ' + fmtInt(val) + ' · demais votos válidos (outros candidatos' + (CARGO_CURTO[cg] ? ' e legenda' : '') + '): ' + fmtInt(demais);
    }
  }

  function mostrarErroForm(msg, campo) {
    const form = campoForm();
    ui.erro = msg;
    const caixa = form && form.querySelector('.ap-erro');
    if (caixa) { caixa.textContent = msg; caixa.hidden = !msg; }
    if (!msg) return;
    if (campo && form && form.elements[campo]) form.elements[campo].focus();
    else if (caixa) caixa.scrollIntoView({ block: 'nearest' });
  }

  /** Lê e confere o formulário. Devolve o registro pronto para gravar, ou null (com o erro já mostrado). */
  function lerBoletim(form) {
    const cd = form.elements.cd.value;
    const secao = secaoDoForm(form);
    if (!secao) { mostrarErroForm(campoSecao(form) === 'secao' ? 'Escolha a seção do boletim.' : 'Informe o número da seção.', campoSecao(form)); return null; }
    const s = procurarSecao(cd, secao);
    const bairroNovo = String(form.elements.nova_bairro.value || '').trim();
    if (!s && !bairroNovo) { mostrarErroForm('A seção ' + secao + ' não está na lista: informe o bairro dela.', 'nova_bairro'); return null; }
    for (const nome of CAMPOS_NUM()) {
      if (lerInt(form, nome) == null) { mostrarErroForm('Preencha todos os números do boletim (sem voto, digite 0).', nome); return null; }
    }
    const comp = lerInt(form, 'comparecimento');
    if (comp <= 0) { mostrarErroForm('O comparecimento precisa ser maior que zero.', 'comparecimento'); return null; }
    const dados = {
      situacao: 'apurada',
      zona: s ? s.zona : ((base.get(cd) || [])[0] || {}).zona || '',
      bairro: s ? s.bairro : chaveBairro(bairroNovo),
      local: s ? s.local : String(form.elements.nova_local.value || '').trim(),
      comparecimento: comp, votos: {}, brancos: {}, nulos: {},
      obs: String(form.elements.obs.value || '').trim(),
    };
    // número de candidato que estava no boletim mas não aparece no formulário: mantém
    const anterior = (s && s.reg && s.reg.dados && s.reg.dados.votos) || {};
    for (const n of Object.keys(anterior)) dados.votos[n] = num(anterior[n]);
    for (const { c, opcional } of candsForm()) {
      const texto = String(form.elements['v_' + c.numero].value || '').trim();
      // candidato cadastrado à mão não está no cadastro do TSE: o nome vai junto, para quem só olha a apuração
      if (c.manual) { dados.nomes = dados.nomes || {}; dados.nomes[c.numero] = c.nome; }
      // os opcionais em branco valem 0 e ficam gravados assim: quem só olha a apuração também passa a ver o candidato
      if (opcional && !texto) { dados.votos[c.numero] = 0; continue; }
      if (!/^\d+$/.test(texto)) { mostrarErroForm('Número inválido em ' + c.nome + '.', 'v_' + c.numero); return null; }
      dados.votos[c.numero] = parseInt(texto, 10);
    }
    for (const cg of cfg.cargos) {
      const k = chaveCargo(cg);
      dados.brancos[k] = lerInt(form, 'b_' + k);
      dados.nulos[k] = lerInt(form, 'n_' + k);
      const cands = ui.form.cands[cg] || [];
      const soma = cands.reduce((t, c) => t + num(dados.votos[c.numero]), 0) + dados.brancos[k] + dados.nulos[k];
      if (soma > comp) {
        mostrarErroForm(cg + ': candidatos + brancos + nulos dá ' + fmtInt(soma) + ', mais que o comparecimento (' + fmtInt(comp) + '). Confira os números.', cands.length ? 'v_' + cands[0].numero : 'b_' + k);
        return null;
      }
    }
    if (s && s.aptos && comp > s.aptos * 1.25 + 10 &&
      !confirm('O comparecimento (' + fmtInt(comp) + ') passa bastante do eleitorado da seção (' + aptosTexto(s) + '). Confirma o número?')) {
      mostrarErroForm('Confira o comparecimento.', 'comparecimento');
      return null;
    }
    return { id: idDe(cd, secao), cd_mun: cd, secao, dados };
  }

  async function salvarBoletim(form) {
    const reg = lerBoletim(form);
    if (!reg) return;
    const botao = form.querySelector('button[type="submit"]');
    botao.disabled = true;
    botao.textContent = 'Salvando…';
    try {
      await gravar(reg);
      const tm = somar(secoesDe(reg.cd_mun));
      ui.aviso = 'Boletim da seção ' + reg.secao + ' (' + nomeMun(reg.cd_mun) + ') salvo. ' + nomeMun(reg.cd_mun) + ': ' + tm.apuradas + '/' + tm.total + ' seções apuradas.';
      fecharModal();
      renderCorpo();
    } catch (e) {
      botao.disabled = false;
      botao.textContent = 'Salvar boletim';
      mostrarErroForm('Não foi possível salvar: ' + e.message);
    }
  }

  async function executar(acao, rotuloErro) {
    try { await acao(); ui.erroLeitura = ''; }
    catch (e) { alert(rotuloErro + ': ' + e.message); }
    render();
  }

  // ---------- leitura do boletim pelo QR Code (PDF ou foto; ver js/boletim-qr.js) ----------
  const CODIGO_CARGO = { Presidente: 1, Governador: 3, Senador: 5, 'Deputado Federal': 6, 'Deputado Estadual': 7 };

  /** Converte o boletim lido no registro da apuração. Devolve { cd, secao, s, dados } ou { erro } / { aviso }. */
  function registroDoBoletim(lido) {
    const cab = lido.cab;
    const m = cfg.municipios.find((x) => String(parseInt(x.cd, 10)) === String(parseInt(cab.MUNI, 10)));
    if (!m) return { erro: 'boletim de outro município (código ' + (cab.MUNI || '?') + ')' };
    if (cab.DTPL && !/^2026/.test(cab.DTPL)) return { erro: 'boletim de outra eleição (data ' + cab.DTPL.replace(/^(\d{4})(\d{2})(\d{2})$/, '$3/$2/$1') + ')' };
    const secao = normSecao(cab.SECA);
    if (!secao) return { erro: 'o boletim não traz o número da seção' };
    const cargoGov = lido.cargos.find((c) => c.cargo === 3);
    const comp = num(cab.COMP) || (cargoGov ? num(cargoGov.TOTC) : 0);
    if (!comp) return { erro: 'o boletim não traz o comparecimento' };
    const s = procurarSecao(m.cd, secao);
    const dados = {
      situacao: 'apurada', zona: cab.ZONA || (s ? s.zona : ''), bairro: s ? s.bairro : '', local: s ? s.local : '',
      comparecimento: comp, votos: {}, brancos: {}, nulos: {}, obs: '', origem: 'qrcode',
    };
    for (const cargo of cfg.cargos) {
      const c = lido.cargos.find((x) => x.cargo === CODIGO_CARGO[cargo]);
      if (!c) return { erro: 'o boletim não tem o cargo ' + cargo };
      const k = chaveCargo(cargo);
      dados.brancos[k] = num(c.BRAN);
      dados.nulos[k] = num(c.NULO);
      // grava os candidatos acompanhados (os do formulário); os demais entram só no total de válidos
      for (const cand of candidatosDoCargo(cargo)) dados.votos[cand.numero] = num(c.votos[cand.numero]);
    }
    const aviso = cab.FASE && cab.FASE !== 'O' ? 'boletim de ' + ({ S: 'simulado', T: 'treinamento' }[cab.FASE] || 'fase ' + cab.FASE) + ', não oficial' : '';
    return { cd: m.cd, secao, s, dados, aviso };
  }

  const mesmosNumeros = (a, b) => num(a.comparecimento) === num(b.comparecimento) &&
    Object.keys(b.votos).every((n) => num(a.votos && a.votos[n]) === num(b.votos[n])) &&
    Object.keys(b.brancos).every((k) => num(a.brancos && a.brancos[k]) === num(b.brancos[k]) && num(a.nulos && a.nulos[k]) === num(b.nulos[k]));

  const rotuloItem = (it) => (it.secao ? 'Seção ' + it.secao + ' · ' + nomeMun(it.cd) + (it.s ? ' · ' + titulo(it.s.bairro) : '') : (it.origem || []).join(', ') || 'Arquivo');

  /** Avalia um boletim montado: confere o HASH, interpreta e salva quando der (ou diz por que não salvou). */
  async function avaliarBoletim(b) {
    const it = { boletim: b, origem: b.origem };
    const faltam = b.partes.map((p, i) => (p ? 0 : i + 1)).filter(Boolean);
    if (faltam.length) {
      const lidos = b.partes.map((p, i) => (p ? i + 1 : 0)).filter(Boolean);
      const p1 = b.partes[0] ? global.BoletimQR.interpretar(b.partes[0].dados).cab : null;
      if (p1) { it.secao = normSecao(p1.SECA); const m = cfg.municipios.find((x) => String(parseInt(x.cd, 10)) === String(parseInt(p1.MUNI, 10))); if (m) { it.cd = m.cd; it.s = procurarSecao(m.cd, it.secao); } }
      return Object.assign(it, { tipo: 'faltam', texto: (faltam.length > 1 ? 'faltam os QR Codes ' : 'falta o QR Code ') + listaTexto(faltam.map(String)) + ' de ' + b.n +
        ' (lido' + (lidos.length > 1 ? 's' : '') + ': ' + listaTexto(lidos.map(String)) + '). Envie outra foto ou PDF com ' + (faltam.length > 1 ? 'eles.' : 'ele.') });
    }
    let lido;
    try { lido = global.BoletimQR.interpretar(await global.BoletimQR.conferir(b)); } catch (e) { return Object.assign(it, { tipo: 'erro', texto: e.message + '. Tente uma foto mais nítida, de frente.' }); }
    const r = registroDoBoletim(lido);
    if (r.erro) return Object.assign(it, { tipo: 'erro', secao: normSecao(lido.cab.SECA), texto: r.erro });
    Object.assign(it, { cd: r.cd, secao: r.secao, s: r.s, dados: r.dados });
    if (!r.s) return Object.assign(it, { tipo: 'formulario', texto: 'seção fora da lista de ' + nomeMun(r.cd) + ': abra no formulário e informe o bairro.' });
    if (r.aviso) return Object.assign(it, { tipo: 'aviso', texto: r.aviso + '. Não foi salvo.' });
    return salvarItem(it, false);
  }

  async function salvarItem(it, forcar) {
    const reg = it.s && it.s.reg;
    if (reg && reg.dados.situacao === 'apurada' && !forcar) {
      if (mesmosNumeros(reg.dados, it.dados)) return Object.assign(it, { tipo: 'igual', texto: 'já estava lançada com os mesmos números.' });
      return Object.assign(it, { tipo: 'conflito', texto: 'já tinha boletim lançado' + (reg.dados.origem === 'qrcode' ? ' (do QR Code)' : ' à mão') + ' com números diferentes.' });
    }
    try {
      await gravar({ id: idDe(it.cd, it.secao), cd_mun: it.cd, secao: it.secao, dados: it.dados });
      return Object.assign(it, { tipo: 'salvo', texto: 'salva: ' + fmtInt(it.dados.comparecimento) + ' votos, ' + it.boletim.n + ' QR Code' + (it.boletim.n > 1 ? 's' : '') + ' conferido' + (it.boletim.n > 1 ? 's' : '') + '.' });
    } catch (e) {
      return Object.assign(it, { tipo: 'erro', texto: 'não foi possível salvar: ' + e.message });
    }
  }

  async function salvarItemLeitura(idx, forcar) {
    const it = ui.leitura && ui.leitura.itens[idx];
    if (!it) return;
    it.s = procurarSecao(it.cd, it.secao);
    ui.leitura.itens[idx] = await salvarItem(it, forcar);
    renderModal();
    renderCorpo();
  }

  /** Lê arquivos escolhidos; com ui.leituraAlvo definido, completa o boletim incompleto daquele item. */
  async function lerArquivosBoletim(arquivos) {
    if (!global.BoletimQR) { alert('Leitor de boletim não carregado. Recarregue a página.'); return; }
    const alvo = ui.leituraAlvo;
    ui.leituraAlvo = null;
    if (alvo == null || !ui.leitura) ui.leitura = { itens: [], lendo: '' };
    ui.modal = 'leitura';
    ui.leitura.lendo = 'Preparando…';
    renderModal();
    try {
      const unidades = await global.BoletimQR.lerArquivos(arquivos, (t) => { ui.leitura.lendo = t; atualizarProgresso(); });
      if (alvo != null && ui.leitura.itens[alvo] && ui.leitura.itens[alvo].tipo === 'faltam') {
        const b = global.BoletimQR.completar(ui.leitura.itens[alvo].boletim, unidades);
        ui.leitura.itens[alvo] = await avaliarBoletim(b);
      } else {
        const boletins = global.BoletimQR.montar(unidades);
        // arquivo sem nenhum QR Code de boletim (num PDF, página sem QR é normal: o QR fica no fim do boletim)
        for (const nome of Array.from(new Set(unidades.map((u) => u.arquivo)))) {
          if (!unidades.some((u) => u.arquivo === nome && u.textos.length)) {
            ui.leitura.itens.push({ tipo: 'erro', origem: [nome], texto: 'nenhum QR Code de boletim encontrado. Se for foto, tire de frente, com boa luz e os QR Codes inteiros.' });
          }
        }
        for (const b of boletins) ui.leitura.itens.push(await avaliarBoletim(b));
      }
    } catch (e) {
      ui.leitura.itens.push({ tipo: 'erro', texto: 'não foi possível ler: ' + e.message });
    }
    ui.leitura.lendo = '';
    renderModal();
    renderCorpo();
  }

  function atualizarProgresso() {
    const caixa = ctx.el.querySelector('.ap-leitura-progresso');
    if (caixa) caixa.textContent = ui.leitura.lendo;
  }

  function htmlLeitura() {
    const L = ui.leitura || { itens: [] };
    const icone = { salvo: '✓', igual: '✓', faltam: '…', conflito: '!', aviso: '!', formulario: '✎', erro: '✕' };
    const itens = L.itens.map((it, i) => {
      const botoes = [];
      if (it.tipo === 'faltam') botoes.push('<button type="button" class="btn btn-mini btn-primario" data-ap="completar-bu" data-idx="' + i + '">Adicionar foto/PDF</button>');
      if (it.tipo === 'conflito') botoes.push('<button type="button" class="btn btn-mini btn-primario" data-ap="salvar-bu" data-idx="' + i + '">Substituir pelo do QR Code</button>');
      if (it.tipo === 'aviso') botoes.push('<button type="button" class="btn btn-mini" data-ap="salvar-bu" data-idx="' + i + '">Salvar mesmo assim</button>');
      if (it.dados && it.tipo !== 'salvo' && it.tipo !== 'igual') botoes.push('<button type="button" class="btn btn-mini" data-ap="form-bu" data-idx="' + i + '">Abrir no formulário</button>');
      return '<li class="ap-leitura-item ap-leitura-' + it.tipo + '"><span class="ap-leitura-icone" aria-hidden="true">' + (icone[it.tipo] || '•') + '</span>' +
        '<div><strong>' + esc(rotuloItem(it)) + '</strong> <span>' + esc(it.texto) + '</span>' + (botoes.length ? '<div class="ap-leitura-acoes">' + botoes.join('') + '</div>' : '') + '</div></li>';
    }).join('');
    const salvos = L.itens.filter((it) => it.tipo === 'salvo').length;
    return '<div class="la-modal-fundo" data-ap="fundo"><div class="la-modal ap-modal" role="dialog" aria-modal="true" aria-labelledby="ap-leitura-titulo">' +
      '<button type="button" class="la-modal-fechar" data-ap="fechar" aria-label="Fechar">×</button>' +
      '<h2 id="ap-leitura-titulo" class="ap-modal-titulo">Ler boletim de urna</h2>' +
      '<p class="dica">Escolha o PDF do boletim (o do site do TSE serve) ou fotos dos QR Codes impressos nele. O site lê os QR Codes, confere o código de segurança de cada um e salva sozinho; se a leitura não conferir, nada é salvo.</p>' +
      '<div class="ap-leitura-progresso dica" aria-live="polite">' + esc(L.lendo || (L.itens.length ? salvos + ' boletim(ns) salvo(s) nesta leitura.' : '')) + '</div>' +
      (itens ? '<ul class="ap-leitura-lista">' + itens + '</ul>' : '') +
      '<div class="ap-form-acoes"><button type="button" class="btn btn-primario" data-ap="ler-bu"' + (L.lendo ? ' disabled' : '') + '>Ler outros arquivos</button>' +
      '<button type="button" class="btn" data-ap="fechar">Fechar</button></div></div></div>';
  }

  /** Abre o formulário com os números lidos do boletim, para conferir ou completar (ex.: seção fora da lista). */
  function abrirFormComBoletim(idx) {
    const it = ui.leitura && ui.leitura.itens[idx];
    if (!it || !it.dados) return;
    const fora = !it.s;
    ui.modal = 'form';
    ui.erro = '';
    ui.form = { cd: it.cd, secao: fora ? OUTRA : it.secao, cdMenu: null, preenchidoCom: 'qrcode' };
    renderModal();
    const form = campoForm();
    if (fora) { form.elements.secao.value = OUTRA; form.elements.nova_secao.value = it.secao; prepararForm(); }
    preencher(form, it.dados);
    ui.form.preenchidoCom = fora ? null : 'qrcode';
    conferir();
    if (fora) form.elements.nova_bairro.focus();
  }

  // ---------- eventos ----------
  function aoClicar(ev) {
    const alvo = ev.target.closest('[data-ap]');
    if (!alvo || !ctx.el.contains(alvo)) return;
    const acao = alvo.dataset.ap;
    if (acao === 'fundo') { if (ev.target === alvo) fecharModal(); return; }
    if (acao === 'fechar') { fecharModal(); return; }
    if (acao === 'vista') {
      ui.vista = alvo.dataset.valor;
      try { localStorage.setItem(CHAVE_VISTA, ui.vista); } catch (e) { /* sem localStorage */ }
      renderCorpo();
      return;
    }
    if (acao === 'bairro') {
      const chave = alvo.dataset.chave;
      if (ui.abertos.has(chave)) ui.abertos.delete(chave); else ui.abertos.add(chave);
      renderCorpo();
      return;
    }
    if (acao === 'resp') {
      const chave = alvo.dataset.chave;
      if (ui.respAbertos.has(chave)) ui.respAbertos.delete(chave); else ui.respAbertos.add(chave);
      renderCorpo();
      return;
    }
    if (acao === 'copiar-falta') {
      const texto = textoFalta(alvo.dataset.chave);
      copiarTexto(texto)
        .then(() => { alvo.textContent = 'Copiado! Cole no WhatsApp'; setTimeout(() => { if (alvo.isConnected) alvo.textContent = 'Copiar o que falta'; }, 2500); })
        .catch(() => { prompt('Copie o texto:', texto); });
      return;
    }
    if (acao === 'ler-bu') {
      if (!podeLancar()) { ui.modal = 'login'; renderModal(); return; }
      ui.leituraAlvo = null;
      ctx.el.querySelector('.ap-arquivo-bu').click();
      return;
    }
    if (acao === 'completar-bu') { ui.leituraAlvo = +alvo.dataset.idx; ctx.el.querySelector('.ap-arquivo-bu').click(); return; }
    if (acao === 'salvar-bu') { salvarItemLeitura(+alvo.dataset.idx, true); return; }
    if (acao === 'form-bu') { abrirFormComBoletim(+alvo.dataset.idx); return; }
    if (acao === 'ver-mais') {
      const k = alvo.dataset.cargo;
      if (ui.cargosAbertos.has(k)) ui.cargosAbertos.delete(k); else ui.cargosAbertos.add(k);
      renderCorpo();
      return;
    }
    if (acao === 'atualizar') { atualizar(true); return; }
    if (acao === 'fechar-aviso') { ui.aviso = ''; renderCorpo(); return; }
    if (acao === 'entrar') { ui.modal = 'login'; ui.erroLogin = ''; renderModal(); return; }
    if (acao === 'sair') {
      global.Sync.sair().catch((e) => console.warn('sair:', e)).then(() => { perfilAtual = null; ui.aviso = ''; render(); });
      return;
    }
    if (acao === 'ir-liderancas') { fecharModal(); if (ctx.irPara) ctx.irPara('liderancas'); return; }
    if (acao === 'lancar') {
      if (!podeLancar()) { ui.modal = 'login'; renderModal(); return; }
      const cd = alvo.dataset.cd || (ui.vista !== 'todos' ? ui.vista : cfg.municipios[0].cd);
      const secao = alvo.dataset.secao || '';
      // o formulário lista os deputados das lideranças: espera a leitura delas (normalmente já feita ao abrir a tela)
      garantirApoiados().then(() => {
        if (ui.modal) return;
        ui.modal = 'form';
        ui.erro = '';
        ui.form = { cd, secao, cdMenu: null, preenchidoCom: null };
        renderModal();
        if (ui.form.secao) { const c = campoForm().elements.comparecimento; if (c) c.focus(); }
      });
      return;
    }
    if (!podeLancar()) return;
    const cd = alvo.dataset.cd;
    const secao = alvo.dataset.secao;
    if (acao === 'sem-urna') {
      const s = procurarSecao(cd, secao);
      if (!s || !confirm('Marcar a seção ' + secao + ' (' + titulo(s.bairro) + ') como sem urna em 2026? Ela sai da contagem de seções.')) return;
      executar(() => gravar({ id: idDe(cd, secao), cd_mun: cd, secao, dados: { situacao: 'fora', zona: s.zona, bairro: s.bairro, local: s.local } }), 'Não foi possível marcar a seção');
      return;
    }
    if (acao === 'voltar-contagem') { executar(() => apagar(idDe(cd, secao)), 'Não foi possível voltar a seção à contagem'); return; }
    if (acao === 'remover-secao') {
      if (!confirm('Remover a seção ' + secao + ' da apuração?')) return;
      executar(() => apagar(idDe(cd, secao)), 'Não foi possível remover a seção');
      return;
    }
    if (acao === 'incluir-sem-bu') {
      const form = campoForm();
      const cdF = form.elements.cd.value;
      const sec = secaoDoForm(form);
      const bairro = String(form.elements.nova_bairro.value || '').trim();
      if (!sec) { mostrarErroForm('Informe o número da seção.', 'nova_secao'); return; }
      if (!bairro) { mostrarErroForm('Informe o bairro da seção nova.', 'nova_bairro'); return; }
      const reg = { id: idDe(cdF, sec), cd_mun: cdF, secao: sec, dados: { situacao: 'pendente', zona: ((base.get(cdF) || [])[0] || {}).zona || '', bairro: chaveBairro(bairro), local: String(form.elements.nova_local.value || '').trim() } };
      gravar(reg).then(() => { ui.aviso = 'Seção ' + sec + ' incluída em ' + nomeMun(cdF) + ' (' + titulo(bairro) + '), aguardando boletim.'; fecharModal(); renderCorpo(); })
        .catch((e) => mostrarErroForm('Não foi possível incluir a seção: ' + e.message));
      return;
    }
    if (acao === 'apagar-bu') {
      const form = campoForm();
      const cdF = form.elements.cd.value;
      const sec = secaoDoForm(form);
      const s = procurarSecao(cdF, sec);
      if (!s || !s.reg || !confirm('Apagar o boletim da seção ' + sec + ' (' + nomeMun(cdF) + ')? Os números dela saem da apuração.')) return;
      // seção incluída na tela continua na lista, aguardando boletim; seção da lista volta a "aguardando"
      const acaoApagar = s.extra
        ? () => gravar({ id: s.reg.id, cd_mun: cdF, secao: sec, dados: { situacao: 'pendente', zona: s.zona, bairro: s.bairro, local: s.local } })
        : () => apagar(s.reg.id);
      acaoApagar().then(() => { ui.aviso = 'Boletim da seção ' + sec + ' apagado.'; fecharModal(); renderCorpo(); })
        .catch((e) => mostrarErroForm('Não foi possível apagar: ' + e.message));
    }
  }

  // o número da seção é conferido depois de uma pausa na digitação (senão "1" de "105" já trocaria de município)
  let esperaSecao = null;
  function aoDigitar(ev) {
    const form = ev.target.closest('form[data-ap="form"]');
    if (!form) return;
    if (ui.erro) mostrarErroForm('');
    if (ev.target.name === 'nova_secao') { clearTimeout(esperaSecao); esperaSecao = setTimeout(prepararForm, 400); }
    else if (ev.target.inputMode === 'numeric') conferir();
  }

  function aoMudar(ev) {
    if (ev.target.matches('.ap-arquivo-bu')) {
      const arquivos = Array.from(ev.target.files || []);
      ev.target.value = '';
      if (arquivos.length) lerArquivosBoletim(arquivos);
      return;
    }
    if (!ev.target.closest('form[data-ap="form"]')) return;
    if (ev.target.name === 'cd' || ev.target.name === 'secao' || ev.target.name === 'nova_secao') { clearTimeout(esperaSecao); prepararForm(); }
    if (ev.target.name === 'secao' && ev.target.value === OUTRA) ev.target.form.elements.nova_secao.focus();
  }

  function aoSubmeter(ev) {
    const form = ev.target.closest('form[data-ap]');
    if (!form) return;
    ev.preventDefault();
    if (form.dataset.ap === 'form') { salvarBoletim(form); return; }
    if (form.dataset.ap === 'form-login') {
      const f = new FormData(form);
      const botao = form.querySelector('button[type="submit"]');
      botao.disabled = true;
      botao.textContent = 'Entrando…';
      global.Sync.entrar(String(f.get('email') || '').trim(), String(f.get('senha') || ''))
        .then(async () => {
          perfilAtual = await global.Sync.perfil();
          ui.modal = null;
          ui.erroLogin = '';
          if (!podeLancar()) ui.aviso = 'Sua conta ainda não foi autorizada pelo administrador para lançar boletins.';
          render();
          if (podeLancar()) garantirApoiados().then(() => renderCorpo());
        })
        .catch((e) => {
          // mostra o erro sem redesenhar o formulário (o e-mail e a senha digitados continuam lá)
          ui.erroLogin = e.message;
          let caixa = form.querySelector('.erro');
          if (!caixa) { caixa = document.createElement('div'); caixa.className = 'erro'; form.querySelector('.la-form-acoes').before(caixa); }
          caixa.textContent = e.message;
          botao.disabled = false;
          botao.textContent = 'Entrar';
        });
    }
  }

  function aoTeclar(ev) {
    if (!ctx || ctx.el.hidden || !ui.modal) return;
    if (ev.key === 'Escape') { fecharModal(); return; }
    // Enter passa para o próximo campo, como no papel; no último, salva
    if (ev.key === 'Enter' && ui.modal === 'form' && ev.target.matches('form[data-ap="form"] input:not([type="radio"])')) {
      ev.preventDefault();
      const form = campoForm();
      if (ev.target.name === 'nova_secao') { clearTimeout(esperaSecao); prepararForm(); }
      const campos = Array.from(form.querySelectorAll('input:not([type="radio"])')).filter((c) => !c.closest('[hidden]'));
      const i = campos.indexOf(ev.target);
      if (i >= 0 && i < campos.length - 1) campos[i + 1].focus();
      else if (form.requestSubmit) form.requestSubmit();
      else salvarBoletim(form);
    }
  }

  let eventosLigados = false;
  function ligarEventos() {
    if (eventosLigados) return;
    eventosLigados = true;
    ctx.el.addEventListener('click', aoClicar);
    ctx.el.addEventListener('input', aoDigitar);
    ctx.el.addEventListener('change', aoMudar);
    ctx.el.addEventListener('submit', aoSubmeter);
    document.addEventListener('keydown', aoTeclar);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && ctx && !ctx.el.hidden) atualizar(false); });
  }

  // ---------- atualização ----------
  let atualizando = null;
  function atualizar(manual) {
    if (atualizando) return atualizando;
    atualizando = (async () => {
      try {
        const mudou = await lerBoletins();
        const tinhaErro = !!ui.erroLeitura;
        ui.erroLeitura = '';
        ui.semTabela = false;
        if (mudou || manual || tinhaErro) renderCorpo();
        else { const h = ctx.el.querySelector('.ap-hora'); if (h) h.textContent = 'Atualizado às ' + ultimaLeitura.toLocaleTimeString('pt-BR') + ' · atualiza sozinho a cada ' + INTERVALO / 1000 + ' s'; }
      } catch (e) {
        tratarErroLeitura(e);
        renderCorpo();
      } finally { atualizando = null; }
    })();
    return atualizando;
  }

  function agendar() {
    if (timer) return;
    timer = setInterval(() => { if (ctx && !ctx.el.hidden && !document.hidden) atualizar(false); }, INTERVALO);
  }

  /** Ponto de entrada chamado pelo app: contexto = { el, candidatos2026?, fotos2026?, irPara? }. */
  async function mostrar(contexto) {
    ctx = contexto;
    ligarEventos();
    if (!ctx.el.querySelector('.ap-corpo')) {
      ctx.el.innerHTML = '<div class="ap-corpo"><section class="painel"><div class="vazio">Carregando a apuração…</div></section></div><div class="ap-modal-raiz"></div>' +
        '<input type="file" class="ap-arquivo-bu" accept="application/pdf,.pdf,image/*" multiple hidden>';
    }
    try {
      if (!carga) carga = carregarTudo();
      await carga;
      ui.erroCarga = '';
    } catch (e) {
      carga = null;
      ui.erroCarga = e.message;
      renderCorpo();
      return;
    }
    await atualizar(true);
    if (podeLancar() && !cargaApoiados) garantirApoiados().then(() => renderCorpo());
    // o app redesenha a tela a cada navegação: o popup aberto (com o que já foi digitado) fica como está
    const raiz = ctx.el.querySelector('.ap-modal-raiz');
    if (ui.modal && raiz && !raiz.innerHTML) renderModal();
    agendar();
  }

  /** Chamado pelo app ao sair da tela: fecha o popup (senão a rolagem da página continuaria travada). */
  function ocultar() {
    if (ctx && ui.modal) fecharModal();
  }

  global.Apuracao = { mostrar, ocultar };
})(window);
