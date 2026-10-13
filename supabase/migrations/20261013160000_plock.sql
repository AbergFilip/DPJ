-- DPJ Plock: schema, funktioner och demodata. Redan applicerat på Supabase-projektet hxmviwgojoxjjacargac.
-- Läsning är öppen (RLS select). Skrivningar sker bara via funktionerna, som kontrollerar att plockaren äger ordern.

create table public.products (
  sku text primary key, name text not null, variant text not null, ean text not null unique,
  loc text not null, type text not null, brand text
);
create table public.orders (
  id text primary key, cust text not null,
  ship text not null check (ship in ('exp','std')), ship_txt text not null, due text not null,
  status text not null default 'ny' check (status in ('ny','plock','pack','avv')),
  picker text, started_at timestamptz, done_at timestamptz, created_at timestamptz not null default now()
);
create table public.order_lines (
  id bigint generated always as identity primary key,
  order_id text not null references public.orders(id) on delete cascade,
  sku text not null references public.products(sku),
  qty int not null check (qty > 0), picked int not null default 0, loc_ok boolean not null default false,
  dev_kind text, dev_found int, dev_note text, dev_photo_url text,
  constraint order_lines_order_sku_key unique (order_id, sku)
);
create index order_lines_order_id_idx on public.order_lines(order_id);
create index order_lines_sku_idx on public.order_lines(sku);

alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_lines enable row level security;
create policy "alla läser artiklar" on public.products for select to anon, authenticated using (true);
create policy "alla läser order" on public.orders for select to anon, authenticated using (true);
create policy "alla läser plockrader" on public.order_lines for select to anon, authenticated using (true);

alter table public.order_lines replica identity full;
alter table public.orders replica identity full;
alter publication supabase_realtime add table public.orders, public.order_lines;

-- Ta en order. Atomiskt: lyckas bara om ordern är ny och plockaren inte redan har en order igång.
create or replace function public.claim_order(p_order text, p_picker text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if exists (select 1 from public.orders where status = 'plock' and picker = p_picker) then return false; end if;
  update public.orders set status = 'plock', picker = p_picker, started_at = now()
    where id = p_order and status = 'ny';
  get diagnostics n = row_count;
  return n = 1;
end $$;

create or replace function public.release_order(p_order text, p_picker text)
returns void language sql security definer set search_path = '' as $$
  update public.orders set status = 'ny', picker = null, started_at = null
    where id = p_order and status = 'plock' and picker = p_picker;
$$;

create or replace function public.confirm_location(p_line bigint, p_picker text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.order_lines l set loc_ok = true
    from public.orders o where l.id = p_line and o.id = l.order_id and o.status = 'plock' and o.picker = p_picker;
  get diagnostics n = row_count;
  return n = 1;
end $$;

create or replace function public.pick_item(p_line bigint, p_picker text)
returns int language plpgsql security definer set search_path = '' as $$
declare v int;
begin
  update public.order_lines l set picked = l.picked + 1
    from public.orders o
    where l.id = p_line and o.id = l.order_id and o.status = 'plock' and o.picker = p_picker
      and l.loc_ok and l.picked < l.qty and l.dev_kind is null
    returning l.picked into v;
  return v;
end $$;

create or replace function public.report_deviation(p_line bigint, p_picker text, p_kind text, p_found int, p_note text, p_photo_url text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if p_kind not in ('Saknas','Skadad','Fel saldo') then raise exception 'okänd avvikelse'; end if;
  update public.order_lines l set dev_kind = p_kind, dev_found = greatest(0, least(p_found, l.qty)),
      picked = greatest(0, least(p_found, l.qty)), dev_note = nullif(left(coalesce(p_note, ''), 500), ''), dev_photo_url = p_photo_url
    from public.orders o where l.id = p_line and o.id = l.order_id and o.status = 'plock' and o.picker = p_picker;
  get diagnostics n = row_count;
  return n = 1;
end $$;

create or replace function public.finish_order(p_order text, p_picker text)
returns text language plpgsql security definer set search_path = '' as $$
declare s text;
begin
  if exists (select 1 from public.order_lines where order_id = p_order and picked < qty and dev_kind is null) then
    raise exception 'ordern har oplockade rader';
  end if;
  update public.orders o set done_at = now(),
      status = case when exists (select 1 from public.order_lines where order_id = p_order and dev_kind is not null) then 'avv' else 'pack' end
    where o.id = p_order and o.status = 'plock' and o.picker = p_picker
    returning o.status into s;
  return s;
end $$;

-- Återställ demodata (påhittade order). Utan delete: raderna nollställs till startläget.
create or replace function public.reset_demo()
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.products (sku, name, variant, ean, loc, type, brand) values
    ('BRZ-SK-1680-VI','Bordsskiva Professional','160×80 cm, vit','7340001216801','A-03-2','skiva','Brizley'),
    ('BRZ-SK-1680-EK','Bordsskiva Professional','160×80 cm, ek','7340001216818','A-03-3','skiva','Brizley'),
    ('BRZ-SK-1890-AN','Bordsskiva Professional','180×90 cm, antracit','7340001218904','A-05-1','skiva','Brizley'),
    ('BRZ-ST-EL2-SV','Elstativ Professional, 2 motorer','svart, för 160–180 cm','7340001302214','B-02-1','stativ','Brizley'),
    ('BRZ-ST-EL2-VI','Elstativ Professional, 2 motorer','vit, för 160–180 cm','7340001302221','B-02-2','stativ','Brizley'),
    ('HU-3L-VI','Hurts 3 lådor, låsbar','vit','7340001455101','C-06-2','hurts',null),
    ('KS-ERGO-SV','Kontorsstol Ergo Plus','svart tyg','7340001501209','C-11-1','stol',null),
    ('SV-160-GR','Skärmvägg bordsmonterad','160 cm, grå filt','7340001604306','D-04-3','vagg',null),
    ('MA-DUO-SV','Skärmarm dubbel','svart','7340001700107','E-01-4','arm',null),
    ('KR-140-SV','Kabelränna','140 cm, svart','7340001714005','E-02-1','ranna',null),
    ('FS-ERGO','Fotstöd, justerbart','svart','7340001720600','E-03-2','fot',null)
  on conflict (sku) do update set name = excluded.name, variant = excluded.variant, ean = excluded.ean,
    loc = excluded.loc, type = excluded.type, brand = excluded.brand;

  insert into public.orders as o (id, cust, ship, ship_txt, due, status, picker, started_at, done_at) values
    ('100481','Nordvik Redovisning AB','exp','Express Stockholm','11:30','ny',null,null,null),
    ('100484','Studio Hägg & Co','exp','Express Stockholm','11:45','ny',null,null,null),
    ('100482','Lindqvist Arkitekter','std','PostNord','15:00','ny',null,null,null),
    ('100483','Fjällgren Fastigheter','std','PostNord','15:00','plock','Amir',now() - interval '6 min',null),
    ('100485','Berglund Tandvård','std','PostNord','15:00','ny',null,null,null),
    ('100480','Öberg Konsult','std','PostNord','15:00','avv','Jonna',now() - interval '52 min',now() - interval '41 min'),
    ('100479','Kvarnström Media','exp','Express Stockholm','10:00','pack','Amir',now() - interval '75 min',now() - interval '66 min')
  on conflict (id) do update set cust = excluded.cust, ship = excluded.ship, ship_txt = excluded.ship_txt, due = excluded.due,
    status = excluded.status, picker = excluded.picker, started_at = excluded.started_at, done_at = excluded.done_at;

  with seed(order_id, sku, qty, picked, loc_ok, dev_kind, dev_found, dev_note) as (values
    ('100481','BRZ-SK-1680-VI',2,0,false,null::text,null::int,null::text),
    ('100481','BRZ-ST-EL2-SV',2,0,false,null,null,null),
    ('100481','KR-140-SV',2,0,false,null,null,null),
    ('100484','BRZ-SK-1890-AN',1,0,false,null,null,null),
    ('100484','BRZ-ST-EL2-SV',1,0,false,null,null,null),
    ('100484','HU-3L-VI',1,0,false,null,null,null),
    ('100484','SV-160-GR',1,0,false,null,null,null),
    ('100482','BRZ-SK-1680-EK',1,0,false,null,null,null),
    ('100482','BRZ-ST-EL2-VI',1,0,false,null,null,null),
    ('100482','MA-DUO-SV',1,0,false,null,null,null),
    ('100483','KS-ERGO-SV',4,2,true,null,null,null),
    ('100483','FS-ERGO',4,0,false,null,null,null),
    ('100485','HU-3L-VI',2,0,false,null,null,null),
    ('100485','SV-160-GR',2,0,false,null,null,null),
    ('100480','BRZ-SK-1680-EK',1,1,true,null,null,null),
    ('100480','BRZ-ST-EL2-SV',1,0,true,'Saknas',0,'Tom plats B-02-1'),
    ('100479','KS-ERGO-SV',2,2,true,null,null,null),
    ('100479','MA-DUO-SV',2,2,true,null,null,null)
  ), upd as (
    update public.order_lines l set qty = s.qty, picked = s.picked, loc_ok = s.loc_ok, dev_kind = s.dev_kind,
        dev_found = s.dev_found, dev_note = s.dev_note, dev_photo_url = null
      from seed s where l.order_id = s.order_id and l.sku = s.sku
      returning l.order_id, l.sku
  )
  insert into public.order_lines (order_id, sku, qty, picked, loc_ok, dev_kind, dev_found, dev_note)
    select s.order_id, s.sku, s.qty, s.picked, s.loc_ok, s.dev_kind, s.dev_found, s.dev_note from seed s
    where not exists (select 1 from public.order_lines l where l.order_id = s.order_id and l.sku = s.sku);
end $$;

revoke all on function public.claim_order(text,text), public.release_order(text,text), public.confirm_location(bigint,text),
  public.pick_item(bigint,text), public.report_deviation(bigint,text,text,int,text,text), public.finish_order(text,text),
  public.reset_demo() from public;
grant execute on function public.claim_order(text,text), public.release_order(text,text), public.confirm_location(bigint,text),
  public.pick_item(bigint,text), public.report_deviation(bigint,text,text,int,text,text), public.finish_order(text,text),
  public.reset_demo() to anon, authenticated;

-- Foton på avvikelser.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avvikelser', 'avvikelser', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
create policy "alla laddar upp avvikelsefoton" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'avvikelser');

select public.reset_demo();
