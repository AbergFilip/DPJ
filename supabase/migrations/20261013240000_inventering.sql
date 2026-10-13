-- Inventering: räkna en hyllplats och rätta saldot. Rörelsen loggas som 'inventering'.
alter table public.stock_moves drop constraint stock_moves_kind_check;
alter table public.stock_moves add constraint stock_moves_kind_check check (kind in ('in','plock','avvikelse','inventering'));
alter table public.products add column counted_at timestamptz;

create or replace function public.count_stock(p_sku text, p_counted int, p_who text, p_note text)
returns int language plpgsql security definer set search_path = '' as $$
declare before int; diff int;
begin
  if p_counted < 0 or p_counted > 9999 then raise exception 'antal måste vara 0–9999'; end if;
  select stock into before from public.products where sku = p_sku;
  if before is null then return null; end if;
  diff := p_counted - before;
  update public.products set stock = p_counted, counted_at = now() where sku = p_sku;
  if diff <> 0 then
    insert into public.stock_moves (sku, qty, kind, who, note)
      values (p_sku, diff, 'inventering', p_who, nullif(left(coalesce(p_note, ''), 200), ''));
  end if;
  return p_counted;
end $$;
revoke all on function public.count_stock(text,int,text,text) from public;
grant execute on function public.count_stock(text,int,text,text) to anon, authenticated;

-- Återställningen nollar även när hyllan senast räknades.
create or replace function public.reset_stock()
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.products p set stock = s.stock, min_stock = s.min_stock, counted_at = null from (values
    ('BRZ-SK-1680-VI',14,4), ('BRZ-SK-1680-EK',5,4), ('BRZ-SK-1890-AN',3,2), ('BRZ-ST-EL2-SV',1,4),
    ('BRZ-ST-EL2-VI',6,4), ('HU-3L-VI',9,3), ('KS-ERGO-SV',18,6), ('SV-160-GR',2,4),
    ('MA-DUO-SV',11,4), ('KR-140-SV',25,10), ('FS-ERGO',7,4)
  ) as s(sku, stock, min_stock) where p.sku = s.sku;
  update public.stock_moves set hidden = true where not hidden;
end $$;
