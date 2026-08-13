-- Phase 1 (20260813040000) dropped the `focus` text that existed in the
-- superseded exam_categories.streams shape when designing stream_configs --
-- an oversight caught while building Phase 2's stream-picker cards, which the
-- task explicitly requires to show "icon + one-line description" sourced
-- from data, never hardcoded in a component. Additive, nullable; backfilled
-- from the same verified source text as the original seed (docs/
-- curriculum-streams-reference.json / the task's canonical curriculum text),
-- not invented.

alter table public.stream_configs add column if not exists description text;

comment on column public.stream_configs.description is
  'One-line focus/description for the stream picker card. Added 2026-08-13 after Phase 1 shipped without it; Phase 2 needs real per-stream text, not a hardcoded UI string.';

update public.stream_configs set description = 'Engineering, medicine, research, and technology'
  where stream_key = 'science';
update public.stream_configs set description = 'Finance, accounting, business management, and CA/CS'
  where stream_key = 'commerce';
update public.stream_configs set description = 'Law, civil services, journalism, psychology, and social sciences'
  where stream_key = 'humanities';
