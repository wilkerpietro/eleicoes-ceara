/* Eleições 2026 — mapeamento de lideranças municipais.
   Telas: "Lideranças" (cadastro enxuto com popup de detalhes), "Estimativa" (grupos por candidato de 2026
   e soma das estimativas por município) e "Candidatos 2026" (cadastro do TSE com foto).
   Os candidatos a vereador de 2024 entram automaticamente como lideranças do município.
   Os dados do mapeamento ficam no navegador (localStorage) e podem ser exportados/importados em JSON;
   data/liderancas.json é a base inicial. */
(function (global) {
  'use strict';

  const CHAVE = 'eleicoes-ce-liderancas-v1';
  const ARQUIVO_BASE = 'data/liderancas.json';
  const CANDIDATOS_2026 = 'data/2026-1/candidatos.csv';
  const FOTOS_2026 = 'data/2026-1/fotos/';
  const CARGOS_2026 = ['Presidente', 'Governador', 'Senador', 'Deputado Federal', 'Deputado Estadual'];
  const CARGOS_APOIO = ['Deputado Federal', 'Deputado Estadual']; // cargos em que a liderança declara apoio em 2026
  const CHAVE_CARGO = { Presidente: 'presidente', Governador: 'governador', Senador: 'senador', 'Deputado Federal': 'federal', 'Deputado Estadual': 'estadual' };
  const CARGO_DA_CHAVE = Object.fromEntries(Object.entries(CHAVE_CARGO).map(([c, k]) => [k, c]));

  let dados = null;     // { versao, liderancas: [], candidatos2026: [] (manuais), importados: {}, atualizadoEm }
  let tse2026 = null;   // candidatos de 2026 do TSE
  let ctx = null;       // contexto passado pelo app: { el, tela, cdMun, nomeMun, municipios, candidatos2026, fotos2026 }
  const cache = {};     // por município: listas de referência (vereadores/prefeitos 2024, deputados 2022)
  const ui = { modal: null, editando: null, busca: '', candidato: '', abaEst: 'federal', candMapa: '', bairroMapa: '', cargo26: '', busca26: '', novoCandidato: false, aviso: '', erroSync: '', erroLogin: '', abaLogin: 'entrar', perfis: null };
  let perfilAtual = null; // perfil do usuário conectado no modo nuvem: { id, email, nome, aprovado, papel }
  const nuvemAtiva = () => !!(global.Sync && global.Sync.configurado());
  const usuarioLogado = () => (nuvemAtiva() ? global.Sync.usuario() : null);
  const ehAdmin = () => nuvemAtiva() && !!perfilAtual && perfilAtual.aprovado && perfilAtual.papel === 'admin';
  /** Sem nuvem, tudo liberado; com nuvem, só usuário conectado e aprovado pelo administrador. */
  const acessoLiberado = () => !nuvemAtiva() || (!!usuarioLogado() && !!perfilAtual && !!perfilAtual.aprovado);

  // ---------- utilidades ----------
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtInt = (n) => (Number(n) || 0).toLocaleString('pt-BR');
  const titulo = (s) => String(s || '').toLowerCase().replace(/(^|[\s\-\/(])(\S)/g, (m, p, c) => p + c.toUpperCase()).replace(/ (De|Do|Da|Dos|Das|E) /g, (m) => m.toLowerCase());
  const normalizar = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const novoId = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const agora = () => new Date().toISOString();
  const nomeMunicipio = (cdm) => { const m = (ctx.municipios || []).find((x) => x.cd === cdm); return m ? titulo(m.nome) : cdm; };

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

  // Modo nuvem (Supabase, ver js/sync.js): as lideranças são carregadas por município e cada
  // alteração é gravada linha a linha; modo local: tudo no localStorage.
  const nuvem = () => !!(global.Sync && global.Sync.configurado());
  const municipiosCarregados = new Map(); // cd -> promessa da carga (evita duas cargas do mesmo município ao mesmo tempo)
  const snapshot = { liderancas: new Map(), candidatos: new Map(), importados: new Map() }; // último estado gravado na nuvem
  let gravando = null;

  async function carregar() {
    if (dados) return dados;
    if (nuvem()) {
      dados = vazio();
      try {
        for (const c of await global.Sync.carregarCandidatos()) { dados.candidatos2026.push(c); snapshot.candidatos.set(c.id, JSON.stringify(c)); }
      } catch (e) { ui.erroSync = 'Não foi possível ler os candidatos manuais: ' + e.message; }
      return dados;
    }
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

  /** Modo nuvem: traz as lideranças e a marca de importação de um município (uma vez por sessão). */
  function carregarMunicipio(cd) {
    if (!nuvem()) return Promise.resolve();
    if (!municipiosCarregados.has(cd)) {
      const carga = (async () => {
        const [lista, marca] = await Promise.all([global.Sync.carregarLiderancas(cd), global.Sync.carregarImportado(cd)]);
        dados.liderancas = dados.liderancas.filter((l) => l.cd_mun !== cd).concat(lista);
        for (const l of lista) snapshot.liderancas.set(l.id, JSON.stringify(l));
        if (marca) { dados.importados[cd] = marca; snapshot.importados.set(cd, marca); }
      })();
      municipiosCarregados.set(cd, carga);
      carga.catch(() => municipiosCarregados.delete(cd)); // falhou: permite tentar de novo
    }
    return municipiosCarregados.get(cd);
  }

  const vazioValor = (v) => v == null || v === '' || (typeof v === 'object' && !Object.keys(v).length);
  const CAMPOS_MESCLA = ['reduto', 'nomeCompleto', 'partido', 'numero', 'votos2024', 'situacao2024', 'foto', 'apoio2022_estadual', 'apoio2022_federal', 'apoio2024_prefeito', 'apoio2024_vereador'];

  /**
   * Junta lideranças repetidas do mesmo candidato de 2024 (mesmo município e mesmo sequencial do TSE),
   * criadas por importações duplicadas. Fica o registro mais antigo; os campos vazios dele são preenchidos
   * com os das cópias; expectativa 2026 e observação ficam com o valor editado mais recentemente; os apoios
   * de 2026 são unidos SEM alterar os do registro que fica. Devolve um relato por liderança unificada.
   */
  function unificarDuplicados(cd) {
    const grupos = new Map();
    for (const l of dados.liderancas) {
      if (l.cd_mun !== cd || !l.sq) continue;
      if (!grupos.has(l.sq)) grupos.set(l.sq, []);
      grupos.get(l.sq).push(l);
    }
    const quando = (l) => String(l._atualizadoEm || l.criadoEm || '');
    const relatos = [];
    const remover = new Set();
    for (const lista of grupos.values()) {
      if (lista.length < 2) continue;
      lista.sort((a, b) => String(a.criadoEm || '').localeCompare(String(b.criadoEm || '')) || String(a.id).localeCompare(String(b.id)));
      const fica = lista[0];
      const copias = lista.slice(1);
      const conflitos = new Set();
      const maisRecentes = lista.slice().sort((a, b) => quando(b).localeCompare(quando(a)));
      for (const k of ['votos2026', 'obs']) {
        const valores = maisRecentes.filter((l) => !vazioValor(l[k]));
        if (valores.length > 1 && new Set(valores.map((l) => JSON.stringify(l[k]))).size > 1) conflitos.add(k === 'votos2026' ? 'expectativa 2026' : 'observação');
        if (valores.length) fica[k] = valores[0][k];
      }
      for (const c of copias) {
        for (const k of CAMPOS_MESCLA) if (vazioValor(fica[k]) && !vazioValor(c[k])) fica[k] = c[k];
        for (const [chave, ap] of Object.entries(c.apoio2026 || {})) {
          if (!ap || !ap.candidato_id) continue;
          fica.apoio2026 = fica.apoio2026 || {};
          const atual = fica.apoio2026[chave];
          if (!atual || !atual.candidato_id) fica.apoio2026[chave] = ap;
          else if (atual.candidato_id !== ap.candidato_id) conflitos.add('apoio 2026 (' + chave + ')');
        }
        remover.add(c.id);
      }
      relatos.push(fica.nome + ': ' + copias.length + (copias.length === 1 ? ' cópia' : ' cópias') +
        (conflitos.size ? ' — valores diferentes em ' + Array.from(conflitos).join(', ') + ' (mantido o mais recente; apoios do registro original preservados)' : ''));
    }
    if (remover.size) dados.liderancas = dados.liderancas.filter((l) => !remover.has(l.id));
    return relatos;
  }

  function salvar() {
    dados.atualizadoEm = agora();
    if (!nuvem()) {
      try { localStorage.setItem(CHAVE, JSON.stringify(dados)); } catch (e) { console.warn('Não foi possível salvar no navegador:', e); }
      return;
    }
    // grava só o que mudou desde a última gravação (serializado, sem concorrência)
    gravando = (gravando || Promise.resolve()).then(gravarDiferencas).catch((e) => {
      ui.erroSync = 'Falha ao gravar na nuvem: ' + e.message;
      render();
    });
  }

  async function gravarDiferencas() {
    const S = global.Sync;
    const atuais = new Map(dados.liderancas.map((l) => [l.id, JSON.stringify(l)]));
    const mudadas = dados.liderancas.filter((l) => snapshot.liderancas.get(l.id) !== atuais.get(l.id));
    const removidas = Array.from(snapshot.liderancas.keys()).filter((id) => !atuais.has(id));
    const candAtuais = new Map(dados.candidatos2026.map((c) => [c.id, JSON.stringify(c)]));
    const candMudados = dados.candidatos2026.filter((c) => snapshot.candidatos.get(c.id) !== candAtuais.get(c.id));
    const candRemovidos = Array.from(snapshot.candidatos.keys()).filter((id) => !candAtuais.has(id));
    const marcas = Object.entries(dados.importados).filter(([cd, m]) => snapshot.importados.get(cd) !== String(m));
    if (!mudadas.length && !removidas.length && !candMudados.length && !candRemovidos.length && !marcas.length) return;
    if (!S.usuario()) throw new Error('entre com seu e-mail e senha para gravar.');
    await S.gravarLiderancas(mudadas);
    await S.excluirLiderancas(removidas);
    await S.gravarCandidatos(candMudados);
    await S.excluirCandidatos(candRemovidos);
    for (const [cd, m] of marcas) await S.marcarImportado(cd, m);
    for (const l of mudadas) snapshot.liderancas.set(l.id, atuais.get(l.id));
    for (const id of removidas) snapshot.liderancas.delete(id);
    for (const c of candMudados) snapshot.candidatos.set(c.id, candAtuais.get(c.id));
    for (const id of candRemovidos) snapshot.candidatos.delete(id);
    for (const [cd, m] of marcas) snapshot.importados.set(cd, String(m));
    if (ui.erroSync) { ui.erroSync = ''; render(); }
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

  /** Candidatos manuais que parecem repetir alguém do TSE: nome igual, contido ou muito parecido (até 2 letras). */
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
    const [c24, v24, c22, s24] = await Promise.all([
      lerCsv('data/2024-1/' + cd + '/candidatos.csv'),
      lerCsv('data/2024-1/' + cd + '/votos.csv'),
      lerCsv('data/2022-1/' + cd + '/candidatos.csv'),
      lerCsv('data/2024-1/' + cd + '/secoes.csv'),
    ]);
    const bairroDaSecao = new Map(s24.map((s) => [s.secao, s.bairro || '']));
    const votos = new Map();
    const porBairro = new Map(); // cargo|numero -> Map(bairro -> votos)
    for (const v of v24) {
      const n = parseInt(v.votos, 10) || 0;
      const k = v.cargo + '|' + v.numero;
      votos.set(k, (votos.get(k) || 0) + n);
      if (v.cargo !== '13' && v.cargo !== '11') continue;
      const b = bairroDaSecao.get(v.secao) || '';
      if (!b) continue;
      if (!porBairro.has(k)) porBairro.set(k, new Map());
      const m = porBairro.get(k);
      m.set(b, (m.get(b) || 0) + n);
    }
    const top3 = (k) => Array.from((porBairro.get(k) || new Map()).entries()).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([bairro, n]) => ({ bairro, votos: n }));
    const fotos24 = 'data/2024-1/fotos/';
    const candidato24 = (c, codigo) => ({
      numero: c.numero, sq: c.sq, nome: c.nome_urna || c.nome, nomeCompleto: c.nome, partido: c.partido, situacao: c.situacao,
      votos: votos.get(codigo + '|' + c.numero) || 0, foto: c.foto ? fotos24 + c.foto : '', bairros: top3(codigo + '|' + c.numero),
      votosBairros: Array.from((porBairro.get(codigo + '|' + c.numero) || new Map()).entries()).map(([bairro, n]) => ({ bairro, votos: n })), // todos os bairros (mapa estimativo)
    });
    const ref = {
      vereadores: c24.filter((c) => c.cargo === 'Vereador').map((c) => candidato24(c, '13')).sort((a, b) => b.votos - a.votos),
      prefeitos: c24.filter((c) => c.cargo === 'Prefeito').map((c) => candidato24(c, '11')).sort((a, b) => b.votos - a.votos),
      estaduais2022: c22.filter((c) => c.cargo === 'Deputado Estadual').map((c) => (c.nome_urna || c.nome) + ' (' + c.partido + ')'),
      federais2022: c22.filter((c) => c.cargo === 'Deputado Federal').map((c) => (c.nome_urna || c.nome) + ' (' + c.partido + ')'),
      bairros: Array.from(new Set(s24.map((s) => s.bairro || '').filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR')).map(titulo), // para o campo "Reduto" das lideranças manuais
    };
    cache[cd] = ref;
    return ref;
  }

  /** Inclui automaticamente os candidatos a vereador e a prefeito de 2024 do município (uma vez cada grupo). */
  let importando = Promise.resolve();
  function importarVereadores(cd) {
    // uma importação por vez: duas cargas simultâneas não podem criar o mesmo candidato duas vezes
    importando = importando.then(() => importarVereadoresAgora(cd)).catch((e) => { console.warn('importação:', e); return 0; });
    return importando;
  }
  async function importarVereadoresAgora(cd) {
    if (nuvem() && !global.Sync.usuario()) return 0; // sem login não há como gravar; importa depois de entrar
    await carregarMunicipio(cd); // garante que a marca "já importado" e as lideranças da nuvem estejam na memória
    const marca = dados.importados[cd]; // true = só vereadores (versão antiga); 'completo' = vereadores e prefeitos
    if (marca === 'completo') return 0;
    const ref = await referencias(cd);
    const existentes = new Set(dados.liderancas.filter((l) => l.cd_mun === cd && l.sq).map((l) => l.sq));
    let n = 0;
    const incluir = (v, origem) => {
      if (existentes.has(v.sq)) return;
      dados.liderancas.push({
        id: novoId('l'), cd_mun: cd, nome: v.nome, nomeCompleto: v.nomeCompleto, partido: v.partido, origem,
        sq: v.sq, numero: v.numero, votos2024: v.votos, situacao2024: v.situacao, foto: v.foto, votos2026: null,
        apoio2022_estadual: '', apoio2022_federal: '', apoio2024_prefeito: '', apoio2024_vereador: '',
        apoio2026: {}, obs: '', criadoEm: agora(),
      });
      existentes.add(v.sq);
      n++;
    };
    if (!marca) for (const v of ref.vereadores) incluir(v, 'vereador2024');
    for (const p of ref.prefeitos) incluir(p, 'prefeito2024');
    dados.importados[cd] = 'completo';
    salvar();
    return n;
  }

  const ORIGENS_2024 = { vereador2024: 'Ver. 2024', prefeito2024: 'Pref. 2024' };
  const foiCandidato2024 = (l) => l.origem in ORIGENS_2024;
  const selo = (l) => foiCandidato2024(l)
    ? '<span class="selo suplente" title="Candidato a ' + (l.origem === 'prefeito2024' ? 'prefeito' : 'vereador') + ' em 2024 · ' + esc(l.situacao2024 || '') + '">' + ORIGENS_2024[l.origem] + '</span>'
    : '<span class="selo turno">Manual</span>';
  const votos24 = (l) => (foiCandidato2024(l) ? fmtInt(l.votos2024) : '—');

  // ---------- consultas ----------
  const doMunicipio = (cd) => dados.liderancas.filter((l) => l.cd_mun === cd);
  const porId = (id) => dados.liderancas.find((l) => l.id === id) || null;

  function apoio(l, chave) {
    const a = l.apoio2026 && l.apoio2026[chave];
    if (!a || !a.candidato_id) return null;
    const c = candidato2026(a.candidato_id);
    return c ? { c, estimativa: Number(a.estimativa) || 0 } : null;
  }

  /** Os 3 bairros em que a liderança (candidata a vereador em 2024) teve mais votos, como texto: "Lagoinha, Camboas e Boa Vista". */
  function bairrosTexto(l) {
    const ref = cache[l.cd_mun];
    if (!ref || !foiCandidato2024(l)) return '';
    const lista = l.origem === 'prefeito2024' ? ref.prefeitos : ref.vereadores;
    const v = lista.find((x) => x.sq === l.sq || x.numero === l.numero);
    if (!v || !v.bairros.length) return '';
    const nomes = v.bairros.map((b) => titulo(b.bairro));
    return nomes.length > 1 ? nomes.slice(0, -1).join(', ') + ' e ' + nomes[nomes.length - 1] : nomes[0];
  }

  /** Expectativa de votos da liderança em 2026: o campo próprio ou, se vazio, a maior estimativa entre os seus candidatos. */
  function expectativa2026(l) {
    if (l.votos2026 != null && l.votos2026 !== '') return Number(l.votos2026) || 0;
    return Math.max(0, ...CARGOS_APOIO.map((c) => { const a = apoio(l, CHAVE_CARGO[c]); return a ? a.estimativa : 0; }));
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

  /** Candidatos com pelo menos uma liderança ligada no município (ou no estado, se cd vazio). */
  function estimativasPorCandidato(cd) {
    const mapa = new Map();
    for (const l of dados.liderancas) {
      if (cd && l.cd_mun !== cd) continue;
      for (const cargo of CARGOS_APOIO) {
        const a = apoio(l, CHAVE_CARGO[cargo]);
        if (!a) continue;
        if (!mapa.has(a.c.id)) mapa.set(a.c.id, { c: a.c, n: 0, total: 0, municipios: new Set() });
        const e = mapa.get(a.c.id);
        e.n++; e.total += a.estimativa; e.municipios.add(l.cd_mun);
      }
    }
    return Array.from(mapa.values()).sort((a, b) => CARGOS_2026.indexOf(a.c.cargo) - CARGOS_2026.indexOf(b.c.cargo) || b.total - a.total);
  }

  /**
   * Mapa estimativo: distribui a estimativa de cada liderança pelos bairros na proporção dos votos dela em 2024.
   * Ex.: 600 votos em 2024 e estimativa 300 → um bairro em que teve 30 votos recebe 15. Lideranças manuais
   * dividem a estimativa igualmente entre os bairros do campo "Reduto"; sem base, o valor fica em "sem bairro".
   */
  function estimativaPorBairro(cd, candId) {
    const g = grupo(candId, cd);
    const ref = cache[cd] || { vereadores: [], prefeitos: [], bairros: [] };
    const bairros = new Map(); // bairro -> { bairro, votos, itens: [{ l, base, votos }] }
    const semBairro = { bairro: '', votos: 0, itens: [] };
    const somar = (bairro, l, base, v) => {
      if (!bairros.has(bairro)) bairros.set(bairro, { bairro, votos: 0, itens: [] });
      const b = bairros.get(bairro);
      b.votos += v;
      b.itens.push({ l, base, votos: v });
    };
    const chaveBairro = (s) => normalizar(s).replace(/[^a-z0-9]+/g, ' ').trim();
    const conhecidos = new Map((ref.bairros || []).map((b) => [chaveBairro(b), b.toUpperCase()]));
    for (const i of g.itens) {
      const l = i.l, E = i.estimativa;
      if (!E) continue;
      if (foiCandidato2024(l)) {
        const lista = l.origem === 'prefeito2024' ? ref.prefeitos : ref.vereadores;
        const v = lista.find((x) => x.sq === l.sq || x.numero === l.numero);
        const V = (v && v.votos) || l.votos2024 || 0;
        if (v && V > 0 && v.votosBairros && v.votosBairros.length) {
          for (const vb of v.votosBairros) if (vb.votos > 0) somar(vb.bairro, l, vb.votos, (vb.votos * E) / V);
          continue;
        }
      } else if (l.reduto) {
        const partes = l.reduto.split(/[,;\/]| e /i).map((p) => chaveBairro(p)).filter(Boolean);
        const achados = Array.from(new Set(partes.map((p) => conhecidos.get(p)).filter(Boolean)));
        if (achados.length) { for (const b of achados) somar(b, l, null, E / achados.length); continue; }
      }
      semBairro.votos += E; semBairro.itens.push({ l, base: null, votos: E });
    }
    for (const b of bairros.values()) b.itens.sort((a, c) => c.votos - a.votos);
    semBairro.itens.sort((a, c) => c.votos - a.votos);
    const lista = Array.from(bairros.values()).sort((a, b) => b.votos - a.votos);
    return { c: g.c, chave: g.chave, itens: g.itens, total: g.total, bairros: lista, semBairro };
  }

  const mapa26 = { div: null, obj: null, camada: null, ajustadoPara: '' };

  function renderMapaEstimativo(cd) {
    const aba = ABAS_EST.find((a) => a.id === ui.abaEst) || ABAS_EST[0];
    const cands = estimativasPorCandidato(cd).filter((e) => aba.cargos.includes(e.c.cargo));
    if (!cands.some((e) => e.c.id === ui.candMapa)) ui.candMapa = cands.length ? cands[0].c.id : '';
    const abas = '<div class="segmentado la-abas">' + ABAS_EST.map((a) => '<button type="button" class="' + (a.id === aba.id ? 'ativo' : '') + '" data-la="aba-est" data-valor="' + a.id + '">' + esc(a.rotulo) + '</button>').join('') + '</div>';
    const seletor = '<select data-la="sel-cand-mapa" class="la-sel-grupo"' + (cands.length ? '' : ' disabled') + '>' +
      (cands.length ? cands.map((e) => '<option value="' + e.c.id + '"' + (e.c.id === ui.candMapa ? ' selected' : '') + '>' + esc(rotuloCand(e.c)) + ' · ' + fmtInt(e.total) + ' votos estimados</option>').join('')
        : '<option value="">— nenhum candidato a ' + esc(aba.rotulo) + ' com lideranças em ' + esc(ctx.nomeMun) + ' —</option>') + '</select>';
    let corpo;
    if (!ui.candMapa) {
      corpo = '<div class="vazio">Ligue lideranças a um candidato a ' + esc(aba.rotulo) + ' (na ficha da liderança ou na tela Estimativa) para ver o mapa.</div>';
    } else {
      const e = estimativaPorBairro(cd, ui.candMapa);
      const cor = ctx.corPartido ? ctx.corPartido(e.c.partido) : '#2f6fed';
      const maximo = Math.max(1, ...e.bairros.map((b) => b.votos));
      const temGeo = (ctx.geoBairros || []).length > 0;
      if (ui.bairroMapa && !e.bairros.some((b) => b.bairro === ui.bairroMapa) && ui.bairroMapa !== '*') ui.bairroMapa = '';
      const transfer = (itens) => '<div class="la-transfer">' + itens.map((i) => '<div class="item">' + avatar(i.l.nome, i.l.foto, 24) +
        '<span class="nome">' + esc(i.l.nome) + (i.base != null ? '<small>' + fmtInt(i.base) + ' votos em 2024 aqui</small>' : (foiCandidato2024(i.l) ? '' : '<small>manual' + (i.l.reduto ? ' · reduto: ' + esc(i.l.reduto) : '') + '</small>')) + '</span>' +
        '<span class="num">' + fmtInt(Math.round(i.votos)) + '</span></div>').join('') + '</div>';
      const linhas = e.bairros.map((b) => {
        const aberto = ui.bairroMapa === b.bairro;
        return '<button type="button" class="la-bairro-item' + (aberto ? ' atual' : '') + '" data-la="bairro-mapa" data-valor="' + esc(b.bairro) + '">' +
          '<span class="nome">' + esc(titulo(b.bairro)) + '<small>' + b.itens.length + (b.itens.length === 1 ? ' liderança' : ' lideranças') + '</small>' +
          '<span class="barra-mini" style="width:' + Math.max(4, Math.round(100 * b.votos / maximo)) + '%;background:' + cor + '"></span></span>' +
          '<span class="num">' + fmtInt(Math.round(b.votos)) + '</span></button>' + (aberto ? transfer(b.itens) : '');
      }).join('');
      const semB = e.semBairro.itens.length
        ? '<button type="button" class="la-bairro-item' + (ui.bairroMapa === '*' ? ' atual' : '') + '" data-la="bairro-mapa" data-valor="*"><span class="nome">Sem bairro definido<small>' +
          e.semBairro.itens.length + ' liderança(s) sem votos por bairro em 2024 nem reduto</small></span><span class="num">' + fmtInt(Math.round(e.semBairro.votos)) + '</span></button>' + (ui.bairroMapa === '*' ? transfer(e.semBairro.itens) : '')
        : '';
      corpo = '<div class="la-grade-mapa"><div>' +
        (temGeo ? '<div class="la-mapa-slot"></div>' : '<div class="vazio">Os bairros de ' + esc(ctx.nomeMun) + ' ainda não têm coordenadas em data/bairros.json; a lista ao lado traz a estimativa por bairro.</div>') +
        '<div class="la-legenda-mapa">Cada quadro mostra os votos estimados para <b>' + esc(e.c.nome) + '</b> no bairro. Regra: estimativa da liderança × (votos dela no bairro em 2024 ÷ votos dela em 2024). Clique no bairro para ver quem transfere.</div></div>' +
        '<div><div class="cards la-cards-grupo">' + card(fmtInt(Math.round(e.total)), 'Estimativa em ' + ctx.nomeMun, e.itens.length + (e.itens.length === 1 ? ' liderança' : ' lideranças')) + '</div>' +
        '<div class="detalhe-sub">Votos estimados por bairro</div><div class="la-lista-bairros">' + (linhas || '<div class="vazio">Nenhuma liderança com votos por bairro.</div>') + semB + '</div></div></div>';
    }
    return '<section class="painel"><div class="painel-cabecalho"><h2>Mapa estimativo 2026 em ' + esc(ctx.nomeMun) + '</h2>' +
      '<span class="dica">Onde devem sair os votos de cada candidato, a partir das lideranças que o apoiam e de onde elas tiveram votos em 2024.</span></div>' +
      '<div class="la-mapa-cab">' + abas + seletor + '</div>' + corpo + '</section>';
  }

  /** Cria (uma vez) o mapa Leaflet do mapa estimativo, encaixa no espaço renderizado e desenha os quadros por bairro. */
  function montarMapaEstimativo(cd) {
    const slot = ctx.el.querySelector('.la-mapa-slot');
    if (!slot || typeof L === 'undefined' || !ui.candMapa) return;
    if (!mapa26.div) {
      mapa26.div = document.createElement('div');
      mapa26.div.className = 'la-mapa';
      mapa26.obj = L.map(mapa26.div, { scrollWheelZoom: true, zoomControl: true });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19 }).addTo(mapa26.obj);
      mapa26.camada = L.layerGroup().addTo(mapa26.obj);
    }
    slot.appendChild(mapa26.div);
    const e = estimativaPorBairro(cd, ui.candMapa);
    const cor = ctx.corPartido ? ctx.corPartido(e.c.partido) : '#2f6fed';
    const geo = new Map((ctx.geoBairros || []).filter((b) => b.lat != null && b.lng != null).map((b) => [b.nome, b]));
    const maximo = Math.max(1, ...e.bairros.map((b) => b.votos));
    mapa26.camada.clearLayers();
    const pontos = [];
    for (const b of e.bairros) {
      const g = geo.get(b.bairro);
      if (!g) continue;
      const tam = b.votos >= maximo * 0.6 ? ' grande' : (b.votos < maximo * 0.15 ? ' pequeno' : '');
      const html = '<div class="la-marc' + tam + (ui.bairroMapa === b.bairro ? ' selecionado' : '') + '" style="--cor:' + cor + '"><b>' + fmtInt(Math.round(b.votos)) + '</b><span>' + esc(titulo(b.bairro)) + '</span></div>';
      const m = L.marker([g.lat, g.lng], { icon: L.divIcon({ html, className: 'la-marc-wrap', iconSize: [0, 0], iconAnchor: [0, 0] }), keyboard: false });
      m.bindTooltip('<b>' + esc(titulo(b.bairro)) + '</b>' + b.itens.slice(0, 3).map((i) => esc(i.l.nome) + ' ' + fmtInt(Math.round(i.votos))).join(' · ') + (b.itens.length > 3 ? ' · +' + (b.itens.length - 3) : ''), { className: 'rotulo-bairro', direction: 'top', offset: [0, -22], opacity: 1 });
      m.on('click', () => { ui.bairroMapa = ui.bairroMapa === b.bairro ? '' : b.bairro; render(); });
      m.addTo(mapa26.camada);
      pontos.push([g.lat, g.lng]);
    }
    // bairros com coordenadas mas sem estimativa também aparecem, discretos, para situar o mapa
    for (const g of geo.values()) if (!e.bairros.some((b) => b.bairro === g.nome)) pontos.push([g.lat, g.lng]);
    setTimeout(() => {
      mapa26.obj.invalidateSize();
      if (mapa26.ajustadoPara !== cd && pontos.length) { mapa26.obj.fitBounds(L.latLngBounds(pontos), { padding: [30, 30] }); mapa26.ajustadoPara = cd; }
    }, 0);
  }

  // ---------- render ----------
  const semMunicipio = () => !ctx.cdMun || ctx.cdMun === 'todos';

  function render() {
    if (!ctx || !dados) return;
    const tela = ctx.tela || 'liderancas';
    const lista = semMunicipio() ? [] : doMunicipio(ctx.cdMun);
    const aviso = (ui.aviso ? '<section class="painel la-aviso"><span>' + esc(ui.aviso) + '</span><button type="button" class="btn btn-mini" data-la="fechar-aviso">OK</button></section>' : '') +
      (ui.erroSync ? '<section class="painel la-aviso la-erro-sync"><span>' + esc(ui.erroSync) + '</span><button type="button" class="btn btn-mini" data-la="fechar-erro">OK</button></section>' : '');
    const usuario = usuarioLogado();
    const status = '<div class="la-status">' + (nuvemAtiva()
      ? (usuario
        ? '<span><span class="ponto' + (acessoLiberado() ? '' : ' off') + '"></span>' + esc((perfilAtual && perfilAtual.nome) || usuario.email) +
          (ehAdmin() ? ' · administrador' : (acessoLiberado() ? ' · acesso liberado' : ' · aguardando autorização')) + '</span>' +
          '<button type="button" class="btn btn-mini" data-la="definir-senha">Trocar senha</button><button type="button" class="btn btn-mini" data-la="sair">Sair</button>'
        : '<span><span class="ponto off"></span>Acesso restrito · entre ou crie sua conta</span><button type="button" class="btn btn-mini btn-primario" data-la="entrar">Entrar</button>')
      : '<span><span class="ponto local"></span>Dados salvos neste navegador (sem banco na nuvem configurado)</span>') + '</div>';
    ctx.el.classList.toggle('la-somente-leitura', !acessoLiberado());
    let corpo;
    if (tela === 'candidatos') corpo = renderCandidatos2026();
    else if (!acessoLiberado()) corpo = renderBloqueado(usuario);
    else if (tela === 'usuarios') corpo = ehAdmin() ? renderUsuarios() : '<section class="painel"><div class="vazio">Só administradores veem os usuários.</div></section>';
    else if (semMunicipio()) corpo = '<section class="painel"><div class="vazio">Escolha um município na barra lateral para ' + (tela === 'estimativa' ? 'ver a estimativa de votos' : tela === 'mapa26' ? 'ver o mapa estimativo' : 'mapear as lideranças') + ' dele.</div></section>';
    else if (tela === 'estimativa') corpo = renderEstimativa(ctx.cdMun, lista);
    else if (tela === 'mapa26') corpo = renderMapaEstimativo(ctx.cdMun);
    else corpo = renderLiderancas(ctx.cdMun, lista);
    ctx.el.innerHTML = status + aviso + corpo + renderModal();
    document.body.classList.toggle('la-modal-aberto', !!ui.modal);
    if (tela === 'mapa26' && acessoLiberado() && !semMunicipio()) montarMapaEstimativo(ctx.cdMun);
  }

  // ---------- tela Lideranças ----------
  function renderLiderancas(cd, lista) {
    const q = normalizar(ui.busca);
    const filtradas = (q ? lista.filter((l) => normalizar(l.nome + ' ' + (l.nomeCompleto || '') + ' ' + (l.partido || '')).includes(q)) : lista)
      .slice().sort((a, b) => (b.votos2024 || 0) - (a.votos2024 || 0) || a.nome.localeCompare(b.nome, 'pt-BR'));
    const total24 = filtradas.reduce((s, l) => s + (l.votos2024 || 0), 0);
    const total26 = filtradas.reduce((s, l) => s + expectativa2026(l), 0);
    return '<section class="painel"><div class="painel-cabecalho la-cab-lista"><h2>Cadastro</h2>' +
      '<button type="button" class="btn btn-primario" data-la="nova">+ Nova liderança</button>' +
      '<input type="search" class="la-busca" placeholder="Buscar liderança" value="' + esc(ui.busca) + '" data-la="busca"></div>' +
      '<div class="tabela-scroll"><table class="la-tabela la-limpa"><thead><tr><th>Liderança</th><th class="num">Votos em 2024</th><th class="num">Expectativa 2026</th><th></th></tr></thead><tbody>' +
      (filtradas.map((l) => '<tr class="clicavel" data-la="abrir" data-id="' + l.id + '">' +
        '<td class="texto"><span class="cand-linha">' + avatar(l.nome, l.foto, 40) + '<span><strong>' + esc(l.nome) + '</strong>' +
          (l.partido ? '<small class="dica"> · ' + esc(l.partido) + '</small>' : '') + '</span></span></td>' +
        '<td class="num">' + (foiCandidato2024(l) ? fmtInt(l.votos2024) + ' <small class="dica">votos em 2024' + (l.origem === 'prefeito2024' ? ' (prefeito)' : '') + '</small>' + (bairrosTexto(l) ? '<span class="la-bairros">' + esc(bairrosTexto(l)) + '</span>' : '')
          : (l.reduto ? '<small class="dica">reduto</small><span class="la-bairros">' + esc(l.reduto) + '</span>' : '<span class="dica">—</span>')) + '</td>' +
        '<td class="num">' + (expectativa2026(l) ? fmtInt(expectativa2026(l)) : '<span class="dica">—</span>') + '</td>' +
        '<td class="la-td-acoes"><button type="button" class="btn btn-mini" data-la="abrir" data-id="' + l.id + '">Detalhes</button></td></tr>').join('') ||
        '<tr><td colspan="4" class="vazio">Nenhuma liderança' + (q ? ' encontrada para "' + esc(ui.busca) + '"' : ' cadastrada') + '.</td></tr>') +
      '</tbody><tfoot><tr><td>' + filtradas.length + ' lideranças</td><td class="num">' + fmtInt(total24) + '</td><td class="num">' + fmtInt(total26) + '</td><td></td></tr></tfoot></table></div>' +
      '<div class="la-rodape-acoes"><span class="dica">Dados salvos neste navegador.</span>' +
      '<button type="button" class="btn btn-mini" data-la="exportar" title="Baixa um arquivo JSON com todo o cadastro">Exportar</button>' +
      '<label class="btn btn-mini">Importar<input type="file" accept="application/json,.json" data-la="importar" hidden></label></div></section>';
  }

  // ---------- popup de detalhes / edição ----------
  function renderModal() {
    if (!ui.modal) return '';
    if (ui.modal === 'login') {
      const abas = '<div class="segmentado la-abas la-abas-login">' +
        '<button type="button" class="' + (ui.abaLogin === 'entrar' ? 'ativo' : '') + '" data-la="aba-login" data-valor="entrar">Entrar</button>' +
        '<button type="button" class="' + (ui.abaLogin === 'cadastrar' ? 'ativo' : '') + '" data-la="aba-login" data-valor="cadastrar">Criar conta</button></div>';
      const erro = ui.erroLogin ? '<div class="erro">' + esc(ui.erroLogin) + '</div>' : '';
      const corpo = ui.abaLogin === 'cadastrar'
        ? '<form data-la="form-cadastro" class="la-login">' +
          '<label class="campo"><span>Nome</span><input name="nome" required autocomplete="name" placeholder="Como quer ser identificado"></label>' +
          '<label class="campo"><span>E-mail</span><input name="email" type="email" required autocomplete="username"></label>' +
          '<label class="campo"><span>Senha (mínimo 6 caracteres)</span><input name="senha" type="password" required minlength="6" autocomplete="new-password"></label>' +
          '<label class="campo"><span>Repita a senha</span><input name="senha2" type="password" required minlength="6" autocomplete="new-password"></label>' + erro +
          '<div class="la-form-acoes"><button type="submit" class="btn btn-primario">Criar conta</button><button type="button" class="btn" data-la="fechar-modal">Cancelar</button></div>' +
          '<span class="dica">Depois de criar a conta, aguarde a autorização do administrador para acessar o mapeamento.</span></form>'
        : '<form data-la="form-login" class="la-login">' +
          '<label class="campo"><span>E-mail</span><input name="email" type="email" required autocomplete="username"></label>' +
          '<label class="campo"><span>Senha</span><input name="senha" type="password" required autocomplete="current-password"></label>' + erro +
          '<div class="la-form-acoes"><button type="submit" class="btn btn-primario">Entrar</button><button type="button" class="btn" data-la="fechar-modal">Cancelar</button></div></form>' +
          '<form data-la="form-link" class="la-login la-login-link">' +
          '<div class="detalhe-sub">Esqueceu a senha? Receba um link de acesso por e-mail</div>' +
          '<label class="campo"><span>E-mail cadastrado</span><input name="email" type="email" required autocomplete="username"></label>' +
          (ui.avisoLink ? '<div class="dica">' + esc(ui.avisoLink) + '</div>' : '') +
          '<div class="la-form-acoes"><button type="submit" class="btn">Enviar link</button></div>' +
          '<span class="dica">Depois de entrar pelo link, use "Trocar senha" para definir uma nova.</span></form>';
      return '<div class="la-modal-fundo" data-la="fechar-modal"><div class="la-modal" role="dialog" aria-modal="true">' +
        '<button type="button" class="la-modal-fechar" data-la="fechar-modal" title="Fechar">×</button>' +
        '<div class="la-modal-topo"><h2>' + (ui.abaLogin === 'cadastrar' ? 'Criar conta' : 'Entrar') + '</h2></div>' + abas + corpo + '</div></div>';
    }
    if (ui.modal === 'senha') {
      return '<div class="la-modal-fundo" data-la="fechar-modal"><div class="la-modal" role="dialog" aria-modal="true">' +
        '<button type="button" class="la-modal-fechar" data-la="fechar-modal" title="Fechar">×</button>' +
        '<div class="la-modal-topo"><h2>Definir senha</h2></div>' +
        '<form data-la="form-senha" class="la-login">' +
        '<label class="campo"><span>Nova senha (mínimo 6 caracteres)</span><input name="senha" type="password" required minlength="6" autocomplete="new-password"></label>' +
        '<label class="campo"><span>Repita a senha</span><input name="senha2" type="password" required minlength="6" autocomplete="new-password"></label>' +
        (ui.erroLogin ? '<div class="erro">' + esc(ui.erroLogin) + '</div>' : '') +
        '<div class="la-form-acoes"><button type="submit" class="btn btn-primario">Salvar senha</button><button type="button" class="btn" data-la="fechar-modal">Cancelar</button></div>' +
        '</form></div></div>';
    }
    const nova = ui.modal === 'nova';
    const l = nova ? null : porId(ui.modal);
    if (!nova && !l) { ui.modal = null; return ''; }
    const editando = nova || ui.editando === ui.modal;
    let corpo;
    if (editando) corpo = renderFormulario(ctx.cdMun, l);
    else corpo = renderDetalhes(l);
    return '<div class="la-modal-fundo" data-la="fechar-modal"><div class="la-modal" role="dialog" aria-modal="true">' +
      '<button type="button" class="la-modal-fechar" data-la="fechar-modal" title="Fechar">×</button>' + corpo + '</div></div>';
  }

  function renderDetalhes(l) {
    const linha = (rotulo, valor) => '<div class="la-det"><span class="rotulo">' + esc(rotulo) + '</span><span class="valor">' + (valor || '<span class="dica">—</span>') + '</span></div>';
    const apoios26 = CARGOS_APOIO.map((cargo) => {
      const a = apoio(l, CHAVE_CARGO[cargo]);
      return '<div class="la-det"><span class="rotulo">' + esc(cargo) + '</span><span class="valor">' + (a
        ? '<span class="cand-linha">' + avatar(a.c.nome, a.c.foto, 28) + '<span>' + esc(a.c.nome) + (a.c.partido ? ' (' + esc(a.c.partido) + ')' : '') + (a.c.numero ? ' · nº ' + esc(a.c.numero) : '') +
          '<br><small class="dica">estimativa: ' + fmtInt(a.estimativa) + ' votos</small></span></span>'
        : '<span class="dica">—</span>') + '</span></div>';
    }).join('');
    return '<div class="la-modal-topo"><span class="cand-linha">' + avatar(l.nome, l.foto, 72) + '<span><strong class="la-modal-nome">' + esc(l.nome) + '</strong>' + selo(l) +
        (l.nomeCompleto && l.nomeCompleto !== l.nome ? '<br><small class="dica">' + esc(titulo(l.nomeCompleto)) + '</small>' : '') +
        (l.partido ? '<br><small class="dica">' + esc(l.partido) + '</small>' : '') + '</span></span></div>' +
      '<div class="la-det-grid">' +
        linha('Votos em 2024' + (l.origem === 'prefeito2024' ? ' (prefeito)' : ''), foiCandidato2024(l) ? fmtInt(l.votos2024) + (l.situacao2024 ? ' <small class="dica">· ' + esc(l.situacao2024) + '</small>' : '') + (bairrosTexto(l) ? '<br><small class="dica">Mais votado em: ' + esc(bairrosTexto(l)) + '</small>' : '') : '') +
        (foiCandidato2024(l) ? '' : linha('Reduto', esc(l.reduto))) +
        linha('Expectativa de votos em 2026', expectativa2026(l) ? fmtInt(expectativa2026(l)) : '') +
        linha('2022 · trabalhou para Dep. Estadual', esc(l.apoio2022_estadual)) +
        linha('2022 · trabalhou para Dep. Federal', esc(l.apoio2022_federal)) +
        (l.origem === 'prefeito2024' ? '' : linha('2024 · apoiou para Prefeito', esc(l.apoio2024_prefeito))) +
        (l.origem === 'vereador2024' ? '' : linha('2024 · apoiou para Vereador', esc(l.apoio2024_vereador))) +
      '</div>' +
      '<div class="detalhe-sub">Trabalhará em 2026 para</div><div class="la-det-grid">' + apoios26 + '</div>' +
      (l.obs ? '<div class="la-det"><span class="rotulo">Observações</span><span class="valor">' + esc(l.obs) + '</span></div>' : '') +
      '<div class="la-form-acoes"><button type="button" class="btn btn-primario" data-la="editar" data-id="' + l.id + '">Editar</button>' +
        (foiCandidato2024(l) && ctx.verVotos ? '<button type="button" class="btn" data-la="ver-votos" data-id="' + l.id + '" title="Abre a tela Tabelas nas Eleições 2024 com este candidato filtrado">Ver detalhamento dos votos</button>' : '') +
        '<button type="button" class="btn" data-la="excluir" data-id="' + l.id + '">Excluir</button>' +
        '<button type="button" class="btn" data-la="fechar-modal">Fechar</button></div>';
  }

  function datalistCandidatos(id, cargo) {
    const lista = candidatos2026().filter((c) => c.cargo === cargo).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    return '<datalist id="' + id + '">' + lista.map((c) => '<option value="' + esc(rotuloCand(c)) + '">').join('') + '</datalist>';
  }

  function renderFormulario(cd, l) {
    const ref = cache[cd] || { prefeitos: [], vereadores: [], estaduais2022: [], federais2022: [] };
    const v = (k) => esc(l ? (l[k] == null ? '' : l[k]) : '');
    const datalist = (id, itens) => '<datalist id="' + id + '">' + itens.map((i) => '<option value="' + esc(i) + '">').join('') + '</datalist>';
    const ehVer = l && foiCandidato2024(l); // candidato de 2024: nome vem do TSE e não se edita
    const ehPref = l && l.origem === 'prefeito2024';
    const linha2026 = (cargo) => {
      const chave = CHAVE_CARGO[cargo];
      const a = l ? apoio(l, chave) : null;
      return '<div class="la-2026"><span class="rotulo">' + esc(cargo) + '</span><div class="la-linha">' +
        '<input name="cand_' + chave + '" list="la-c26-' + chave + '" placeholder="candidato (lista do TSE)" value="' + (a ? esc(rotuloCand(a.c)) : '') + '" autocomplete="off">' +
        datalistCandidatos('la-c26-' + chave, cargo) +
        '<input name="est_' + chave + '" type="number" min="0" step="1" placeholder="votos p/ ele" value="' + (a && a.estimativa ? a.estimativa : '') + '"></div></div>';
    };
    return '<div class="la-modal-topo"><h2>' + (l ? 'Editar liderança' : 'Nova liderança') + '</h2>' +
      (ehVer ? '<span class="dica">Candidato a ' + (ehPref ? 'prefeito' : 'vereador') + ' em 2024 · ' + fmtInt(l.votos2024) + ' votos · ' + esc(l.situacao2024 || '') + '</span>' : '') + '</div>' +
      '<form data-la="form" data-id="' + (l ? l.id : '') + '" class="la-grid">' +
      '<label class="campo"><span>Nome</span><input name="nome" required value="' + v('nome') + '"' + (ehVer ? ' readonly' : '') + '></label>' +
      '<label class="campo"><span>Partido / grupo</span><input name="partido" value="' + v('partido') + '"></label>' +
      (ehVer ? '' : '<label class="campo"><span>Reduto (bairros ou localidades onde tem força)</span><input name="reduto" list="la-reduto" value="' + v('reduto') + '" autocomplete="off" placeholder="ex.: Lagoinha, Camboas"></label>' + datalist('la-reduto', ref.bairros || [])) +
      '<label class="campo"><span>Expectativa de votos em 2026 (a distribuir para os seus candidatos)</span><input name="votos2026" type="number" min="0" step="1" value="' + v('votos2026') + '" placeholder="' + (l && l.votos2024 ? 'ex.: ' + l.votos2024 : 'votos') + '"></label>' +
      '<label class="campo"><span>2022 · trabalhou para (Dep. Estadual)</span><input name="apoio2022_estadual" list="la-est22" value="' + v('apoio2022_estadual') + '" autocomplete="off"></label>' + datalist('la-est22', ref.estaduais2022) +
      '<label class="campo"><span>2022 · trabalhou para (Dep. Federal)</span><input name="apoio2022_federal" list="la-fed22" value="' + v('apoio2022_federal') + '" autocomplete="off"></label>' + datalist('la-fed22', ref.federais2022) +
      (ehPref ? '' : '<label class="campo"><span>2024 · apoiou para Prefeito</span><input name="apoio2024_prefeito" list="la-pref24" value="' + v('apoio2024_prefeito') + '" autocomplete="off"></label>' + datalist('la-pref24', ref.prefeitos.map((p) => p.nome + ' (' + p.partido + ')'))) +
      (l && l.origem === 'vereador2024' ? '' : '<label class="campo"><span>2024 · apoiou para Vereador</span><input name="apoio2024_vereador" list="la-ver24" value="' + v('apoio2024_vereador') + '" autocomplete="off"></label>' + datalist('la-ver24', ref.vereadores.map((p) => p.nome + ' (' + p.partido + ')'))) +
      '<div class="la-bloco-2026"><div class="detalhe-sub">Trabalhará em 2026 para</div>' + CARGOS_APOIO.map(linha2026).join('') +
        '<div class="dica">Digite e escolha na lista (cadastro do TSE de 2026). Candidato fora da lista: <button type="button" class="btn btn-mini" data-la="novo-cand-form">cadastrar manualmente</button></div>' +
        renderNovoCandidato() + '</div>' +
      '<label class="campo la-obs"><span>Observações</span><textarea name="obs" rows="2">' + v('obs') + '</textarea></label>' +
      '<div class="la-form-acoes"><button type="submit" class="btn btn-primario">Salvar</button><button type="button" class="btn" data-la="cancelar">Cancelar</button></div>' +
      '</form>';
  }

  function renderNovoCandidato() {
    if (!ui.novoCandidato) return '';
    return '<form data-la="form-cand" class="la-novo-cand">' +
      '<strong>Novo candidato 2026 (manual)</strong>' +
      '<input name="nome" required placeholder="Nome (ex.: Yury do Paredão)">' +
      '<select name="cargo">' + CARGOS_APOIO.map((c) => '<option value="' + c + '"' + (c === ui.novoCandidato ? ' selected' : '') + '>' + c + '</option>').join('') + '</select>' +
      '<input name="partido" placeholder="Partido">' +
      '<button type="submit" class="btn btn-primario">Adicionar</button><button type="button" class="btn" data-la="cancelar-cand">Cancelar</button></form>';
  }

  // ---------- tela Estimativa ----------
  const ABAS_EST = [
    { id: 'federal', rotulo: 'Deputado Federal', cargos: ['Deputado Federal'] },
    { id: 'estadual', rotulo: 'Deputado Estadual', cargos: ['Deputado Estadual'] },
  ];

  function renderEstimativa(cd, lista) {
    const cands = candidatos2026();
    if (ui.candidato && !candidato2026(ui.candidato)) ui.candidato = '';
    const aba = ABAS_EST.find((a) => a.id === ui.abaEst) || ABAS_EST[0];
    const todas = estimativasPorCandidato(cd);
    const totalAba = (a) => todas.filter((e) => a.cargos.includes(e.c.cargo)).reduce((s, e) => s + e.total, 0);
    let linhas = todas.filter((e) => aba.cargos.includes(e.c.cargo));
    // candidato escolhido no seletor que ainda não tem lideranças aparece na lista para começar o grupo
    const escolhido = ui.candidato ? candidato2026(ui.candidato) : null;
    if (escolhido && aba.cargos.includes(escolhido.cargo) && !linhas.some((e) => e.c.id === escolhido.id)) {
      linhas = linhas.concat([{ c: escolhido, n: 0, total: 0, municipios: new Set() }]);
    }
    const abas = '<div class="segmentado la-abas">' + ABAS_EST.map((a) => '<button type="button" class="' + (a.id === aba.id ? 'ativo' : '') + '" data-la="aba-est" data-valor="' + a.id + '">' +
      esc(a.rotulo) + ' <span class="contagem">' + fmtInt(totalAba(a)) + '</span></button>').join('') + '</div>';
    const seletor = '<select data-la="sel-grupo" class="la-sel-grupo"><option value="">— montar grupo para outro candidato a ' + esc(aba.rotulo) + ' —</option>' +
      aba.cargos.map((cargo) => {
        const doCargo = cands.filter((c) => c.cargo === cargo && !linhas.some((e) => e.c.id === c.id)).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
        return doCargo.length ? '<optgroup label="' + esc(cargo) + '">' + doCargo.map((c) => '<option value="' + c.id + '">' + esc(rotuloCand(c)) + (c.origem === 'manual' ? ' · manual' : '') + '</option>').join('') + '</optgroup>' : '';
      }).join('') + '</select>';

    const corpo = linhas.map((e) => {
      const aberto = ui.candidato === e.c.id;
      const linha = '<tr class="' + (aberto ? 'selecionado' : '') + '">' +
        '<td class="texto"><span class="cand-linha">' + avatar(e.c.nome, e.c.foto, 40) + '<span><strong>' + esc(e.c.nome) + '</strong>' +
          '<small class="dica"> · ' + esc(e.c.cargo) + (e.c.numero ? ' · nº ' + esc(e.c.numero) : '') + (e.c.partido ? ' · ' + esc(e.c.partido) : '') + '</small></span></span></td>' +
        '<td class="num">' + e.n + '</td><td class="num"><strong>' + fmtInt(e.total) + '</strong></td>' +
        '<td class="la-td-acoes"><button type="button" class="btn btn-mini' + (aberto ? '' : ' btn-primario') + '" data-la="detalhar" data-id="' + e.c.id + '">' + (aberto ? 'Ocultar' : 'Detalhar') + '</button></td></tr>';
      return linha + (aberto ? '<tr class="la-expandido"><td colspan="4">' + renderGrupoCandidato(cd, lista, e.c) + '</td></tr>' : '');
    }).join('') || '<tr><td colspan="4" class="vazio">Nenhuma estimativa para ' + esc(aba.rotulo) + ' em ' + esc(ctx.nomeMun) + ' ainda. Escolha um candidato abaixo para montar o grupo, ou informe os candidatos de 2026 na ficha de cada liderança.</td></tr>';

    return '<section class="painel"><div class="painel-cabecalho"><h2>Estimativa por candidato em ' + esc(ctx.nomeMun) + '</h2>' +
      '<span class="dica">Soma do que as lideranças do município devem dar a cada candidato em 2026. "Detalhar" mostra as lideranças que apoiam o candidato.</span></div>' +
      '<div class="la-barra">' + abas + '</div>' +
      '<div class="tabela-scroll"><table class="la-tabela la-est-tabela"><thead><tr><th>Candidato</th><th class="num">Lideranças</th><th class="num">Estimativa de votos</th><th></th></tr></thead><tbody>' + corpo + '</tbody>' +
      '<tfoot><tr><td>Total · ' + esc(aba.rotulo) + '</td><td class="num">' + linhas.reduce((s, e) => s + e.n, 0) + '</td><td class="num">' + fmtInt(linhas.reduce((s, e) => s + e.total, 0)) + '</td><td></td></tr></tfoot></table></div>' +
      '<div class="la-linha la-add">' + seletor + '</div></section>';
  }

  /** Bloco expandido de um candidato: lideranças que o apoiam no município, totais e inclusão de novas. */
  function renderGrupoCandidato(cd, lista, c) {
    const g = grupo(c.id, cd);
    const disponiveis = lista.filter((l) => !g.itens.some((i) => i.l.id === l.id)).sort((a, b) => (b.votos2024 || 0) - (a.votos2024 || 0));
    const base2024 = g.itens.reduce((s, i) => s + (i.l.votos2024 || 0), 0);
    let html = '<div class="cards la-cards-grupo">' +
      card(fmtInt(g.total), 'Expectativa em ' + ctx.nomeMun) +
      card(fmtInt(base2024), 'Votos das lideranças em 2024') +
      '</div>';
    html += '<div class="tabela-scroll"><table class="la-tabela"><thead><tr><th class="pos">#</th><th>Liderança que apoia ' + esc(c.nome) + '</th><th class="num">Votos 2024</th><th class="num">Estimativa p/ ' + esc(c.nome) + '</th><th></th></tr></thead><tbody>' +
      (g.itens.map((i, idx) => '<tr><td class="pos">' + (idx + 1) + '</td>' +
        '<td class="texto"><span class="cand-linha">' + avatar(i.l.nome, i.l.foto, 30) + '<span><strong>' + esc(i.l.nome) + '</strong>' + (i.l.partido ? '<small class="dica"> · ' + esc(i.l.partido) + '</small>' : '') +
          (bairrosTexto(i.l) ? '<br><small class="dica">' + esc(bairrosTexto(i.l)) + '</small>' : '') + '</span></span></td>' +
        '<td class="num">' + votos24(i.l) + '</td>' +
        '<td class="num"><input type="number" min="0" step="1" class="la-est" value="' + (i.estimativa || '') + '" data-la="estimativa" data-id="' + i.l.id + '" data-chave="' + g.chave + '"></td>' +
        '<td class="la-td-acoes"><button type="button" class="btn btn-mini" data-la="abrir" data-id="' + i.l.id + '" title="Ficha da liderança">Ficha</button> ' +
          '<button type="button" class="btn btn-mini" data-la="remover-grupo" data-id="' + i.l.id + '" data-chave="' + g.chave + '" title="Tirar do grupo">×</button></td></tr>').join('') ||
        '<tr><td colspan="5" class="vazio">Nenhuma liderança no grupo ainda. Adicione abaixo.</td></tr>') +
      '</tbody><tfoot><tr><td colspan="2">Total em ' + esc(ctx.nomeMun) + '</td><td class="num">' + fmtInt(base2024) + '</td><td class="num">' + fmtInt(g.total) + '</td><td></td></tr></tfoot></table></div>' +
      '<form data-la="form-add" data-chave="' + g.chave + '" data-cand="' + c.id + '" class="la-linha la-add">' +
        '<select name="lideranca" required><option value="">— adicionar liderança de ' + esc(ctx.nomeMun) + ' —</option>' +
        disponiveis.map((l) => '<option value="' + l.id + '">' + esc(l.nome) + (l.partido ? ' (' + esc(l.partido) + ')' : '') + (foiCandidato2024(l) ? ' · ' + fmtInt(l.votos2024) + ' votos em 2024' : '') + (expectativa2026(l) ? ' · expectativa ' + fmtInt(expectativa2026(l)) : '') + '</option>').join('') +
        '</select><input name="estimativa" type="number" min="0" step="1" placeholder="estimativa (vazio = expectativa da liderança)"><button type="submit" class="btn btn-primario">Adicionar ao grupo</button>' +
      '</form>';
    return html;
  }

  // ---------- acesso bloqueado / usuários ----------
  function renderBloqueado(usuario) {
    if (!usuario) {
      return '<section class="painel la-bloqueado"><h2>Acesso restrito</h2>' +
        '<p>O mapeamento de lideranças é reservado à equipe. Entre com seu e-mail e senha ou crie sua conta; o acesso é liberado depois que o administrador autorizar.</p>' +
        '<div class="la-form-acoes"><button type="button" class="btn btn-primario" data-la="entrar">Entrar</button><button type="button" class="btn" data-la="criar-conta">Criar conta</button></div></section>';
    }
    return '<section class="painel la-bloqueado"><h2>Cadastro recebido</h2>' +
      '<p>Sua conta <strong>' + esc(usuario.email) + '</strong> está aguardando a autorização do administrador. Quando for liberada, basta recarregar a página.</p>' +
      '<div class="la-form-acoes"><button type="button" class="btn" data-la="recarregar-perfil">Verificar de novo</button><button type="button" class="btn" data-la="sair">Sair</button></div></section>';
  }

  function renderUsuarios() {
    if (ui.perfis === null) {
      ui.perfis = [];
      global.Sync.listarPerfis().then((lista) => { ui.perfis = lista; render(); }).catch((e) => { ui.erroSync = 'Não foi possível listar os usuários: ' + e.message; render(); });
      return '<section class="painel"><div class="vazio">Carregando usuários…</div></section>';
    }
    const fmtData = (d) => (d ? new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');
    const pendentes = ui.perfis.filter((p) => !p.aprovado);
    const linha = (p) => '<tr' + (p.aprovado ? '' : ' class="selecionado"') + '><td class="texto"><strong>' + esc(p.nome || '—') + '</strong><br><small class="dica">' + esc(p.email || '') + '</small></td>' +
      '<td>' + fmtData(p.criado_em) + '</td>' +
      '<td>' + (p.aprovado ? '<span class="selo eleito">Aprovado</span>' + (p.papel === 'admin' ? ' <span class="selo turno">Admin</span>' : '') : '<span class="selo suplente">Aguardando</span>') +
        (p.aprovado && p.aprovado_por ? '<br><small class="dica">por ' + esc(p.aprovado_por) + ' em ' + fmtData(p.aprovado_em) + '</small>' : '') + '</td>' +
      '<td class="la-td-acoes">' + (p.id === (usuarioLogado() || {}).id ? '<span class="dica">você</span>'
        : (p.aprovado ? '<button type="button" class="btn btn-mini" data-la="revogar" data-id="' + p.id + '">Revogar acesso</button>'
          : '<button type="button" class="btn btn-mini btn-primario" data-la="aprovar" data-id="' + p.id + '">Autorizar</button>')) + '</td></tr>';
    return '<section class="painel"><div class="painel-cabecalho"><h2>Usuários</h2><span class="dica">' + ui.perfis.length + ' cadastrados · ' + pendentes.length + ' aguardando autorização</span>' +
      '<button type="button" class="btn btn-mini" data-la="carregar-usuarios" style="margin-left:auto">Atualizar</button></div>' +
      '<div class="tabela-scroll"><table class="la-tabela"><thead><tr><th>Usuário</th><th>Cadastro</th><th>Situação</th><th></th></tr></thead><tbody>' +
      (ui.perfis.map(linha).join('') || '<tr><td colspan="4" class="vazio">Nenhum usuário cadastrado.</td></tr>') + '</tbody></table></div>' +
      '<p class="dica">Quem cria conta no site entra como "Aguardando" e só acessa o mapeamento depois de autorizado aqui. Para dar poderes de administrador a alguém, altere o campo "papel" para "admin" na tabela perfis, no painel do Supabase.</p></section>';
  }

  // ---------- tela Candidatos 2026 ----------
  function renderCandidatos2026() {
    const q = normalizar(ui.busca26);
    const todos = candidatos2026();
    const lista = todos.filter((c) => (!ui.cargo26 || c.cargo === ui.cargo26) && (!q || normalizar(c.nome + ' ' + (c.nomeCompleto || '') + ' ' + c.partido + ' ' + (c.numero || '')).includes(q)))
      .sort((a, b) => CARGOS_2026.indexOf(a.cargo) - CARGOS_2026.indexOf(b.cargo) || (parseInt(a.numero, 10) || 0) - (parseInt(b.numero, 10) || 0) || a.nome.localeCompare(b.nome, 'pt-BR'));
    const contagem = (cargo) => todos.filter((c) => c.cargo === cargo).length;
    const est = (id) => { const g = grupo(id, null); return g.itens.length ? fmtInt(g.total) + ' · ' + g.itens.length + ' lid.' : ''; };
    const manuais = dados.candidatos2026;
    const dups = duplicados();
    let painelManuais = '';
    if (manuais.length) {
      painelManuais = '<section class="painel la-dups"><div class="painel-cabecalho"><h2>Candidatos cadastrados manualmente · ' + manuais.length + '</h2>' +
        '<span class="dica">' + (dups.length ? dups.length + ' com possível duplicidade em relação ao cadastro do TSE.' : 'Nenhum coincide com o cadastro do TSE.') + '</span></div>' +
        '<div class="tabela-scroll"><table class="la-tabela"><thead><tr><th>Manual</th><th>Cargo</th><th>Partido</th><th class="num">Lideranças ligadas</th><th>No cadastro do TSE</th><th></th></tr></thead><tbody>' +
        manuais.map((m) => {
          const d = dups.find((x) => x.manual.id === m.id);
          const g = grupo(m.id, null);
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
    return painelManuais + '<section class="painel"><div class="painel-cabecalho"><h2>Candidatos de 2026</h2><span class="dica">Registro de candidaturas em análise: a situação pode mudar até a eleição.</span></div>' +
      '<div class="la-barra"><div class="segmentado la-abas">' +
        '<button type="button" class="' + (ui.cargo26 === '' ? 'ativo' : '') + '" data-la="cargo26" data-valor="">Todos (' + todos.length + ')</button>' +
        CARGOS_2026.map((c) => '<button type="button" class="' + (ui.cargo26 === c ? 'ativo' : '') + '" data-la="cargo26" data-valor="' + esc(c) + '">' + esc(c) + ' (' + contagem(c) + ')</button>').join('') +
      '</div><input type="search" class="la-busca" placeholder="Buscar por nome, número ou partido" value="' + esc(ui.busca26) + '" data-la="busca26"></div>' +
      '<div class="tabela-scroll"><table class="la-tabela"><thead><tr><th>Candidato</th><th class="num">Número</th><th>Partido</th><th>Cargo</th><th>Ocupação</th><th class="num">Estimativa (grupos)</th></tr></thead><tbody>' +
      (lista.map((c) => '<tr><td class="texto"><span class="cand-linha">' + avatar(c.nome, c.foto, 36) + '<span><strong>' + esc(c.nome) + '</strong>' + (c.origem === 'manual' ? '<span class="selo turno">Manual</span>' : '') +
        (c.nomeCompleto && c.nomeCompleto !== c.nome ? '<br><small class="dica">' + esc(titulo(c.nomeCompleto)) + '</small>' : '') + '</span></span></td>' +
        '<td class="num">' + esc(c.numero || '') + '</td><td>' + esc(c.partido || '') + '</td><td>' + esc(c.cargo) + '</td><td class="texto">' + esc(titulo(c.ocupacao || '')) + '</td>' +
        '<td class="num">' + (est(c.id) ? '<button type="button" class="btn btn-mini" data-la="ver-grupo" data-id="' + c.id + '">' + est(c.id) + '</button>' : '') + '</td></tr>').join('') ||
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
    if (!foiCandidato2024(reg)) reg.nome = nome;
    reg.partido = String(f.get('partido') || '').trim();
    const v26 = parseInt(f.get('votos2026'), 10);
    reg.votos2026 = isNaN(v26) ? null : v26;
    reg.apoio2022_estadual = String(f.get('apoio2022_estadual') || '').trim();
    reg.apoio2022_federal = String(f.get('apoio2022_federal') || '').trim();
    reg.apoio2024_prefeito = String(f.get('apoio2024_prefeito') || '').trim();
    if (reg.origem !== 'vereador2024') reg.apoio2024_vereador = String(f.get('apoio2024_vereador') || '').trim();
    reg.obs = String(f.get('obs') || '').trim();
    if (!foiCandidato2024(reg)) reg.reduto = String(f.get('reduto') || '').trim(); // lideranças manuais: bairros/localidades onde têm força
    reg.apoio2026 = reg.apoio2026 || {};
    const naoEncontrados = [];
    for (const cargo of CARGOS_APOIO) {
      const chave = CHAVE_CARGO[cargo];
      const texto = String(f.get('cand_' + chave) || '').trim();
      const est = parseInt(f.get('est_' + chave), 10);
      if (!texto) { reg.apoio2026[chave] = null; continue; }
      const c = resolverCandidato(texto, cargo);
      if (!c) { naoEncontrados.push(cargo + ': "' + texto + '"'); continue; }
      reg.apoio2026[chave] = { candidato_id: c.id, estimativa: isNaN(est) ? (reg.votos2026 || 0) : est };
    }
    if (naoEncontrados.length) {
      alert('Candidato não encontrado na lista de 2026 (escolha um nome da lista ou cadastre manualmente):\n' + naoEncontrados.join('\n'));
      return;
    }
    if (!l) dados.liderancas.push(reg);
    ui.editando = null; ui.novoCandidato = false; ui.modal = reg.id;
    salvar(); render();
  }

  function criarCandidato(form) {
    const f = new FormData(form);
    const nome = String(f.get('nome') || '').trim();
    if (!nome) return null;
    const c = { id: novoId('c'), nome, cargo: String(f.get('cargo') || CARGOS_APOIO[0]), partido: String(f.get('partido') || '').trim(), criadoEm: agora() };
    dados.candidatos2026.push(c);
    salvar();
    return c;
  }

  function fecharModal() { ui.modal = null; ui.editando = null; ui.novoCandidato = false; render(); }

  function aoClicar(ev) {
    const alvo = ev.target.closest('[data-la]');
    if (!alvo) return;
    const acao = alvo.dataset.la;
    if (acao === 'fechar-modal') { if (alvo.classList.contains('la-modal-fundo') && ev.target !== alvo) return; fecharModal(); }
    else if (acao === 'abrir') { ui.modal = alvo.dataset.id; ui.editando = null; render(); }
    else if (acao === 'ver-votos') {
      const l = porId(alvo.dataset.id);
      if (!l || !ctx.verVotos) return;
      fecharModal();
      ctx.verVotos({ cargo: l.origem === 'prefeito2024' ? 'Prefeito' : 'Vereador', numero: l.numero, cdMun: l.cd_mun });
    }
    else if (acao === 'nova') { ui.modal = 'nova'; ui.editando = 'nova'; render(); const i = ctx.el.querySelector('.la-modal input[name="nome"]'); if (i) i.focus(); }
    else if (acao === 'editar') { ui.modal = alvo.dataset.id; ui.editando = alvo.dataset.id; render(); }
    else if (acao === 'cancelar') { if (ui.modal === 'nova') fecharModal(); else { ui.editando = null; ui.novoCandidato = false; render(); } }
    else if (acao === 'cancelar-cand') { ui.novoCandidato = false; render(); }
    else if (acao === 'excluir') {
      const l = porId(alvo.dataset.id);
      if (l && confirm('Excluir a liderança "' + l.nome + '"?')) { dados.liderancas = dados.liderancas.filter((x) => x.id !== l.id); salvar(); fecharModal(); }
    }
    else if (acao === 'exportar') exportar();
    else if (acao === 'cargo26') { ui.cargo26 = alvo.dataset.valor; render(); }
    else if (acao === 'fechar-aviso') { ui.aviso = ''; render(); }
    else if (acao === 'fechar-erro') { ui.erroSync = ''; render(); }
    else if (acao === 'entrar' || acao === 'criar-conta') { ui.modal = 'login'; ui.abaLogin = acao === 'criar-conta' ? 'cadastrar' : 'entrar'; ui.erroLogin = ''; render(); const i = ctx.el.querySelector('.la-login input'); if (i) i.focus(); }
    else if (acao === 'aba-login') { ui.abaLogin = alvo.dataset.valor; ui.erroLogin = ''; render(); }
    else if (acao === 'recarregar-perfil') { aoMudarSessao(); }
    else if (acao === 'carregar-usuarios') { ui.perfis = null; render(); }
    else if (acao === 'aprovar' || acao === 'revogar') {
      const p = (ui.perfis || []).find((x) => x.id === alvo.dataset.id);
      if (!p) return;
      if (acao === 'revogar' && !confirm('Revogar o acesso de ' + (p.nome || p.email) + '?')) return;
      global.Sync.aprovarPerfil(p.id, acao === 'aprovar').then(() => { ui.perfis = null; render(); }).catch((e) => { ui.erroSync = e.message; render(); });
    }
    else if (acao === 'sair') { global.Sync.sair().then(() => render()); }
    else if (acao === 'definir-senha') { ui.modal = 'senha'; ui.erroLogin = ''; render(); const i = ctx.el.querySelector('.la-login input[name="senha"]'); if (i) i.focus(); }
    else if (acao === 'novo-cand-form') { ui.novoCandidato = CARGOS_APOIO[1]; render(); const i = ctx.el.querySelector('.la-novo-cand input[name="nome"]'); if (i) i.focus(); }
    else if (acao === 'aba-est') { ui.abaEst = alvo.dataset.valor; ui.novoCandidato = false; render(); }
    else if (acao === 'detalhar') { ui.candidato = ui.candidato === alvo.dataset.id ? '' : alvo.dataset.id; render(); }
    else if (acao === 'bairro-mapa') { ui.bairroMapa = ui.bairroMapa === alvo.dataset.valor ? '' : alvo.dataset.valor; render(); }
    else if (acao === 'ver-grupo') { ui.candidato = alvo.dataset.id; if (ctx.irPara) ctx.irPara('estimativa'); else render(); }
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
    else if (acao === 'sel-cand-mapa') { ui.candMapa = alvo.value; ui.bairroMapa = ''; render(); }
    else if (acao === 'sel-grupo') {
      ui.candidato = alvo.value;
      const c = candidato2026(alvo.value);
      if (c) { const aba = ABAS_EST.find((a) => a.cargos.includes(c.cargo)); if (aba) ui.abaEst = aba.id; }
      render();
    }
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
    if (tipo === 'form-cadastro') {
      const f = new FormData(form);
      const s1 = String(f.get('senha') || '');
      const s2 = String(f.get('senha2') || '');
      if (s1 !== s2) { ui.erroLogin = 'As senhas não conferem.'; render(); return; }
      const botao = form.querySelector('button[type="submit"]');
      if (botao) { botao.disabled = true; botao.textContent = 'Criando…'; }
      global.Sync.cadastrar(String(f.get('nome') || '').trim(), String(f.get('email') || '').trim(), s1)
        .then(() => { ui.modal = null; ui.erroLogin = ''; ui.aviso = 'Conta criada. Aguarde a autorização do administrador para acessar o mapeamento.'; return aoMudarSessao(); })
        .catch((e) => { ui.erroLogin = e.message; render(); });
      return;
    }
    if (tipo === 'form-link') {
      const f = new FormData(form);
      const botao = form.querySelector('button[type="submit"]');
      if (botao) { botao.disabled = true; botao.textContent = 'Enviando…'; }
      global.Sync.entrarLink(String(f.get('email') || '').trim())
        .then(() => { ui.avisoLink = 'Link enviado. Abra o e-mail e clique no link para entrar (confira a caixa de spam).'; ui.erroLogin = ''; render(); })
        .catch((e) => { ui.avisoLink = ''; ui.erroLogin = e.message; render(); });
      return;
    }
    if (tipo === 'form-senha') {
      const f = new FormData(form);
      const s1 = String(f.get('senha') || '');
      const s2 = String(f.get('senha2') || '');
      if (s1 !== s2) { ui.erroLogin = 'As senhas não conferem.'; render(); return; }
      global.Sync.definirSenha(s1)
        .then(() => { ui.modal = null; ui.erroLogin = ''; ui.aviso = 'Senha definida. Nas próximas vezes entre com e-mail e senha.'; render(); })
        .catch((e) => { ui.erroLogin = e.message; render(); });
      return;
    }
    if (tipo === 'form-login') {
      const f = new FormData(form);
      const botao = form.querySelector('button[type="submit"]');
      if (botao) { botao.disabled = true; botao.textContent = 'Entrando…'; }
      global.Sync.entrar(String(f.get('email') || '').trim(), String(f.get('senha') || ''))
        .then(() => {
          ui.modal = null; ui.erroLogin = '';
          // a recarga (perfil, lideranças da nuvem e importação pendente) acontece uma única vez em aoMudarSessao,
          // disparada pela troca de usuário — chamar a importação aqui gerava cópias a cada login
          render();
        })
        .catch((e) => { ui.erroLogin = e.message; render(); });
      return;
    }
    if (tipo === 'form') salvarFormulario(form);
    else if (tipo === 'form-cand') {
      const formLid = ctx.el.querySelector('form[data-la="form"]');
      const digitado = formLid ? Object.fromEntries(new FormData(formLid).entries()) : null;
      const c = criarCandidato(form);
      ui.novoCandidato = false;
      if (c && ctx.tela === 'estimativa') ui.candidato = c.id;
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
      const digitada = parseInt(f.get('estimativa'), 10);
      l.apoio2026 = l.apoio2026 || {};
      const atual = apoio(l, form.dataset.chave);
      const destino = candidato2026(form.dataset.cand || ui.candidato);
      if (atual && destino && atual.c.id !== destino.id &&
          !confirm(l.nome + ' já apoia ' + atual.c.nome + ' para ' + atual.c.cargo + '. Uma liderança apoia um candidato por cargo. Mover para ' + destino.nome + '?')) return;
      l.apoio2026[form.dataset.chave] = { candidato_id: form.dataset.cand || ui.candidato, estimativa: isNaN(digitada) ? expectativa2026(l) : digitada };
      salvar(); render();
    }
  }

  function aoTeclar(ev) {
    if (ev.key === 'Escape' && ui.modal) fecharModal();
  }

  let eventosLigados = false;
  function ligarEventos(raiz) {
    if (eventosLigados) return;
    eventosLigados = true;
    raiz.addEventListener('click', aoClicar);
    raiz.addEventListener('change', aoMudar);
    raiz.addEventListener('input', aoDigitar);
    raiz.addEventListener('submit', aoSubmeter);
    document.addEventListener('keydown', aoTeclar);
  }

  /** Ponto de entrada chamado pelo app: contexto = { el, tela, cdMun, nomeMun, municipios, candidatos2026?, fotos2026?, irPara? }. */
  async function mostrar(contexto) {
    const telaAnterior = ctx && ctx.tela;
    const munAnterior = ctx && ctx.cdMun;
    ctx = contexto;
    ligarEventos(ctx.el);
    if (telaAnterior !== ctx.tela || munAnterior !== ctx.cdMun) { ui.modal = null; ui.editando = null; ui.novoCandidato = false; }
    ctx.el.innerHTML = '<section class="painel"><div class="vazio">Carregando…</div></section>';
    if (global.Sync) {
      await global.Sync.iniciar();
      if (!ouvindoUsuario) {
        ouvindoUsuario = true;
        ultimoUsuario = usuarioLogado() ? usuarioLogado().id : null;
        // o Supabase repete o evento de sessão (ex.: ao voltar para a aba); só recarrega quando o usuário muda de fato
        global.Sync.aoMudarUsuario((u) => { const id = u ? u.id : null; if (id === ultimoUsuario) return; ultimoUsuario = id; aoMudarSessao(); });
      }
    }
    if (nuvemAtiva()) perfilAtual = usuarioLogado() ? await global.Sync.perfil() : null;
    atualizarMenuAdmin();
    if (!acessoLiberado()) { if (!dados) dados = vazio(); await carregarTse2026(); render(); return; } // bloqueado: só a tela de entrada/cadastro
    await Promise.all([carregar(), carregarTse2026()]);
    if (!semMunicipio()) {
      try { await carregarMunicipio(ctx.cdMun); } catch (e) { ui.erroSync = 'Não foi possível ler as lideranças de ' + ctx.nomeMun + ': ' + e.message; }
    }
    const unificados = unificarConhecidos();
    if (unificados.length) ui.aviso = 'Unificados com o cadastro do TSE: ' + unificados.join('; ') + '.';
    if (!semMunicipio()) {
      // cópias criadas por importações repetidas são juntadas (e a limpeza gravada, se houver login)
      const repetidas = unificarDuplicados(ctx.cdMun);
      if (repetidas.length) {
        ui.aviso = 'Lideranças repetidas unificadas — ' + repetidas.join('; ') + '.';
        if (!nuvem() || global.Sync.usuario()) salvar();
      }
      await referencias(ctx.cdMun);
      await importarVereadores(ctx.cdMun);
    }
    render();
  }

  /** Recarrega o perfil após entrar/sair e retoma a carga dos dados quando o acesso estiver liberado (uma recarga por vez). */
  let recarregando = Promise.resolve();
  function aoMudarSessao() {
    recarregando = recarregando.then(async () => {
      perfilAtual = usuarioLogado() ? await global.Sync.perfil() : null;
      atualizarMenuAdmin();
      if (acessoLiberado() && ctx) { dados = null; municipiosCarregados.clear(); snapshot.liderancas.clear(); snapshot.candidatos.clear(); snapshot.importados.clear(); await mostrar(ctx); }
      else render();
    }).catch((e) => { ui.erroSync = 'Falha ao recarregar a sessão: ' + e.message; render(); });
    return recarregando;
  }
  let ultimoUsuario = null;

  function atualizarMenuAdmin() {
    const item = document.querySelector('.lateral [data-tela="usuarios"]');
    if (item) item.hidden = !ehAdmin();
  }
  let ouvindoUsuario = false;

  global.Liderancas = { mostrar, exportar };
})(window);
