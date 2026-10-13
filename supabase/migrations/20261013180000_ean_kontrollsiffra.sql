-- Demons EAN-koder fick fel kontrollsiffra, så riktiga skannrar och etikettsidan godtog dem inte.
update public.products set ean = '7340001216806' where ean = '7340001216801';
update public.products set ean = '7340001216813' where ean = '7340001216818';
update public.products set ean = '7340001218909' where ean = '7340001218904';
update public.products set ean = '7340001302219' where ean = '7340001302214';
update public.products set ean = '7340001302226' where ean = '7340001302221';
update public.products set ean = '7340001455106' where ean = '7340001455101';

create or replace function public.reset_demo()
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.products (sku, name, variant, ean, loc, type, brand) values
    ('BRZ-SK-1680-VI','Bordsskiva Professional','160×80 cm, vit','7340001216806','A-03-2','skiva','Brizley'),
    ('BRZ-SK-1680-EK','Bordsskiva Professional','160×80 cm, ek','7340001216813','A-03-3','skiva','Brizley'),
    ('BRZ-SK-1890-AN','Bordsskiva Professional','180×90 cm, antracit','7340001218909','A-05-1','skiva','Brizley'),
    ('BRZ-ST-EL2-SV','Elstativ Professional, 2 motorer','svart, för 160–180 cm','7340001302219','B-02-1','stativ','Brizley'),
    ('BRZ-ST-EL2-VI','Elstativ Professional, 2 motorer','vit, för 160–180 cm','7340001302226','B-02-2','stativ','Brizley'),
    ('HU-3L-VI','Hurts 3 lådor, låsbar','vit','7340001455106','C-06-2','hurts',null),
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
