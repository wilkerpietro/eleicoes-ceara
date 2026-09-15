/* Sincronização do mapeamento de lideranças com um banco na nuvem (Supabase).
   Só entra em ação quando data/config.json traz "supabase": { "url", "anonKey" }; sem isso,
   o módulo de lideranças continua salvando no navegador (localStorage).
   Leitura é pública; gravação exige usuário autenticado (e-mail e senha criados no painel do Supabase).
   Tabelas esperadas: ver scripts/supabase.sql. */
(function (global) {
  'use strict';

  const ARQUIVO_CONFIG = 'data/config.json';
  let cliente = null;
  let config = null;
  let iniciado = null;
  let usuarioAtual = null;
  const ouvintes = [];

  async function iniciar() {
    if (iniciado) return iniciado;
    iniciado = (async () => {
      try {
        const resp = await fetch(ARQUIVO_CONFIG, { cache: 'no-cache' });
        config = resp.ok ? await resp.json() : {};
      } catch (e) { config = {}; }
      const s = config && config.supabase;
      if (s && s.url && s.anonKey && global.supabase && global.supabase.createClient) {
        cliente = global.supabase.createClient(s.url, s.anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
        const { data } = await cliente.auth.getSession();
        usuarioAtual = data && data.session ? data.session.user : null;
        cliente.auth.onAuthStateChange((evento, sessao) => {
          usuarioAtual = sessao ? sessao.user : null;
          ouvintes.forEach((f) => { try { f(usuarioAtual); } catch (e) { /* ignora */ } });
        });
      }
      return !!cliente;
    })();
    return iniciado;
  }

  const configurado = () => !!cliente;
  const usuario = () => usuarioAtual;
  const aoMudarUsuario = (f) => ouvintes.push(f);

  async function entrar(email, senha) {
    const { data, error } = await cliente.auth.signInWithPassword({ email, password: senha });
    if (error) throw new Error(traduzir(error.message));
    usuarioAtual = data.user;
    return data.user;
  }

  async function sair() {
    await cliente.auth.signOut();
    usuarioAtual = null;
  }

  /** Cria a conta (e-mail e senha). O acesso só é liberado quando um administrador aprova o perfil. */
  async function cadastrar(nome, email, senha) {
    const { data, error } = await cliente.auth.signUp({ email, password: senha, options: { data: { nome } } });
    if (error) throw new Error(traduzir(error.message));
    if (data && data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) throw new Error('Este e-mail já está cadastrado. Use "Entrar".');
    usuarioAtual = data.user || usuarioAtual;
    return data;
  }

  /** Perfil do usuário conectado: { id, email, nome, aprovado, papel } ou null. */
  async function perfil() {
    if (!usuarioAtual) return null;
    const { data, error } = await cliente.from('perfis').select('*').eq('id', usuarioAtual.id).maybeSingle();
    if (error) { console.warn('perfil:', error.message); return null; }
    return data;
  }

  async function listarPerfis() {
    return checar(await cliente.from('perfis').select('*').order('aprovado', { ascending: true }).order('criado_em', { ascending: false }));
  }

  async function aprovarPerfil(id, aprovado) {
    checar(await cliente.from('perfis').update({ aprovado, aprovado_em: aprovado ? new Date().toISOString() : null, aprovado_por: usuarioAtual ? usuarioAtual.email : null }).eq('id', id));
  }

  /** Envia um link de acesso por e-mail (só para usuários já cadastrados no painel). */
  async function entrarLink(email) {
    const { error } = await cliente.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: global.location.origin + global.location.pathname } });
    if (error) throw new Error(/signups not allowed|not found/i.test(error.message) ? 'Este e-mail não está cadastrado. Peça ao administrador para convidá-lo.' : traduzir(error.message));
  }

  /** Define ou troca a senha do usuário conectado (após entrar por link de convite ou de acesso). */
  async function definirSenha(senha) {
    const { error } = await cliente.auth.updateUser({ password: senha });
    if (error) throw new Error(/weak|at least/i.test(error.message) ? 'Senha muito curta: use pelo menos 6 caracteres.' : traduzir(error.message));
  }

  function traduzir(msg) {
    const m = String(msg || '');
    if (/invalid login credentials/i.test(m)) return 'E-mail ou senha incorretos.';
    if (/already registered|already been registered/i.test(m)) return 'Este e-mail já está cadastrado. Use "Entrar".';
    if (/password should be at least|weak password/i.test(m)) return 'Senha muito curta: use pelo menos 6 caracteres.';
    if (/signups not allowed/i.test(m)) return 'Cadastro desativado. Fale com o administrador.';
    if (/invalid email|unable to validate email/i.test(m)) return 'E-mail inválido.';
    if (/email not confirmed/i.test(m)) return 'E-mail ainda não confirmado.';
    if (/rate limit/i.test(m)) return 'Muitas tentativas; aguarde um instante.';
    if (/row-level security|permission denied|401|403/i.test(m)) return 'Sem permissão para gravar: entre com um usuário autorizado.';
    if (/Failed to fetch|NetworkError/i.test(m)) return 'Sem conexão com o banco de dados.';
    return m;
  }

  function checar(resp) {
    if (resp.error) throw new Error(traduzir(resp.error.message));
    return resp.data;
  }

  // ---------- leitura ----------
  async function carregarLiderancas(cdMun) {
    const data = checar(await cliente.from('liderancas').select('dados, atualizado_em').eq('cd_mun', cdMun));
    // a data da última gravação vai junto, mas fora do JSON gravado (propriedade não enumerável)
    return (data || []).map((r) => Object.defineProperty(r.dados, '_atualizadoEm', { value: r.atualizado_em, enumerable: false, writable: true }));
  }

  async function carregarCandidatos() {
    const data = checar(await cliente.from('candidatos_manuais').select('dados'));
    return (data || []).map((r) => r.dados);
  }

  async function carregarImportado(cdMun) {
    const data = checar(await cliente.from('municipios_importados').select('marca').eq('cd_mun', cdMun).maybeSingle());
    return data ? data.marca : null;
  }

  // ---------- gravação ----------
  const carimbo = () => ({ atualizado_em: new Date().toISOString(), atualizado_por: usuarioAtual ? usuarioAtual.email : null });

  async function gravarLiderancas(lista) {
    if (!lista.length) return;
    checar(await cliente.from('liderancas').upsert(lista.map((l) => Object.assign({ id: l.id, cd_mun: l.cd_mun, dados: l }, carimbo()))));
  }

  async function excluirLiderancas(ids) {
    if (!ids.length) return;
    checar(await cliente.from('liderancas').delete().in('id', ids));
  }

  async function gravarCandidatos(lista) {
    if (!lista.length) return;
    checar(await cliente.from('candidatos_manuais').upsert(lista.map((c) => Object.assign({ id: c.id, dados: c }, carimbo()))));
  }

  async function excluirCandidatos(ids) {
    if (!ids.length) return;
    checar(await cliente.from('candidatos_manuais').delete().in('id', ids));
  }

  async function marcarImportado(cdMun, marca) {
    checar(await cliente.from('municipios_importados').upsert(Object.assign({ cd_mun: cdMun, marca: String(marca) }, carimbo())));
  }

  global.Sync = {
    iniciar, configurado, usuario, aoMudarUsuario, entrar, entrarLink, definirSenha, sair,
    cadastrar, perfil, listarPerfis, aprovarPerfil,
    carregarLiderancas, carregarCandidatos, carregarImportado,
    gravarLiderancas, excluirLiderancas, gravarCandidatos, excluirCandidatos, marcarImportado,
  };
})(window);
