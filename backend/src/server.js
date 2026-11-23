import express from 'express'; import cors from 'cors'; import pg from 'pg'; import bcrypt from 'bcryptjs'; import jwt from 'jsonwebtoken'; import Anthropic from '@anthropic-ai/sdk';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false });
const app = express(); app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') || true })); app.use(express.json());
const SECRET = process.env.JWT_SECRET;
const err = (status, message) => Object.assign(new Error(message), { status });
const wrap = f => (q, s, n) => f(q, s, n).catch(e => { if (!e.status) console.error(e); s.status(e.status || 500).json({ code: e.code || 'error', message: e.message }); });

// Toda consulta de datos corre dentro de una transacción con la organización fijada (RLS)
async function tx(org, fn) {
  const c = await pool.connect();
  try { await c.query('begin'); await c.query("select set_config('app.org_id',$1,true)", [org]); const r = await fn(c); await c.query('commit'); return r; }
  catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
}
const sign = u => jwt.sign({ id: u.id, org: u.org_id, role: u.role }, SECRET, { expiresIn: '12h' });
const auth = (q, s, n) => { try { q.u = jwt.verify((q.headers.authorization || '').slice(7), SECRET); n(); } catch { s.status(401).json({ code: 'unauthorized', message: 'Sesión inválida' }); } };
const can = (...roles) => (q, s, n) => (q.u.role === 'admin' || roles.includes(q.u.role)) ? n() : s.status(403).json({ code: 'forbidden', message: 'Sin permiso' });

// ---- Auth ----
app.post('/v1/auth/register', wrap(async (q, s) => { // crea organización + admin
  const { org, name, email, password } = q.body; if (!org || !email || !(password?.length >= 8)) throw err(400, 'Datos inválidos (clave mínima 8)');
  const c = await pool.connect();
  try { await c.query('begin');
    const o = (await c.query('insert into organizations(name) values($1) returning id', [org])).rows[0];
    const u = (await c.query("insert into users(org_id,email,name,password_hash,role) values($1,lower($2),$3,$4,'admin') returning *", [o.id, email, name, await bcrypt.hash(password, 10)])).rows[0];
    await c.query('commit'); s.status(201).json({ token: sign(u), user: { name: u.name, email: u.email, role: u.role } });
  } catch (e) { await c.query('rollback'); throw e.code === '23505' ? err(409, 'Ese correo ya existe') : e; } finally { c.release(); }
}));
app.post('/v1/auth/login', wrap(async (q, s) => {
  const u = (await pool.query('select * from users where email=lower($1)', [q.body.email || ''])).rows[0];
  if (!u || !(await bcrypt.compare(q.body.password || '', u.password_hash))) throw err(401, 'Correo o clave incorrectos');
  s.json({ token: sign(u), user: { name: u.name, email: u.email, role: u.role } });
}));
app.post('/v1/users', auth, can(), wrap(async (q, s) => { // el admin invita usuarios con rol
  const { name, email, password, role } = q.body;
  const r = await pool.query('insert into users(org_id,email,name,password_hash,role) values($1,lower($2),$3,$4,$5) returning id,email,name,role', [q.u.org, email, name, await bcrypt.hash(password, 10), role || 'lectura']);
  s.status(201).json(r.rows[0]);
}));

// ---- CRUD genérico (columnas permitidas + roles que pueden escribir) ----
const R = {
  models: [['code', 'name', 'season', 'image_url', 'total_qty', 'assigned_qty', 'delayed', 'delay_reason'], ['produccion']],
  clients: [['name', 'country', 'type'], ['comercial']],
  assignments: [['model_id', 'client_id', 'qty', 'delivery_status'], ['comercial']],
  orders: [['code', 'client_id', 'status', 'due_date', 'delayed', 'delay_reason'], ['comercial', 'produccion']],
  order_items: [['order_id', 'model_id', 'qty', 'done_cut', 'done_sew', 'done_finish', 'done_pack'], ['comercial', 'produccion']],
  suppliers: [['name', 'contact', 'materials'], ['produccion']],
  supplier_orders: [['supplier_id', 'material_id', 'qty', 'status', 'promised_date', 'actual_date', 'quality_pct', 'fulfilled_pct'], ['produccion']],
  materials: [['name', 'unit', 'min_stock'], ['produccion']],
};
const RX = Object.keys(R).join('|');
const wr = (q, s, n) => can(...R[q.params.r][1])(q, s, n);
const pick = (r, b) => R[r][0].filter(k => k in b);
app.get(`/v1/:r(${RX})`, auth, wrap(async (q, s) => s.json(await tx(q.u.org, c => c.query(`select * from ${q.params.r} order by 1`).then(r => r.rows)))));
app.post(`/v1/:r(${RX})`, auth, wr, wrap(async (q, s) => {
  const k = pick(q.params.r, q.body);
  s.status(201).json(await tx(q.u.org, c => c.query(`insert into ${q.params.r}(org_id,${k}) values($1,${k.map((_, i) => '$' + (i + 2))}) returning *`, [q.u.org, ...k.map(x => q.body[x])]).then(r => r.rows[0])));
}));
app.patch(`/v1/:r(${RX})/:id`, auth, wr, wrap(async (q, s) => {
  const k = pick(q.params.r, q.body); if (!k.length) throw err(400, 'Nada para actualizar');
  const r = await tx(q.u.org, c => c.query(`update ${q.params.r} set ${k.map((x, i) => `${x}=$${i + 2}`)} where id=$1 returning *`, [q.params.id, ...k.map(x => q.body[x])]));
  r.rows[0] ? s.json(r.rows[0]) : s.status(404).json({ code: 'not_found', message: 'No encontrado' });
}));
app.delete(`/v1/:r(${RX})/:id`, auth, wr, wrap(async (q, s) => { await tx(q.u.org, c => c.query(`delete from ${q.params.r} where id=$1`, [q.params.id])); s.status(204).end(); }));

// ---- Lógica de producción ----
app.patch('/v1/models/:id/stage', auth, can('produccion'), wrap(async (q, s) => { // avanzar o retroceder
  const to = +q.body.to; if (!(to >= 0 && to <= 7)) throw err(400, 'Etapa inválida');
  s.json(await tx(q.u.org, async c => {
    const m = (await c.query('select stage from models where id=$1 for update', [q.params.id])).rows[0]; if (!m) throw err(404, 'No encontrado');
    await c.query('insert into stage_history(org_id,model_id,from_stage,to_stage,user_id) values($1,$2,$3,$4,$5)', [q.u.org, q.params.id, m.stage, to, q.u.id]);
    return (await c.query('update models set stage=$2 where id=$1 returning *', [q.params.id, to])).rows[0];
  }));
}));
app.put('/v1/models/:id/progress', auth, can('produccion'), wrap(async (q, s) => { // {corte:2400, costura:1500, ...}
  await tx(q.u.org, async c => { for (const [st, n] of Object.entries(q.body)) if (['corte', 'costura', 'acabado', 'calidad', 'empaque'].includes(st))
    await c.query('insert into model_stage_progress(org_id,model_id,stage,done_qty) values($1,$2,$3,$4) on conflict(model_id,stage) do update set done_qty=$4', [q.u.org, q.params.id, st, +n]); });
  s.status(204).end(); }));
app.get('/v1/models/:id/progress', auth, wrap(async (q, s) => s.json(await tx(q.u.org, c => c.query(
  `select p.stage, p.done_qty, m.total_qty, round(100.0*least(p.done_qty,m.total_qty)/nullif(m.total_qty,0)) as pct from model_stage_progress p join models m on m.id=p.model_id where m.id=$1`, [q.params.id]).then(r => r.rows)))));
app.post('/v1/inventory-movements', auth, can('produccion'), wrap(async (q, s) => { // el trigger crea la alerta de stock bajo
  const { material_id, kind, qty, lot_id, model_id, note } = q.body;
  s.status(201).json(await tx(q.u.org, c => c.query('insert into inventory_movements(org_id,material_id,kind,qty,lot_id,model_id,note,user_id) values($1,$2,$3,$4,$5,$6,$7,$8) returning *', [q.u.org, material_id, kind, qty, lot_id, model_id, note, q.u.id]).then(r => r.rows[0])));
}));
app.get('/v1/inventory', auth, wrap(async (q, s) => s.json(await tx(q.u.org, c => c.query('select *, stock<min_stock as low from material_stock order by name').then(r => r.rows)))));
app.get('/v1/alerts', auth, wrap(async (q, s) => s.json(await tx(q.u.org, c => c.query('select * from alerts where not resolved order by created_at desc').then(r => r.rows)))));
app.get('/v1/suppliers/:id/scorecard', auth, wrap(async (q, s) => { // pesos: ?we=40&wq=35&wc=25
  const [we, wq, wc] = [q.query.we ?? 40, q.query.wq ?? 35, q.query.wc ?? 25].map(Number);
  const r = await tx(q.u.org, c => c.query(`select count(*) as orders,
    coalesce(100.0*avg((actual_date<=promised_date)::int) filter(where status='entregado'),0) as entrega, coalesce(avg(quality_pct),0) as calidad, coalesce(avg(fulfilled_pct),0) as cumplimiento
    from supplier_orders where supplier_id=$1`, [q.params.id]));
  const x = r.rows[0]; s.json({ ...x, score: Math.round((x.entrega * we + x.calidad * wq + x.cumplimiento * wc) / (we + wq + wc || 1)) });
}));
app.get('/v1/dashboard', auth, wrap(async (q, s) => s.json(await tx(q.u.org, async c => {
  const one = async sql => (await c.query(sql)).rows;
  return { modelos_por_etapa: await one('select stage, count(*)::int n from models group by 1 order by 1'),
    retrasos: (await one("select (select count(*) from models where delayed)::int + (select count(*) from orders where delayed or (due_date<current_date and status<4))::int n"))[0].n,
    materiales_criticos: await one('select name, stock, min_stock, unit from material_stock where stock<min_stock'),
    entregas_semana: await one("select code, due_date from orders where due_date between current_date and current_date+7 and status<4 order by due_date"),
    proveedores_problemas: await one("select s.name, o.status from supplier_orders o join suppliers s on s.id=o.supplier_id where o.status in('retrasado','bloqueado') or (o.status<>'entregado' and o.promised_date<current_date)") };
}))));

// ---- BLOOMIE: Claude consulta datos reales de la organización mediante herramientas ----
const TOOLS = [
  { name: 'materiales_bajo_minimo', description: 'Materiales con stock por debajo del mínimo', input_schema: { type: 'object', properties: {} } },
  { name: 'proveedores_retrasados', description: 'Pedidos a proveedores retrasados, bloqueados o vencidos', input_schema: { type: 'object', properties: {} } },
  { name: 'unidades_faltantes', description: 'Unidades que faltan por producir de un modelo (por código o nombre)', input_schema: { type: 'object', properties: { modelo: { type: 'string' } }, required: ['modelo'] } },
  { name: 'comprometido_cliente', description: 'Cantidad comprometida de un modelo con un cliente', input_schema: { type: 'object', properties: { cliente: { type: 'string' }, modelo: { type: 'string' } }, required: ['cliente'] } },
];
const RUN = {
  materiales_bajo_minimo: c => c.query('select name,stock,min_stock,unit from material_stock where stock<min_stock'),
  proveedores_retrasados: c => c.query("select s.name,o.status,o.promised_date from supplier_orders o join suppliers s on s.id=o.supplier_id where o.status in('retrasado','bloqueado') or (o.status<>'entregado' and o.promised_date<current_date)"),
  unidades_faltantes: (c, a) => c.query(`select m.code,m.name,m.total_qty, coalesce(p.done_qty,0) empacadas, m.total_qty-coalesce(p.done_qty,0) faltan from models m left join model_stage_progress p on p.model_id=m.id and p.stage='empaque' where m.code ilike $1 or m.name ilike $2`, [a.modelo, '%' + a.modelo + '%']),
  comprometido_cliente: (c, a) => c.query(`select cl.name cliente,m.code,a.qty,a.delivery_status from assignments a join clients cl on cl.id=a.client_id join models m on m.id=a.model_id where cl.name ilike $1 and ($2::text is null or m.code ilike $2 or m.name ilike '%'||$2||'%')`, ['%' + a.cliente + '%', a.modelo || null]),
};
const ai = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
app.post('/v1/bloomie/messages', auth, wrap(async (q, s) => {
  if (!ai) throw err(503, 'Falta ANTHROPIC_API_KEY');
  const msgs = [{ role: 'user', content: String(q.body.message || '').slice(0, 1000) }];
  const system = 'Eres BLOOMIE, asistente de producción textil de BLOOMTEX en Paraguay. Responde en español, breve y claro. Usa solo datos obtenidos con las herramientas; si no hay datos, dilo.';
  let text = '';
  for (let i = 0; i < 4; i++) {
    const r = await ai.messages.create({ model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5', max_tokens: 800, system, tools: TOOLS, messages: msgs });
    text = r.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
    if (r.stop_reason !== 'tool_use') break;
    msgs.push({ role: 'assistant', content: r.content });
    const results = await tx(q.u.org, async c => Promise.all(r.content.filter(b => b.type === 'tool_use').map(async b => ({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify((await RUN[b.name](c, b.input)).rows) }))));
    msgs.push({ role: 'user', content: results });
  }
  await tx(q.u.org, c => c.query("insert into bloomie_messages(org_id,user_id,role,content) values($1,$2,'user',$3),($1,$2,'assistant',$4)", [q.u.org, q.u.id, q.body.message, text]));
  s.json({ answer: text });
}));

app.get('/health', (q, s) => s.json({ ok: true }));
app.listen(process.env.PORT || 3000, () => console.log('BLOOMTEX API lista'));
