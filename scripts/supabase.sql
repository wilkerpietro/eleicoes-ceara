-- Tabelas do mapeamento de lideranças (Eleições 2026) no Supabase.
-- Execute no SQL Editor do projeto. Leitura pública; gravação só para usuários autenticados.

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

alter table public.liderancas enable row level security;
alter table public.candidatos_manuais enable row level security;
alter table public.municipios_importados enable row level security;

drop policy if exists "leitura publica" on public.liderancas;
drop policy if exists "escrita autenticada" on public.liderancas;
create policy "leitura publica" on public.liderancas for select using (true);
create policy "escrita autenticada" on public.liderancas for all to authenticated using (true) with check (true);

drop policy if exists "leitura publica" on public.candidatos_manuais;
drop policy if exists "escrita autenticada" on public.candidatos_manuais;
create policy "leitura publica" on public.candidatos_manuais for select using (true);
create policy "escrita autenticada" on public.candidatos_manuais for all to authenticated using (true) with check (true);

drop policy if exists "leitura publica" on public.municipios_importados;
drop policy if exists "escrita autenticada" on public.municipios_importados;
create policy "leitura publica" on public.municipios_importados for select using (true);
create policy "escrita autenticada" on public.municipios_importados for all to authenticated using (true) with check (true);
