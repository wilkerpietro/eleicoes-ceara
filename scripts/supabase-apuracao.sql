-- Apuração paralela (Eleições 2026): um registro por seção, com os números do boletim de urna.
-- Execute no SQL Editor do projeto no Supabase (pode rodar mais de uma vez).
-- Depende das funções eh_aprovado() criadas em scripts/supabase.sql.
--
-- Acesso: QUALQUER PESSOA com o link do site vê a apuração (o boletim de urna é público, afixado na seção);
-- só usuários aprovados pelo administrador lançam, corrigem ou apagam boletins.
-- Para restringir a leitura à equipe, troque a política "leitura publica" pela linha comentada no fim.

create table if not exists public.apuracao (
  id text primary key,                 -- '<cd_mun>-<secao>'
  cd_mun text not null,
  secao text not null,
  dados jsonb not null,                -- { zona, bairro, local, comparecimento, votos: {numero: n}, brancos: {cargo: n}, nulos: {cargo: n}, obs }
  atualizado_em timestamptz not null default now(),
  atualizado_por text
);
create index if not exists apuracao_cd_mun on public.apuracao (cd_mun);

-- horário do lançamento pelo relógio do banco (o do celular pode estar errado)
create or replace function public.apuracao_carimbo()
returns trigger language plpgsql as $$
begin
  new.atualizado_em := now();
  return new;
end $$;
drop trigger if exists apuracao_carimbo on public.apuracao;
create trigger apuracao_carimbo before insert or update on public.apuracao
  for each row execute function public.apuracao_carimbo();

alter table public.apuracao enable row level security;

drop policy if exists "leitura publica" on public.apuracao;
drop policy if exists "leitura equipe" on public.apuracao;
drop policy if exists "aprovados gravam" on public.apuracao;
drop policy if exists "aprovados alteram" on public.apuracao;
drop policy if exists "aprovados apagam" on public.apuracao;

create policy "leitura publica" on public.apuracao for select to anon, authenticated using (true);
create policy "aprovados gravam" on public.apuracao for insert to authenticated with check (public.eh_aprovado());
create policy "aprovados alteram" on public.apuracao for update to authenticated using (public.eh_aprovado()) with check (public.eh_aprovado());
create policy "aprovados apagam" on public.apuracao for delete to authenticated using (public.eh_aprovado());

-- Leitura só para a equipe aprovada (em vez da pública):
-- drop policy if exists "leitura publica" on public.apuracao;
-- create policy "leitura equipe" on public.apuracao for select to authenticated using (public.eh_aprovado());
