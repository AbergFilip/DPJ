-- Packstation: en plockad order packas, vägs och skickas. Ny status 'skickad'.
alter table public.orders drop constraint orders_status_check;
alter table public.orders add constraint orders_status_check check (status in ('ny','plock','pack','avv','skickad'));
alter table public.orders add column packed_at timestamptz, add column packer text, add column weight numeric(6,1);

-- Packa en order som är plockad (även med avvikelse: det som saknas blir restnoterat på packsedeln).
create or replace function public.pack_order(p_order text, p_packer text, p_weight numeric)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_weight is null or p_weight <= 0 or p_weight > 2000 then raise exception 'vikten måste vara 0,1–2000 kg'; end if;
  update public.orders set status = 'skickad', packed_at = now(), packer = p_packer, weight = round(p_weight, 1)
    where id = p_order and status in ('pack','avv');
  return found;
end $$;
revoke all on function public.pack_order(text, text, numeric) from public;
grant execute on function public.pack_order(text, text, numeric) to anon, authenticated;

-- Återställningen nollar även packningen.
create or replace function public.reset_demo()
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.reset_demo_orders();
  update public.orders set packed_at = null, packer = null, weight = null where packed_at is not null or weight is not null;
  perform public.reset_stock();
end $$;
