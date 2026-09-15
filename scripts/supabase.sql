-- Banco do mapeamento de lideranças (Eleições 2026) no Supabase.
-- Execute no SQL Editor do projeto (pode rodar mais de uma vez).
--
-- Acesso: qualquer pessoa pode se cadastrar (e-mail e senha), mas só lê e grava depois que um
-- administrador marca o perfil como aprovado. Administradores aprovam/revogam pela tela "Usuários" do site.

-- ---------- dados do mapeamento ----------
create table if not exists public.liderancas (
  id text primary key,
  cd_mun text not null,
  dados jsonb not null,
  atualizado_em timestamptz not null default now(),
  atualizado_por text
);
create index if not exists liderancas_cd_mun on public.liderancas (cd_mun);

create table if not exists public.candidatos_manuais (
  id text primary key,
  dados jsonb not null,
  atualizado_em timestamptz not null default now(),
  atualizado_por text
);

create table if not exists public.municipios_importados (
  cd_mun text primary key,
  marca text not null,
  atualizado_em timestamptz not null default now(),
  atualizado_por text
);

-- ---------- perfis dos usuários ----------
create table if not exists public.perfis (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  nome text,
  aprovado boolean not null default false,
  papel text not null default 'usuario',      -- 'usuario' | 'admin'
  criado_em timestamptz not null default now(),
  aprovado_em timestamptz,
  aprovado_por text
);

-- cria o perfil automaticamente quando alguém se cadastra
create or replace function public.criar_perfil()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfis (id, email, nome)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'nome', ''))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists ao_criar_usuario on auth.users;
create trigger ao_criar_usuario after insert on auth.users
  for each row execute function public.criar_perfil();

-- perfis para usuários que já existiam antes do gatilho
insert into public.perfis (id, email, nome)
select u.id, u.email, coalesce(u.raw_user_meta_data ->> 'nome', '') from auth.users u
on conflict (id) do nothing;

-- funções usadas nas políticas
create or replace function public.eh_aprovado()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select aprovado from public.perfis where id = auth.uid()), false);
$$;
create or replace function public.eh_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select aprovado and papel = 'admin' from public.perfis where id = auth.uid()), false);
$$;

-- ---------- políticas ----------
alter table public.liderancas enable row level security;
alter table public.candidatos_manuais enable row level security;
alter table public.municipios_importados enable row level security;
alter table public.perfis enable row level security;

drop policy if exists "leitura publica" on public.liderancas;
drop policy if exists "escrita autenticada" on public.liderancas;
drop policy if exists "aprovados" on public.liderancas;
create policy "aprovados" on public.liderancas for all to authenticated using (public.eh_aprovado()) with check (public.eh_aprovado());

drop policy if exists "leitura publica" on public.candidatos_manuais;
drop policy if exists "escrita autenticada" on public.candidatos_manuais;
drop policy if exists "aprovados" on public.candidatos_manuais;
create policy "aprovados" on public.candidatos_manuais for all to authenticated using (public.eh_aprovado()) with check (public.eh_aprovado());

drop policy if exists "leitura publica" on public.municipios_importados;
drop policy if exists "escrita autenticada" on public.municipios_importados;
drop policy if exists "aprovados" on public.municipios_importados;
create policy "aprovados" on public.municipios_importados for all to authenticated using (public.eh_aprovado()) with check (public.eh_aprovado());

drop policy if exists "perfil proprio" on public.perfis;
drop policy if exists "admin le" on public.perfis;
drop policy if exists "admin atualiza" on public.perfis;
create policy "perfil proprio" on public.perfis for select to authenticated using (id = auth.uid());
create policy "admin le" on public.perfis for select to authenticated using (public.eh_admin());
create policy "admin atualiza" on public.perfis for update to authenticated using (public.eh_admin()) with check (public.eh_admin());

-- ---------- primeiro administrador ----------
update public.perfis set aprovado = true, papel = 'admin', aprovado_em = now(), aprovado_por = 'sistema'
where email = 'wilkerpietro@gmail.com';

-- ---------- limpeza de lideranças repetidas + trava contra novas cópias ----------
-- Cópias surgiam quando a importação automática rodava logo após o login, sem ler a nuvem (corrigido no site).
-- Regras da junção (mesmo município + mesmo sequencial do TSE): fica o registro mais antigo; os campos vazios dele
-- recebem os das cópias; expectativa 2026 (votos2026) e observação ficam com o valor editado mais recentemente;
-- os apoios de 2026 são unidos SEM alterar os do registro que fica. As cópias são apagadas. Pode rodar mais de uma vez.
with grupo as (
  select id, cd_mun, dados, atualizado_em, dados->>'sq' as sq,
         row_number() over (partition by cd_mun, dados->>'sq' order by coalesce(dados->>'criadoEm', ''), atualizado_em, id) as pos,
         count(*) over (partition by cd_mun, dados->>'sq') as n
  from public.liderancas
  where coalesce(dados->>'sq', '') <> ''
),
fica as (select * from grupo where n > 1 and pos = 1),
campos_copias as (
  -- por campo, o valor não vazio mais recente entre as cópias (preenche o que estiver vazio no registro que fica)
  select f.id, jsonb_object_agg(e.k, e.v) as dados
  from fica f
  join lateral (
    select distinct on (x.k) x.k, x.v
    from grupo c, jsonb_each(c.dados) as x(k, v)
    where c.cd_mun = f.cd_mun and c.sq = f.sq and c.pos > 1
      and x.v is not null and x.v <> 'null'::jsonb and x.v <> '""'::jsonb and x.v <> '{}'::jsonb
      and x.k not in ('id', 'criadoEm', 'apoio2026', 'votos2026', 'obs')
    order by x.k, c.atualizado_em desc
  ) e on true
  group by f.id
),
recentes as (
  -- expectativa 2026 e observação: valor editado mais recentemente, entre todos os registros do grupo
  select f.id,
    (select c.dados->'votos2026' from grupo c where c.cd_mun = f.cd_mun and c.sq = f.sq and jsonb_typeof(c.dados->'votos2026') = 'number' order by c.atualizado_em desc limit 1) as votos2026,
    (select c.dados->'obs' from grupo c where c.cd_mun = f.cd_mun and c.sq = f.sq and coalesce(c.dados->>'obs', '') <> '' order by c.atualizado_em desc limit 1) as obs
  from fica f
),
apoios as (
  -- apoios 2026: união por cargo; em conflito vale o do registro que fica (pos 1)
  select f.id, coalesce(jsonb_object_agg(e.k, e.v) filter (where e.k is not null), '{}'::jsonb) as apoio2026
  from fica f
  left join lateral (
    select distinct on (x.k) x.k, x.v
    from grupo c, jsonb_each(coalesce(c.dados->'apoio2026', '{}'::jsonb)) as x(k, v)
    where c.cd_mun = f.cd_mun and c.sq = f.sq and coalesce(x.v->>'candidato_id', '') <> ''
    order by x.k, c.pos, c.atualizado_em desc
  ) e on true
  group by f.id
),
atualizados as (
  update public.liderancas l
  set dados = coalesce(cc.dados, '{}'::jsonb)
           || coalesce((select jsonb_object_agg(x.k, x.v) from jsonb_each(l.dados) as x(k, v)
                        where x.v is not null and x.v <> 'null'::jsonb and x.v <> '""'::jsonb), '{}'::jsonb)
           || case when r.votos2026 is not null then jsonb_build_object('votos2026', r.votos2026) else '{}'::jsonb end
           || case when r.obs is not null then jsonb_build_object('obs', r.obs) else '{}'::jsonb end
           || jsonb_build_object('apoio2026', a.apoio2026),
      atualizado_em = now()
  from fica f
  left join campos_copias cc on cc.id = f.id
  left join recentes r on r.id = f.id
  left join apoios a on a.id = f.id
  where l.id = f.id
  returning l.id
)
delete from public.liderancas where id in (select id from grupo where pos > 1);

-- o banco passa a recusar duas lideranças com o mesmo candidato de 2024 no mesmo município
create unique index if not exists liderancas_mun_sq_unico
  on public.liderancas (cd_mun, (dados->>'sq'))
  where coalesce(dados->>'sq', '') <> '';
