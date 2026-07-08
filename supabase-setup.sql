-- LifeScrum cloud sync — run this once in Supabase: Dashboard → SQL Editor → New query → paste → Run

create table if not exists public.boards (
    user_id uuid primary key references auth.users (id) on delete cascade,
    data jsonb not null,
    updated_at timestamptz not null default now()
);

-- Each user can only ever read/write their own board.
alter table public.boards enable row level security;

create policy "Users manage own board"
    on public.boards
    for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

-- Live cross-device updates.
alter publication supabase_realtime add table public.boards;
