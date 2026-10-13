-- Saldo per artikel (varje artikel har en hyllplats), inleverans och logg över lagerrörelser.
alter table public.products add column stock int not null default 0, add column min_stock int not null default 0;

create table public.stock_moves (
  id bigint generated always as identity primary key,
  sku text not null references public.products(sku),
  qty int not null, kind text not null check (kind in ('in','plock','avvikelse')),
  who text, note text, at timestamptz not null default now()
);
create index stock_moves_sku_idx on public.stock_moves(sku);
alter table public.stock_moves enable row level security;
create policy "alla läser lagerrörelser" on public.stock_moves for select to anon, authenticated using (true);
alter table public.products replica identity full;
alter publication supabase_realtime add table public.products, public.stock_moves;

-- Inleverans: lägger till antal på artikelns hylla och loggar det.
create or replace function public.receive_goods(p_sku text, p_qty int, p_who text)
returns int language plpgsql security definer set search_path = '' as $$
declare v int;
begin
  if p_qty < 1 or p_qty > 999 then raise exception 'antal måste vara 1–999'; end if;
  update public.products set stock = stock + p_qty where sku = p_sku returning stock into v;
  if v is null then return null; end if;
  insert into public.stock_moves (sku, qty, kind, who) values (p_sku, p_qty, 'in', p_who);
  return v;
end $$;

-- Plock drar en från saldot.
create or replace function public.pick_item(p_line bigint, p_picker text)
returns int language plpgsql security definer set search_path = '' as $$
declare v int; s text;
begin
  update public.order_lines l set picked = l.picked + 1
    from public.orders o
    where l.id = p_line and o.id = l.order_id and o.status = 'plock' and o.picker = p_picker
      and l.loc_ok and l.picked < l.qty and l.dev_kind is null
    returning l.picked, l.sku into v, s;
  if v is not null then
    update public.products set stock = greatest(0, stock - 1) where sku = s;
    insert into public.stock_moves (sku, qty, kind, who) values (s, -1, 'plock', p_picker);
  end if;
  return v;
end $$;

-- Saknas eller fel saldo betyder att hyllan är tom när plockaren tagit det som fanns.
create or replace function public.report_deviation(p_line bigint, p_picker text, p_kind text, p_found int, p_note text, p_photo_url text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare s text; before int;
begin
  if p_kind not in ('Saknas','Skadad','Fel saldo') then raise exception 'okänd avvikelse'; end if;
  select l.sku into s from public.order_lines l join public.orders o on o.id = l.order_id
    where l.id = p_line and o.status = 'plock' and o.picker = p_picker;
  if s is null then return false; end if;
  update public.order_lines l set dev_kind = p_kind, dev_found = greatest(0, least(p_found, l.qty)),
      picked = greatest(0, least(p_found, l.qty)), dev_note = nullif(left(coalesce(p_note, ''), 500), ''), dev_photo_url = p_photo_url
    where l.id = p_line;
  if p_kind in ('Saknas','Fel saldo') then
    select stock into before from public.products where sku = s;
    update public.products set stock = 0 where sku = s;
    insert into public.stock_moves (sku, qty, kind, who, note) values (s, -before, 'avvikelse', p_picker, p_kind);
  end if;
  return true;
end $$;

-- Återställningen sätter även tillbaka saldot. Gamla lagerrörelser döljs i stället för att raderas.
-- Den tidigare återställningen av order döps om och anropas härifrån.
alter table public.stock_moves add column hidden boolean not null default false;
create or replace function public.reset_stock()
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.products p set stock = s.stock, min_stock = s.min_stock from (values
    ('BRZ-SK-1680-VI',14,4), ('BRZ-SK-1680-EK',5,4), ('BRZ-SK-1890-AN',3,2), ('BRZ-ST-EL2-SV',1,4),
    ('BRZ-ST-EL2-VI',6,4), ('HU-3L-VI',9,3), ('KS-ERGO-SV',18,6), ('SV-160-GR',2,4),
    ('MA-DUO-SV',11,4), ('KR-140-SV',25,10), ('FS-ERGO',7,4)
  ) as s(sku, stock, min_stock) where p.sku = s.sku;
  update public.stock_moves set hidden = true where not hidden;
end $$;
revoke all on function public.reset_stock() from public;

alter function public.reset_demo() rename to reset_demo_orders;
create or replace function public.reset_demo()
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.reset_demo_orders();
  perform public.reset_stock();
end $$;

revoke all on function public.receive_goods(text,int,text), public.reset_demo() from public;
grant execute on function public.receive_goods(text,int,text), public.reset_demo() to anon, authenticated;

select public.reset_stock();
