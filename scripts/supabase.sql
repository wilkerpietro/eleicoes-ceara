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
