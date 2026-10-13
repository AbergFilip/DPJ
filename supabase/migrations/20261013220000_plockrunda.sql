-- Plockrunda: ta upp till fyra order på en gång. Allt eller inget: om någon order redan är tagen tas ingen.
create or replace function public.claim_orders(p_orders text[], p_picker text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if coalesce(array_length(p_orders, 1), 0) not between 1 and 4 then return false; end if;
  if exists (select 1 from public.orders where status = 'plock' and picker = p_picker) then return false; end if;
  select count(*) into n from (select 1 from public.orders where id = any(p_orders) and status = 'ny' for update) x;
  if n <> array_length(p_orders, 1) then return false; end if;
  update public.orders set status = 'plock', picker = p_picker, started_at = now() where id = any(p_orders);
  return true;
end $$;
revoke all on function public.claim_orders(text[], text) from public;
grant execute on function public.claim_orders(text[], text) to anon, authenticated;
