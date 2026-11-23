-- BLOOMTEX · esquema para SUPABASE (usa Supabase Auth + RLS). Se ejecuta una sola vez.
create type user_role as enum('admin','produccion','comercial','lectura');
create table organizations(id uuid primary key default gen_random_uuid(), name text not null, created_at timestamptz default now());
create table profiles(id uuid primary key references auth.users on delete cascade, org_id uuid not null references organizations on delete cascade,
  name text, role user_role not null default 'admin', created_at timestamptz default now());

-- Producción
create table models(id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations on delete cascade,
  code text not null, name text not null, season text, image_url text,
  stage smallint not null default 0 check(stage between 0 and 7), -- 0 Diseño … 7 Entregado
  total_qty int not null default 0 check(total_qty>=0), assigned_qty int not null default 0 check(assigned_qty>=0),
  delayed boolean not null default false, delay_reason text, created_at timestamptz default now(),
  unique(org_id,code), check(assigned_qty<=total_qty));
create table variants(id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations on delete cascade,
  model_id uuid not null references models on delete cascade, color text, size text, qty int default 0);
create table model_stage_progress(org_id uuid not null references organizations on delete cascade, model_id uuid not null references models on delete cascade,
  stage text not null check(stage in('corte','costura','acabado','calidad','empaque')), done_qty int not null default 0 check(done_qty>=0), primary key(model_id,stage));
create table stage_history(id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations on delete cascade,
  model_id uuid not null references models on delete cascade, from_stage smallint, to_stage smallint, user_id uuid, at timestamptz default now());

-- Comercial
create table clients(id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations on delete cascade,
  name text not null, country text, type text default 'Marca', created_at timestamptz default now());
create table assignments(id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations on delete cascade,
  model_id uuid not null references models on delete cascade, client_id uuid not null references clients on delete cascade,
  qty int not null check(qty>0), delivery_status text default 'pendiente' check(delivery_status in('pendiente','parcial','entregado')), unique(model_id,client_id));
create table orders(id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations on delete cascade,
  code text not null, client_id uuid references clients on delete set null, status smallint not null default 0 check(status between 0 and 5), -- Nuevo…Facturado
  due_date date, delayed boolean default false, delay_reason text, created_at timestamptz default now(), unique(org_id,code));
create table order_items(id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations on delete cascade,
  order_id uuid not null references orders on delete cascade, model_id uuid references models on delete set null, qty int not null check(qty>0),
  done_cut int default 0, done_sew int default 0, done_finish int default 0, done_pack int default 0);

-- Compras e inventario
create table suppliers(id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations on delete cascade,
  name text not null, contact text, materials text, created_at timestamptz default now());
create table materials(id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations on delete cascade,
  name text not null, unit text not null default 'm' check(unit in('m','kg','un')), min_stock numeric not null default 0);
create table lots(id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations on delete cascade,
  material_id uuid not null references materials on delete cascade, supplier_id uuid references suppliers on delete set null, code text not null, received_at date default current_date);
create table supplier_orders(id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations on delete cascade,
  supplier_id uuid not null references suppliers on delete cascade, material_id uuid references materials on delete set null, qty numeric,
  status text not null default 'pendiente' check(status in('pendiente','en_transito','entregado','retrasado','bloqueado')),
  promised_date date, actual_date date, quality_pct int check(quality_pct between 0 and 100), fulfilled_pct int check(fulfilled_pct between 0 and 100));
create table inventory_movements(id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations on delete cascade,
  material_id uuid not null references materials on delete cascade, lot_id uuid references lots on delete set null, model_id uuid references models on delete set null,
  kind text not null check(kind in('in','out','adjust')), qty numeric not null, note text, user_id uuid, created_at timestamptz default now());

-- Sistema
create table alerts(id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations on delete cascade,
  kind text not null, ref_id uuid, message text not null, resolved boolean default false, created_at timestamptz default now());
create table bloomie_messages(id uuid primary key default gen_random_uuid(), org_id uuid not null references organizations on delete cascade,
  user_id uuid, role text not null, content text not null, created_at timestamptz default now());

-- Stock = suma de movimientos (in suma, out resta, adjust con signo)
create view material_stock with(security_invoker=true) as
  select m.id, m.org_id, m.name, m.unit, m.min_stock,
   coalesce(sum(case i.kind when 'out' then -i.qty else i.qty end),0) as stock
  from materials m left join inventory_movements i on i.material_id=m.id group by m.id;

-- Alerta automática de stock bajo
create function trg_low_stock() returns trigger language plpgsql as $$
declare s record; begin
  select * into s from material_stock where id=new.material_id;
  if s.stock < s.min_stock then
    if not exists(select 1 from alerts where kind='stock_bajo' and ref_id=s.id and not resolved) then
      insert into alerts(org_id,kind,ref_id,message) values(s.org_id,'stock_bajo',s.id,'Stock bajo: '||s.name||' ('||s.stock||' '||s.unit||', mínimo '||s.min_stock||')'); end if;
  else update alerts set resolved=true where kind='stock_bajo' and ref_id=s.id and not resolved; end if;
  return new; end $$;
create trigger low_stock after insert on inventory_movements for each row execute function trg_low_stock();

-- Reserva conceptual: no asignar más de lo que se produce
create function trg_assign() returns trigger language plpgsql as $$
declare t int; begin
  select coalesce(sum(qty),0) into t from assignments where model_id=new.model_id and id<>new.id;
  if t+new.qty > (select total_qty from models where id=new.model_id) then raise exception 'La asignación supera el total a producir'; end if;
  update models set assigned_qty=t+new.qty where id=new.model_id; return new; end $$;
create trigger assign_chk before insert or update on assignments for each row execute function trg_assign();


-- Quién es el usuario y de qué taller (funciones usadas por las políticas RLS)
create function current_org() returns uuid language sql stable security definer set search_path=public as $$ select org_id from public.profiles where id=auth.uid() $$;
create function current_app_role() returns user_role language sql stable security definer set search_path=public as $$ select role from public.profiles where id=auth.uid() $$;

-- Al registrarse un usuario: crea su taller y lo deja como admin.
-- Invitados: el admin los crea con la API admin y app_metadata {"org_id":"...","role":"produccion"} (el usuario no puede falsificarlo).
create function handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
declare o uuid; r user_role; begin
  o := nullif(new.raw_app_meta_data->>'org_id','')::uuid;
  if o is null then
    insert into organizations(name) values(coalesce(new.raw_user_meta_data->>'org','Mi taller')) returning id into o; r := 'admin';
  else r := coalesce(nullif(new.raw_app_meta_data->>'role','')::user_role,'lectura'); end if;
  insert into profiles(id,org_id,name,role) values(new.id,o,coalesce(new.raw_user_meta_data->>'name',new.email),r);
  return new; end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

-- Seguridad por fila: cada usuario solo ve y modifica datos de su taller; "lectura" no escribe
do $$ declare t text; begin
 foreach t in array array['models','variants','model_stage_progress','stage_history','clients','assignments','orders','order_items','suppliers','materials','lots','supplier_orders','inventory_movements','alerts','bloomie_messages'] loop
  execute format('alter table %I enable row level security',t);
  execute format('alter table %I alter column org_id set default current_org()',t);
  execute format('create policy sel on %I for select to authenticated using(org_id=current_org())',t);
  execute format('create policy ins on %I for insert to authenticated with check(org_id=current_org() and current_app_role()<>''lectura'')',t);
  execute format('create policy upd on %I for update to authenticated using(org_id=current_org() and current_app_role()<>''lectura'') with check(org_id=current_org())',t);
  execute format('create policy del on %I for delete to authenticated using(org_id=current_org() and current_app_role()<>''lectura'')',t);
 end loop; end $$;
alter table organizations enable row level security; alter table profiles enable row level security;
create policy org_sel on organizations for select to authenticated using(id=current_org());
create policy pr_sel on profiles for select to authenticated using(org_id=current_org());
create policy pr_upd on profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid() and org_id=current_org());

grant usage on schema public to authenticated;
grant select,insert,update,delete on all tables in schema public to authenticated;
revoke all on all tables in schema public from anon;
revoke update on profiles from authenticated; grant update(name) on profiles to authenticated; -- nadie cambia su propio rol
