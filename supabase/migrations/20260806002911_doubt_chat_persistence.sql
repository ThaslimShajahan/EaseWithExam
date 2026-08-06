-- ITEM 3: doubt chat history was written (createDoubtChat/saveDoubtMessage,
-- already live) but never read back — every page load/refresh started a
-- fresh session instead of resuming. Building the restore path surfaced
-- that doubt_chats/doubt_messages carried the same wide-open `USING(true)`
-- policy already found on the coaching tables (BUG-002) — confirmed live
-- the same pattern exists on flashcards/flashcard_progress/question_history/
-- user_weak_topics/users too, i.e. this is systemic across the app, not
-- unique to coaching. Scoping this migration to just the two tables this
-- feature touches (doubt_chats, doubt_messages) per the fix's own explicit
-- instruction not to default to an open policy — the rest is flagged
-- separately as a follow-up, not fixed here (out of scope for this item).
--
-- Design: full lockdown, zero direct-table policies for anon — every
-- read/write goes through a SECURITY DEFINER RPC. (Originally tried
-- INSERT-only + WITH CHECK(true) to avoid touching the existing
-- createDoubtChat/saveDoubtMessage call sites, but Postgres RLS requires
-- an INSERT's RETURNING clause to also satisfy the SELECT policy — and
-- both functions do `.insert(...).select().single()` — so a SELECT-less
-- policy set would have silently broken chat creation. RPCs sidestep this
-- since SECURITY DEFINER bypasses RLS entirely inside the function body.)

drop policy if exists doubt_chats_open    on public.doubt_chats;
drop policy if exists doubt_messages_open on public.doubt_messages;

create or replace function public.create_doubt_chat(p_uid text, p_subject text default null)
returns public.doubt_chats
language sql
security definer
set search_path = public
as $$
  insert into public.doubt_chats (firebase_uid, subject)
  values (p_uid, p_subject)
  returning *;
$$;

create or replace function public.save_doubt_message(p_chat_id uuid, p_role text, p_content text)
returns public.doubt_messages
language sql
security definer
set search_path = public
as $$
  insert into public.doubt_messages (chat_id, role, content)
  values (p_chat_id, p_role, p_content)
  returning *;
$$;

create or replace function public.get_recent_doubt_chat(p_uid text)
returns json
language sql
security definer
set search_path = public
as $$
  select json_build_object(
    'id', c.id,
    'messages', (
      select coalesce(
        json_agg(
          json_build_object('id', m.id, 'role', m.role, 'content', m.content, 'created_at', m.created_at)
          order by m.created_at asc
        ),
        '[]'::json
      )
      from public.doubt_messages m
      where m.chat_id = c.id
    )
  )
  from public.doubt_chats c
  where c.firebase_uid = p_uid
  order by c.created_at desc
  limit 1;
$$;

grant execute on function public.create_doubt_chat(text, text) to anon;
grant execute on function public.save_doubt_message(uuid, text, text) to anon;
grant execute on function public.get_recent_doubt_chat(text) to anon;
