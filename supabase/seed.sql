-- Datos de ejemplo (taller de confección paraguayo). Ejecutar en SQL Editor DESPUÉS de crear tu usuario.
-- Cambia el correo por el tuyo.
do $$ declare o uuid; begin
 select p.org_id into o from profiles p join auth.users u on u.id=p.id where u.email='TU_CORREO@ejemplo.com';
 if o is null then raise exception 'No encontré ese usuario: créalo primero y revisa el correo.'; end if;

 insert into models(org_id,code,name,season,stage,total_qty) values
  (o,'BL-101','Remera básica algodón','Verano 27',3,2400),(o,'BL-102','Pantalón jogger','Verano 27',2,1500),
  (o,'BL-103','Short deportivo','Verano 27',5,3000),(o,'BL-104','Campera rompeviento','Invierno 27',1,800),
  (o,'BL-105','Vestido lino','Verano 27',4,1200),(o,'BL-106','Polera polar','Invierno 27',0,900);
 insert into clients(org_id,name,country,type) values (o,'Moda Sul','Brasil','Marca'),(o,'Tienda Palermo','Argentina','Distribuidor'),(o,'Distribuidora Asunción','Paraguay','Distribuidor');
 insert into assignments(org_id,model_id,client_id,qty,delivery_status)
  select o,m.id,c.id,v.q,v.s from (values('BL-101','Moda Sul',2000,'parcial'),('BL-102','Distribuidora Asunción',1500,'pendiente'),('BL-103','Tienda Palermo',2600,'pendiente'),('BL-104','Tienda Palermo',400,'pendiente'),('BL-105','Moda Sul',1200,'pendiente')) v(code,cl,q,s)
  join models m on m.org_id=o and m.code=v.code join clients c on c.org_id=o and c.name=v.cl;
 update models set delayed=true, delay_reason='Falta de hilo' where org_id=o and code='BL-102';
 insert into model_stage_progress(org_id,model_id,stage,done_qty)
  select o,m.id,v.st,v.q from (values('BL-101','corte',2400),('BL-101','costura',1500),('BL-101','acabado',600),('BL-102','corte',900),('BL-103','corte',3000),('BL-103','costura',3000),('BL-103','acabado',2900),('BL-103','calidad',2200),('BL-105','corte',1200),('BL-105','costura',1200),('BL-105','acabado',700)) v(code,st,q)
  join models m on m.org_id=o and m.code=v.code;
 insert into orders(org_id,code,client_id,status,due_date,delayed)
  select o,v.code,c.id,v.st,current_date+v.d,v.r from (values('P-0412','Moda Sul',2,12,false),('P-0413','Tienda Palermo',2,19,false),('P-0409','Distribuidora Asunción',2,-5,true),('P-0415','Moda Sul',1,27,false)) v(code,cl,st,d,r)
  join clients c on c.org_id=o and c.name=v.cl;
 insert into order_items(org_id,order_id,model_id,qty,done_cut,done_sew,done_finish,done_pack)
  select o,od.id,m.id,v.q,v.c,v.s,v.a,v.p from (values('P-0412','BL-101',1200,1200,900,300,0),('P-0413','BL-103',2600,2600,2600,2400,1800),('P-0409','BL-102',1500,900,0,0,0),('P-0415','BL-105',1200,600,0,0,0)) v(oc,mc,q,c,s,a,p)
  join orders od on od.org_id=o and od.code=v.oc join models m on m.org_id=o and m.code=v.mc;

 insert into suppliers(org_id,name,contact,materials) values (o,'Textiles del Guairá','Villarrica','Tela jersey, lino'),(o,'Hilos Itauguá','Itauguá','Hilo poliéster'),(o,'Insumos Ñemby','Ñemby','Elástico, botones'),(o,'Cierres Cerro Corá','Asunción','Cierres, etiquetas'),(o,'Etiquetas Luque','Luque','Etiquetas');
 insert into materials(org_id,name,unit,min_stock) values (o,'Tela jersey','m',1500),(o,'Tela lino','m',600),(o,'Hilo poliéster','kg',40),(o,'Elástico 3 cm','m',3000),(o,'Botones','un',2000),(o,'Etiquetas','un',4000);
 insert into supplier_orders(org_id,supplier_id,material_id,qty,status,promised_date,actual_date,quality_pct,fulfilled_pct)
  select o,s.id,mt.id,v.q,v.st,current_date+v.pd,case when v.st='entregado' then current_date+v.ad end,v.qa,v.f
  from (values('Textiles del Guairá','Tela jersey',3000,'entregado',-12,-12,92,98),('Textiles del Guairá','Tela lino',800,'entregado',-30,-31,92,98),('Hilos Itauguá','Hilo poliéster',100,'retrasado',-8,0,90,78),('Insumos Ñemby','Botones',5000,'en_transito',2,0,85,90),('Cierres Cerro Corá','Etiquetas',3000,'bloqueado',-3,0,80,65),('Etiquetas Luque','Etiquetas',4000,'entregado',-20,-21,99,100)) v(sn,mn,q,st,pd,ad,qa,f)
  join suppliers s on s.org_id=o and s.name=v.sn join materials mt on mt.org_id=o and mt.name=v.mn;
 -- el trigger crea solo las alertas de stock bajo (lino, hilo, botones)
 insert into inventory_movements(org_id,material_id,kind,qty,note)
  select o,mt.id,'in',v.q,'Stock inicial' from (values('Tela jersey',1800),('Tela lino',420),('Hilo poliéster',35),('Elástico 3 cm',5200),('Botones',900),('Etiquetas',9000)) v(n,q) join materials mt on mt.org_id=o and mt.name=v.n;
end $$;
