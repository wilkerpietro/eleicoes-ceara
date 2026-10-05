#!/usr/bin/env node
/* Votação por seção das Eleições 2026 (1º turno) no Ceará, a partir dos boletins de urna que o TSE publica no
   site de resultados (resultados.tse.jus.br, "arquivo-urna"), no mesmo formato das pastas de 2022 e 2024:
     data/2026-1/<município>/votos.csv       zona;secao;cargo;numero;votos   (95 brancos, 96 nulos, 2 dígitos = legenda)
     data/2026-1/<município>/secoes.csv      zona;secao;cod_local;local;endereco;bairro;cep;aptos;agregadas
     data/2026-1/<município>/candidatos.csv  cargo;numero;sq;nome;nome_urna;partido;situacao;genero;ocupacao;foto
     data/2026-1/municipios.json, data/2026-1/todos/ (agregado estadual) e data/2026-1/situacao.json (resumo)

   Caminho dos arquivos (o mesmo usado pelo site do TSE para baixar o boletim de cada seção):
     1. catálogo <host>/<ambiente>/comum/config/ele-c.jws: ciclo (ele2026), pleito e eleições do 1º turno;
     2. seções da UF: <base>/config/ce/ce-p<pleito 6 díg>-cs.json, com municípios, zonas e seções;
     3. por seção: <base>/dados/ce/<mun>/<zona>/<seção>/p<pleito>-ce-m<mun>-z<zona>-s<seção>-aux.json, que lista os
        arquivos da urna (hash e nomes); o boletim é o "-bu.dat" (ASN.1, o arquivo da totalização), lido por
        js/boletim-bu.js; em eleições antigas, o "imgbu" (texto do boletim impresso), lido por js/boletim-texto.js;
     onde <base> = <host>/<ambiente>/<ciclo>/arquivo-urna/<pleito>.
   Nome, partido, foto e ocupação vêm do cadastro data/2026-1/candidatos.csv; a situação (eleito, 2º turno...) do
   resultado da UF no próprio site do TSE, quando disponível. Local, endereço e bairro: lista do TRE-CE nos municípios
   da apuração paralela (data/apuracao.json), arquivo "eleitorado por local de votação" do TSE (--locais) ou, sem
   ele, o local de mesmo número em 2024/2022.

   Uso: node scripts/boletins-2026.js [--municipios=15997,15059] [--locais=pasta_ou_csv] [--amostra=pasta]
        [--salvar-bu=pasta] [--por-segundo=50] [--paralelo=24] [--saida=data/2026-1] [--host=https://resultados.tse.jus.br]
   O TSE limita a 100 requisições por segundo por endereço; o padrão aqui é 50. Precisa de Node 18 ou mais novo. */
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawnSync } = require('child_process');
const BoletimTexto = require('../js/boletim-texto.js');
const BoletimBu = require('../js/boletim-bu.js');

const RAIZ = path.resolve(__dirname, '..');
const args = {};
for (const a of process.argv.slice(2)) { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); if (m) args[m[1]] = m[2] === undefined ? '1' : m[2]; }
const HOST = String(args.host || 'https://resultados.tse.jus.br').replace(/\/+$/, '');
const AMBIENTE = args.ambiente || 'oficial';
const UF = String(args.uf || 'ce').toLowerCase();
const CICLO = args.ciclo || 'ele2026';
const SAIDA = path.resolve(RAIZ, args.saida || 'data/2026-1');
const POR_SEGUNDO = Math.max(1, Math.min(90, Number(args['por-segundo']) || 50));
const PARALELO = Math.max(1, Number(args.paralelo) || 48);
const FILTRO = new Set(String(args.municipios || '').split(/[,\s]+/).filter(Boolean).map((c) => c.padStart(5, '0')));
const AMOSTRA = args.amostra ? path.resolve(RAIZ, args.amostra) : null;
const LOCAIS = args.locais ? path.resolve(RAIZ, args.locais) : null;
const SALVAR_BU = args['salvar-bu'] ? path.resolve(RAIZ, args['salvar-bu']) : null;
const NOME_CARGO = BoletimTexto.NOME_CARGO;
const CARGOS_PROP = new Set([6, 7, 8, 13]);

const pad = (v, n) => String(v).padStart(n, '0');
const dormir = (ms) => new Promise((ok) => setTimeout(ok, ms));
const log = (...a) => { const linha = a.join(' '); console.log(linha); if (AMOSTRA) fs.appendFileSync(path.join(AMOSTRA, 'log.txt'), linha + '\n'); };

// ---------- HTTP com limite de requisições por segundo e novas tentativas ----------
let proximaVez = 0;
const contagem = { req: 0, status: {} };
async function vez() {
  const agora = Date.now();
  const t = Math.max(agora, proximaVez);
  proximaVez = t + 1000 / POR_SEGUNDO;
  if (t > agora) await dormir(t - agora);
}

/** Baixa um arquivo. Devolve Buffer, ou null se o TSE responder 404/403 (ainda não publicado). */
async function baixar(url) {
  let ultimo = '';
  for (let tentativa = 1; tentativa <= 6; tentativa++) {
    await vez();
    contagem.req++;
    let resp = null;
    try {
      resp = await fetch(url, { signal: AbortSignal.timeout(45000), headers: { 'user-agent': 'eleicoes-ceara/1.0 (+https://github.com/wilkerpietro/eleicoes-ceara)' } });
    } catch (e) { ultimo = e.message; }
    if (resp) {
      contagem.status[resp.status] = (contagem.status[resp.status] || 0) + 1;
      if (resp.ok) return Buffer.from(await resp.arrayBuffer());
      if (resp.status === 404 || resp.status === 403) return null;
      ultimo = 'HTTP ' + resp.status;
      if (resp.status !== 429 && resp.status < 500) break;
    }
    await dormir(Math.min(30000, 1000 * 2 ** tentativa));
  }
  throw new Error(url + ': ' + ultimo);
}

/** JSON puro ou JWS (cabeçalho.conteúdo.assinatura em base64url). */
function lerJson(buf) {
  const t = buf.toString('utf8').trim();
  if (t.startsWith('{') || t.startsWith('[')) return JSON.parse(t);
  const p = t.split('.');
  if (p.length === 3) return JSON.parse(Buffer.from(p[1], 'base64url').toString('utf8'));
  throw new Error('formato inesperado (nem JSON nem JWS)');
}

async function baixarJson(urls) {
  for (const url of urls) {
    const b = await baixar(url);
    if (b) return { url, dados: lerJson(b), bruto: b };
  }
  return null;
}

function guardarAmostra(nome, conteudo) {
  if (!AMOSTRA) return;
  fs.mkdirSync(path.dirname(path.join(AMOSTRA, nome)), { recursive: true });
  fs.writeFileSync(path.join(AMOSTRA, nome), conteudo);
}

// ---------- catálogo e lista de seções ----------
async function catalogo() {
  const r = await baixarJson([HOST + '/' + AMBIENTE + '/comum/config/ele-c.jws', HOST + '/' + AMBIENTE + '/comum/config/ele-c.json']);
  if (!r) throw new Error('catálogo do TSE indisponível (ele-c): ' + JSON.stringify(contagem.status));
  guardarAmostra('ele-c.json', JSON.stringify(r.dados, null, 1));
  const pleitos = Array.isArray(r.dados.pl) ? r.dados.pl : [];
  for (const p of pleitos) log('  pleito', p.cd, 'ciclo', p.c || '-', (p.e || []).map((e) => e.cd + ' tp' + e.tp + ' t' + e.t + ' ' + (e.nm || '')).join(' | '));
  const temCargo = (e, cd) => (e.abr || []).some((a) => (a.cp || []).some((c) => Number(c.cd) === cd));
  const ordenados = pleitos.filter((p) => !p.c || p.c === CICLO).concat(pleitos.filter((p) => p.c && p.c !== CICLO));
  for (const p of ordenados) {
    const eleicoes = Array.isArray(p.e) ? p.e : [];
    const estadual = eleicoes.find((e) => Number(e.t) === 1 && temCargo(e, 3)) || eleicoes.find((e) => Number(e.tp) === 1 && Number(e.t) === 1);
    const federal = eleicoes.find((e) => Number(e.t) === 1 && temCargo(e, 1)) || eleicoes.find((e) => Number(e.tp) === 8 && Number(e.t) === 1);
    if (estadual) {
      const arq = Array.isArray(r.dados.arq) ? r.dados.arq : [];
      return {
        ciclo: p.c || r.dados.c || CICLO, pleito: String(p.cd), estadual: String(estadual.cd), federal: federal ? String(federal.cd) : null,
        dir: (arq.find((a) => a && a.tp === 'u') || {}).dir || '<base>/<ambiente>/<ciclo>/<cd_eleicao>/dados/<uf>',
      };
    }
  }
  throw new Error('o catálogo do TSE não tem as eleições gerais de 1º turno');
}

/** Municípios, zonas e seções da UF: [{ cd, nome, secoes: [{ zona, secao, principal }] }]. */
async function secoesDaUf(base, pleito) {
  const nome = UF + '-p' + pad(pleito, 6) + '-cs';
  const r = await baixarJson([base + '/config/' + UF + '/' + nome + '.json', base + '/config/' + UF + '/' + nome + '.jws']);
  if (!r) throw new Error('lista de seções do arquivo-urna ainda não publicada (' + nome + ')');
  guardarAmostra(nome + '.json', r.bruto);
  const abr = (r.dados.abr || []).find((a) => String(a.cd).toLowerCase() === UF) || (r.dados.abr || [])[0];
  if (!abr || !Array.isArray(abr.mu)) throw new Error('lista de seções em formato inesperado: ' + Object.keys(r.dados).join(','));
  const m0 = abr.mu[0] || {};
  log('  formato: município', JSON.stringify(Object.keys(m0)), 'zona', JSON.stringify(Object.keys((m0.zon || [])[0] || {})), 'seção', JSON.stringify(((m0.zon || [])[0] || {}).sec ? m0.zon[0].sec[0] : null));
  return abr.mu.map((mu) => ({
    cd: pad(mu.cd, 5),
    nome: String(mu.nm || mu.nome || mu.cd).trim(),
    secoes: (mu.zon || []).flatMap((z) => (z.sec || []).map((s) => {
      const ns = pad(s.ns != null ? s.ns : s.cd, 4);
      const nsp = s.nsp != null ? pad(s.nsp, 4) : ns;
      return { zona: pad(z.cd, 4), secao: ns, principal: nsp };
    })),
  }));
}

// ---------- boletim de cada seção ----------
/** Arquivo do boletim na lista da seção: o binário do BU ("-bu.dat", tipo "bu"; desde 2024) ou, antes, o imgbu (texto). */
function escolherArquivo(aux) {
  const ordem = (h) => (/totaliz/i.test(h.st || '') ? 0 : /receb|apurad/i.test(h.st || '') ? 1 : /exclu|substitu|cancel/i.test(h.st || '') ? 9 : 2);
  const hashes = (aux.hashes || []).filter((h) => h && h.hash && String(h.hash) !== '0').sort((a, b) => ordem(a) - ordem(b));
  for (const h of hashes) {
    const arqs = (h.arq || h.nmarq || []).map((a) => (typeof a === 'string' ? { nm: a, tp: '' } : { nm: a && (a.nm || a.nome), tp: (a && a.tp) || '' })).filter((a) => a.nm);
    const bu = arqs.find((a) => a.tp === 'bu') || arqs.find((a) => /(-bu\.dat|\.bu)$/i.test(a.nm)) || arqs.find((a) => a.tp === 'busa') || arqs.find((a) => /(-busa\.dat|\.busa)$/i.test(a.nm));
    if (bu) return { hash: String(h.hash), nm: bu.nm, tipo: 'bu', st: h.st || '' };
    const img = arqs.find((a) => /\.imgbu$/i.test(a.nm)) || arqs.find((a) => /\.imgbusa$/i.test(a.nm)) || arqs.find((a) => /imgbu/i.test(a.nm));
    if (img) return { hash: String(h.hash), nm: img.nm, tipo: 'texto', st: h.st || '' };
  }
  return null;
}

/** Texto do boletim dentro do imgbu (ASN.1 com o relatório impresso; em latin-1 ou UTF-8) ou de um PDF. */
function textoDoImgbu(buf) {
  if (buf.slice(0, 5).toString('latin1') === '%PDF-') {
    const tmp = path.join(require('os').tmpdir(), 'bu-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.pdf');
    fs.writeFileSync(tmp, buf);
    const r = spawnSync('pdftotext', ['-layout', tmp, '-'], { encoding: 'utf8' });
    fs.unlinkSync(tmp);
    if (r.status !== 0) throw new Error('o imgbu veio em PDF e o pdftotext não está instalado');
    return r.stdout;
  }
  const utf = buf.includes(Buffer.from('Justiça', 'utf8'));
  const s = buf.toString(utf ? 'utf8' : 'latin1');
  const i = s.indexOf('Justi');
  return (i >= 0 ? s.slice(i) : s).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '\n');
}

let formatoAux = null; // '.json' ou '.jws', descoberto na primeira seção
let amostrasFalha = 0;
async function lerSecao(base, pleito, cd, s) {
  const dir = base + '/dados/' + UF + '/' + cd + '/' + s.zona + '/' + s.secao + '/';
  const nome = 'p' + pad(pleito, 6) + '-' + UF + '-m' + cd + '-z' + s.zona + '-s' + s.secao + '-aux';
  let aux = null;
  for (const ext of formatoAux ? [formatoAux] : ['.json', '.jws']) {
    const b = await baixar(dir + nome + ext);
    if (b) { aux = lerJson(b); if (!formatoAux) { formatoAux = ext; guardarAmostra('aux-exemplo' + ext, b); } break; }
  }
  if (!aux) return { falta: 'sem arquivo da seção (aux)' };
  const arq = escolherArquivo(aux);
  if (!arq) return { falta: 'sem boletim publicado (' + ((aux.hashes || []).map((h) => h.st).filter(Boolean).join(', ') || aux.st || 'sem urna') + ')' };
  const buf = await baixar(dir + arq.hash + '/' + arq.nm);
  if (!buf) return { falta: 'boletim listado mas não encontrado (' + arq.nm + ')' };
  if (!guardarAmostra.primeiro) { guardarAmostra.primeiro = true; guardarAmostra('boletim-exemplo-' + arq.nm, buf); }
  if (SALVAR_BU) { fs.mkdirSync(path.join(SALVAR_BU, cd), { recursive: true }); fs.writeFileSync(path.join(SALVAR_BU, cd, arq.nm), buf); }
  try {
    const lido = arq.tipo === 'bu' ? BoletimBu.ler(buf) : BoletimTexto.ler(textoDoImgbu(buf));
    if (parseInt(lido.cab.MUNI, 10) !== parseInt(cd, 10) || parseInt(lido.cab.SECA, 10) !== parseInt(s.secao, 10)) throw new Error('boletim de outra seção (' + lido.cab.MUNI + '/' + lido.cab.SECA + ')');
    if (lido.cab.FASE !== 'O') throw new Error('boletim não oficial (fase ' + lido.cab.FASE + ')');
    return { lido, arquivo: arq.nm };
  } catch (e) {
    if (amostrasFalha++ < 10) guardarAmostra('falhas/' + arq.nm, buf);
    return { erro: e.message + ' (' + arq.nm + ')' };
  }
}

// ---------- locais de votação ----------
function lerCsvSimples(arquivo) {
  if (!fs.existsSync(arquivo)) return [];
  const linhas = fs.readFileSync(arquivo, 'utf8').split(/\r?\n/).filter(Boolean);
  const cab = linhas.shift().split(';');
  return linhas.map((l) => { const v = l.split(';'); const o = {}; cab.forEach((c, i) => { o[c] = v[i] || ''; }); return o; });
}

/** "Eleitorado por local de votação" do TSE (CSV latin-1, ";", entre aspas): cd|zona|seção -> local. */
async function lerLocaisTse(caminho) {
  const mapa = new Map();
  if (!caminho || !fs.existsSync(caminho)) return mapa;
  const arquivos = fs.statSync(caminho).isDirectory()
    ? fs.readdirSync(caminho).filter((f) => /\.csv$/i.test(f)).map((f) => path.join(caminho, f)) : [caminho];
  for (const arquivo of arquivos) {
    const rl = readline.createInterface({ input: fs.createReadStream(arquivo, { encoding: 'latin1' }), crlfDelay: Infinity });
    let idx = null;
    for await (const linha of rl) {
      const v = linha.split(';').map((x) => x.replace(/^"|"$/g, '').trim());
      if (!idx) {
        const c = (...nomes) => { for (const n of nomes) { const i = v.indexOf(n); if (i >= 0) return i; } return -1; };
        idx = { uf: c('SG_UF'), mun: c('CD_MUNICIPIO'), zona: c('NR_ZONA'), secao: c('NR_SECAO'), local: c('NR_LOCAL_VOTACAO'), nome: c('NM_LOCAL_VOTACAO'),
          end: c('DS_ENDERECO', 'DS_LOCAL_VOTACAO_ENDERECO', 'DS_ENDERECO_LOCAL_VOTACAO'), bairro: c('NM_BAIRRO'), cep: c('NR_CEP') };
        if (idx.mun < 0 || idx.secao < 0) { log('  locais: cabeçalho não reconhecido em', path.basename(arquivo)); break; }
        continue;
      }
      if (idx.uf >= 0 && v[idx.uf] && v[idx.uf].toLowerCase() !== UF) continue;
      const k = pad(v[idx.mun], 5) + '|' + (+v[idx.zona]) + '|' + (+v[idx.secao]);
      if (!mapa.has(k)) mapa.set(k, { cod_local: v[idx.local] || '', local: v[idx.nome] || '', endereco: idx.end >= 0 ? v[idx.end] : '', bairro: idx.bairro >= 0 ? v[idx.bairro] : '', cep: idx.cep >= 0 ? v[idx.cep] : '' });
    }
  }
  log('  locais de votação do TSE:', mapa.size, 'seções');
  return mapa;
}

/** Local de mesmo número nas listas de 2024/2022 (zona|cod_local -> local), para quando não há lista de 2026. */
function locaisAnteriores(cd) {
  const porSecao = new Map();
  const porLocal = new Map();
  for (const ano of ['2024-1', '2022-1']) {
    for (const s of lerCsvSimples(path.join(RAIZ, 'data', ano, cd, 'secoes.csv'))) {
      const info = { cod_local: s.cod_local, local: s.local, endereco: s.endereco, bairro: s.bairro, cep: s.cep };
      const ks = (+s.zona) + '|' + (+s.secao);
      if (!porSecao.has(ks)) porSecao.set(ks, info);
      const kl = (+s.zona) + '|' + (+s.cod_local);
      if (s.cod_local && !porLocal.has(kl)) porLocal.set(kl, info);
    }
  }
  return { porSecao, porLocal };
}

// ---------- situação dos candidatos (eleito, 2º turno...) e votos oficiais da UF, para conferência ----------
const oficiais = new Map(); // cargo|numero -> votos apurados no resultado oficial
async function situacoes(cat) {
  const mapa = new Map();
  const dirDe = (ele, uf) => cat.dir.replace('<base>', HOST).replace('<ambiente>', AMBIENTE).replace('<ciclo>', cat.ciclo).replace('<cd_eleicao>', ele).replace('<uf>', uf).replace(/([^:])\/{2,}/g, '$1/');
  const pedidos = [[3, cat.estadual, UF], [5, cat.estadual, UF], [6, cat.estadual, UF], [7, cat.estadual, UF]];
  if (cat.federal) pedidos.push([1, cat.federal, 'br']);
  for (const [cargo, ele, uf] of pedidos) {
    const nome = uf + '-c' + pad(cargo, 4) + '-e' + pad(ele, 6) + '-u';
    let r = null;
    try { r = await baixarJson([dirDe(ele, uf) + '/' + nome + '.jws', dirDe(ele, uf) + '/' + nome + '.json']); } catch (e) { log('  situação', NOME_CARGO[cargo] + ':', e.message); }
    if (!r) { log('  situação', NOME_CARGO[cargo] + ': resultado da UF não encontrado (' + nome + ')'); continue; }
    let n = 0;
    for (const carg of r.dados.carg || []) for (const agr of carg.agr || []) for (const par of agr.par || []) for (const c of par.cand || []) {
      if (c.n == null) continue;
      if (c.vap != null && c.vap !== '') oficiais.set(cargo + '|' + c.n, Number(c.vap));
      if (c.st) { mapa.set(cargo + '|' + c.n, String(c.st).toUpperCase()); n++; }
    }
    log('  situação', NOME_CARGO[cargo] + ':', n, 'candidatos');
    if (!n) { const c0 = (((((r.dados.carg || [])[0] || {}).agr || [])[0] || {}).par || [])[0]; log('    (formato: ' + JSON.stringify(c0 && c0.cand ? c0.cand[0] : Object.keys(r.dados)).slice(0, 300) + ')'); }
  }
  return mapa;
}

// ---------- gravação ----------
function gravar(arquivo, linhas) {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  fs.writeFileSync(arquivo, linhas.join('\n') + '\n');
}
const limpo = (v) => String(v == null ? '' : v).replace(/[;\r\n]+/g, ' ').trim();
const semZeros = (lista) => String(lista || '').split(/[^0-9]+/).filter(Boolean).map((n) => String(+n)).join(',');

async function main() {
  const inicio = Date.now();
  if (AMOSTRA) { fs.mkdirSync(AMOSTRA, { recursive: true }); fs.writeFileSync(path.join(AMOSTRA, 'log.txt'), ''); }
  log('Boletins de urna 2026 (' + UF.toUpperCase() + ') — ' + HOST + '/' + AMBIENTE + ', até ' + POR_SEGUNDO + ' req/s');
  const cat = await catalogo();
  log('Catálogo: ciclo', cat.ciclo, 'pleito', cat.pleito, 'eleição estadual', cat.estadual, 'federal', cat.federal || '-');
  const base = HOST + '/' + AMBIENTE + '/' + cat.ciclo + '/arquivo-urna/' + cat.pleito;
  let municipios = await secoesDaUf(base, cat.pleito);
  log('Seções da UF:', municipios.length, 'municípios,', municipios.reduce((t, m) => t + m.secoes.length, 0), 'seções');
  if (FILTRO.size) municipios = municipios.filter((m) => FILTRO.has(m.cd));

  // cadastro dos candidatos e listas auxiliares
  const cadastro = new Map(lerCsvSimples(path.join(SAIDA, 'candidatos.csv')).map((c) => [c.cargo + '|' + c.numero, c]));
  const partidos = (JSON.parse(fs.readFileSync(path.join(RAIZ, 'data/partidos.json'), 'utf8'))['2026']) || {};
  const apuracao = new Set(((JSON.parse(fs.readFileSync(path.join(RAIZ, 'data/apuracao.json'), 'utf8')).municipios) || []).map((m) => pad(m.cd, 5)));
  const locaisTse = await lerLocaisTse(LOCAIS);
  const situacao = await situacoes(cat);

  // fila de seções (as agregadas votam na principal e não têm boletim próprio)
  const fila = [];
  const agregadas = new Map(); // cd|zona|principal -> [seções agregadas]
  for (const m of municipios) {
    for (const s of m.secoes) {
      if (s.principal !== s.secao) { const k = m.cd + '|' + s.zona + '|' + s.principal; (agregadas.get(k) || agregadas.set(k, []).get(k)).push(String(+s.secao)); continue; }
      fila.push({ m, s });
    }
  }
  log('Baixando', fila.length, 'boletins (' + PARALELO + ' em paralelo)...');
  const resultados = new Map(); // cd -> [{ s, lido }]
  const faltando = [];
  const falhas = [];
  let feitos = 0;
  let i = 0;
  async function trabalhador() {
    while (i < fila.length) {
      const { m, s } = fila[i++];
      let r;
      try { r = await lerSecao(base, cat.pleito, m.cd, s); } catch (e) { r = { erro: e.message }; }
      if (r.lido) (resultados.get(m.cd) || resultados.set(m.cd, []).get(m.cd)).push({ s, lido: r.lido });
      else if (r.falta) faltando.push({ cd: m.cd, municipio: m.nome, zona: +s.zona, secao: +s.secao, motivo: r.falta });
      else falhas.push({ cd: m.cd, municipio: m.nome, zona: +s.zona, secao: +s.secao, erro: r.erro });
      // formato inesperado: se as 150 primeiras seções não deram nenhum boletim lido, para logo (o log e as amostras dizem por quê)
      if (++feitos === 150 && !resultados.size && falhas.length + faltando.length >= 150) {
        for (const f of falhas.slice(0, 5)) log('  erro: ' + f.municipio + ' zona ' + f.zona + ' seção ' + f.secao + ': ' + f.erro);
        for (const f of faltando.slice(0, 5)) log('  sem boletim: ' + f.municipio + ' zona ' + f.zona + ' seção ' + f.secao + ': ' + f.motivo);
        throw new Error('nenhum boletim lido nas 150 primeiras seções; parando');
      }
      if (feitos % 500 === 0 || feitos === fila.length) {
        log('  ' + feitos + '/' + fila.length + ' seções · lidas ' + (feitos - faltando.length - falhas.length) + ' · sem boletim ' + faltando.length + ' · com erro ' + falhas.length + ' · ' + Math.round((Date.now() - inicio) / 1000) + ' s · HTTP ' + JSON.stringify(contagem.status));
      }
    }
  }
  await Promise.all(Array.from({ length: PARALELO }, trabalhador));

  // pastas por município
  const geral = new Map(); // votos somados por município (agregado estadual)
  const listaMun = [];
  const candidatosTodos = new Map();
  for (const m of municipios) {
    const lidos = (resultados.get(m.cd) || []).sort((a, b) => (+a.s.zona - +b.s.zona) || (+a.s.secao - +b.s.secao));
    if (!lidos.length) continue;
    listaMun.push({ cd: m.cd, nome: m.nome.toUpperCase() });
    const pasta = path.join(SAIDA, m.cd);
    const votos = ['zona;secao;cargo;numero;votos'];
    const soma = new Map();
    const usados = new Map(); // cargo|numero -> nome lido no boletim
    for (const { s, lido } of lidos) {
      const z = +s.zona;
      const sec = +s.secao;
      for (const c of lido.cargos) {
        const linhas = [];
        for (const [num, v] of Object.entries(c.votos)) if (v > 0) { linhas.push([num, v]); if (!usados.has(c.cargo + '|' + num)) usados.set(c.cargo + '|' + num, c.nomes[num] || ''); }
        if (CARGOS_PROP.has(c.cargo)) for (const [p, d] of Object.entries(c.partidos)) if (d.LEGP > 0) linhas.push([p, d.LEGP]);
        if (c.BRAN > 0) linhas.push(['95', c.BRAN]);
        if (c.NULO > 0) linhas.push(['96', c.NULO]);
        linhas.sort((a, b) => +a[0] - +b[0]);
        for (const [num, v] of linhas) {
          votos.push(z + ';' + sec + ';' + c.cargo + ';' + num + ';' + v);
          const k = c.cargo + ';' + num;
          soma.set(k, (soma.get(k) || 0) + v);
        }
      }
    }
    gravar(path.join(pasta, 'votos.csv'), votos);

    // seções: lista do TRE (municípios da apuração paralela) > eleitorado por local do TSE > mesmo local em 2024/2022
    const tre = apuracao.has(m.cd) ? lerCsvSimples(path.join(pasta, 'secoes.csv')) : [];
    const linhasSec = new Map();
    for (const s of tre) linhasSec.set((+s.zona) + '|' + (+s.secao), [s.zona, s.secao, s.cod_local, s.local, s.endereco, s.bairro, s.cep, s.aptos, s.agregadas].map(limpo).join(';'));
    const ant = tre.length ? null : locaisAnteriores(m.cd);
    let aptosMun = tre.reduce((t, s) => t + (+s.aptos || 0), 0);
    for (const { s, lido } of lidos) {
      const k = (+s.zona) + '|' + (+s.secao);
      if (linhasSec.has(k)) continue;
      const loca = String(+lido.cab.LOCA || '');
      const info = locaisTse.get(m.cd + '|' + k) ||
        (ant && ((ant.porSecao.get(k) && String(+ant.porSecao.get(k).cod_local) === loca && ant.porSecao.get(k)) || ant.porLocal.get((+s.zona) + '|' + loca))) ||
        { cod_local: loca, local: 'LOCAL ' + loca, endereco: '', bairro: '', cep: '' };
      const agr = semZeros(lido.cab.AGRE) || (agregadas.get(m.cd + '|' + s.zona + '|' + s.secao) || []).join(',');
      linhasSec.set(k, [+s.zona, +s.secao, loca || info.cod_local, info.local, info.endereco, info.bairro, info.cep, +lido.cab.APTO || '', agr].map(limpo).join(';'));
      aptosMun += +lido.cab.APTO || 0;
    }
    const ordenadas = Array.from(linhasSec.values()).sort((a, b) => { const x = a.split(';'); const y = b.split(';'); return (+x[0] - +y[0]) || (+x[1] - +y[1]); });
    gravar(path.join(pasta, 'secoes.csv'), ['zona;secao;cod_local;local;endereco;bairro;cep;aptos;agregadas'].concat(ordenadas));

    // candidatos com voto no município
    const cands = ['cargo;numero;sq;nome;nome_urna;partido;situacao;genero;ocupacao;foto'];
    const chaves = Array.from(usados.keys()).filter((k) => { const [cg, num] = k.split('|'); return CARGOS_PROP.has(+cg) ? num.length > 2 : num !== '95' && num !== '96'; })
      .sort((a, b) => { const [ca, na] = a.split('|'); const [cb, nb] = b.split('|'); return NOME_CARGO[ca].localeCompare(NOME_CARGO[cb]) || (+na - +nb); });
    for (const k of chaves) {
      const [cg, num] = k.split('|');
      const nomeCargo = NOME_CARGO[cg];
      const cad = cadastro.get(nomeCargo + '|' + num);
      const sit = situacao.get(cg + '|' + num) || (cad && cad.situacao) || '';
      const linha = cad
        ? [nomeCargo, num, cad.sq, cad.nome, cad.nome_urna, cad.partido, sit, cad.genero, cad.ocupacao, cad.foto]
        : [nomeCargo, num, '', usados.get(k), usados.get(k), partidos[num.slice(0, 2)] || '', sit, '', '', ''];
      const texto = linha.map(limpo).join(';');
      cands.push(texto);
      candidatosTodos.set(k, texto);
    }
    gravar(path.join(pasta, 'candidatos.csv'), cands);
    geral.set(m.cd, { nome: m.nome.toUpperCase(), soma, aptos: aptosMun });
  }

  // agregado estadual: cada município vira uma "seção" (como scripts/agregar-estado.sh)
  const todosVotos = ['zona;secao;cargo;numero;votos'];
  const todosSec = ['zona;secao;cod_local;local;endereco;bairro;cep;aptos;agregadas'];
  for (const [cd, g] of Array.from(geral.entries()).sort((a, b) => a[1].nome.localeCompare(b[1].nome, 'pt-BR'))) {
    for (const [k, v] of Array.from(g.soma.entries()).sort()) todosVotos.push('0;' + cd + ';' + k + ';' + v);
    todosSec.push('0;' + cd + ';' + cd + ';' + limpo(g.nome) + ';;' + limpo(g.nome) + ';;' + g.aptos + ';');
  }
  if (!FILTRO.size) {
    gravar(path.join(SAIDA, 'todos', 'votos.csv'), todosVotos);
    gravar(path.join(SAIDA, 'todos', 'secoes.csv'), todosSec);
    const cands = Array.from(candidatosTodos.values()).sort((a, b) => { const x = a.split(';'); const y = b.split(';'); return x[0].localeCompare(y[0]) || (+x[1] - +y[1]); });
    gravar(path.join(SAIDA, 'todos', 'candidatos.csv'), ['cargo;numero;sq;nome;nome_urna;partido;situacao;genero;ocupacao;foto'].concat(cands));
    fs.writeFileSync(path.join(SAIDA, 'municipios.json'), JSON.stringify(listaMun) + '\n');
  } else {
    // só alguns municípios: acrescenta-os à lista existente; o agregado estadual (todos/) fica como estava
    let lista = [];
    try { lista = JSON.parse(fs.readFileSync(path.join(SAIDA, 'municipios.json'), 'utf8')); } catch (e) { /* ainda não existe */ }
    for (const m of listaMun) { const i = lista.findIndex((x) => x.cd === m.cd); if (i >= 0) lista[i] = m; else lista.push(m); }
    fs.writeFileSync(path.join(SAIDA, 'municipios.json'), JSON.stringify(lista) + '\n');
    log('Filtro de municípios: municipios.json atualizado; o agregado estadual (todos/) não foi alterado.');
  }

  // conferência: soma dos boletins no estado x votos do resultado oficial da UF (só com todos os municípios)
  let conferencia = null;
  if (!FILTRO.size && oficiais.size) {
    const somaUf = new Map();
    for (const g of geral.values()) for (const [k, v] of g.soma) { const [cg, num] = k.split(';'); const kk = cg + '|' + num; somaUf.set(kk, (somaUf.get(kk) || 0) + v); }
    conferencia = { iguais: 0, diferentes: [] };
    for (const [k, oficial] of oficiais) {
      const [cg] = k.split('|');
      if (cg === '1') continue; // Presidente: o arquivo da UF "br" é nacional
      const nosBoletins = somaUf.get(k) || 0;
      if (nosBoletins === oficial) conferencia.iguais++; else conferencia.diferentes.push({ cargo: NOME_CARGO[cg], numero: k.split('|')[1], boletins: nosBoletins, oficial });
    }
    log('Conferência com o resultado oficial do TSE (votos por candidato no estado): ' + conferencia.iguais + ' iguais, ' + conferencia.diferentes.length + ' diferentes.');
    for (const d of conferencia.diferentes.slice(0, 15)) log('  diferente: ' + d.cargo + ' ' + d.numero + ': boletins ' + d.boletins + ', oficial ' + d.oficial);
  }

  const resumo = {
    gerado_em: new Date().toISOString(), fonte: base, pleito: cat.pleito, eleicao_estadual: cat.estadual, eleicao_federal: cat.federal,
    municipios: listaMun.length, secoes_com_boletim: fila.length, secoes_lidas: fila.length - faltando.length - falhas.length,
    conferencia_oficial: conferencia, sem_boletim: faltando, com_erro: falhas, requisicoes: contagem.req, http: contagem.status,
  };
  if (!FILTRO.size) fs.writeFileSync(path.join(SAIDA, 'situacao.json'), JSON.stringify(resumo, null, 1) + '\n');
  guardarAmostra('resumo.json', JSON.stringify(resumo, null, 1));
  log('Concluído em ' + Math.round((Date.now() - inicio) / 1000) + ' s: ' + resumo.secoes_lidas + ' de ' + fila.length + ' boletins lidos em ' + listaMun.length + ' municípios; sem boletim ' + faltando.length + '; com erro ' + falhas.length + '.');
  for (const f of falhas.slice(0, 20)) log('  erro: ' + f.municipio + ' zona ' + f.zona + ' seção ' + f.secao + ': ' + f.erro);
  for (const f of faltando.slice(0, 20)) log('  sem boletim: ' + f.municipio + ' zona ' + f.zona + ' seção ' + f.secao + ': ' + f.motivo);
  if (!resumo.secoes_lidas) process.exitCode = 1;
}

main().catch((e) => { log('ERRO: ' + e.message); process.exit(1); });
