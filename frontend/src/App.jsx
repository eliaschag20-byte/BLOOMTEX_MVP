import { useState, useEffect } from 'react';
const API = import.meta.env.VITE_API_URL || 'http://localhost:3000';
export async function api(path, body, method) {
  const t = localStorage.getItem('bt');
  const r = await fetch(API + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', ...(t && { Authorization: 'Bearer ' + t }) }, body: body && JSON.stringify(body) });
  if (r.status === 204) return null; const j = await r.json();
  if (r.status === 401) localStorage.removeItem('bt'); if (!r.ok) throw new Error(j.message || 'Error'); return j;
}
const box = { background: '#fff', border: '1px solid #E9E2D0', borderRadius: 14, padding: 20 };
const inp = { width: '100%', padding: 10, margin: '6px 0 12px', border: '1px solid #E9E2D0', borderRadius: 9, font: 'inherit', boxSizing: 'border-box' };
const btn = { background: '#8B5CF6', color: '#fff', border: 0, borderRadius: 9, padding: '10px 16px', font: '600 14px Inter', cursor: 'pointer' };

function Login({ onAuth }) {
  const [reg, setReg] = useState(false), [f, setF] = useState({}), [e, setE] = useState('');
  const set = k => ev => setF({ ...f, [k]: ev.target.value });
  const go = async ev => { ev.preventDefault(); setE('');
    try { const r = await api(reg ? '/v1/auth/register' : '/v1/auth/login', f); localStorage.setItem('bt', r.token); onAuth(r.user); } catch (x) { setE(x.message); } };
  return (<form onSubmit={go} style={{ ...box, maxWidth: 380, margin: '10vh auto' }}>
    <h1 style={{ font: '800 26px Montserrat' }}>BLOOMTEX</h1><p style={{ color: '#6B7280' }}>{reg ? 'Crea la cuenta de tu taller' : 'Ingresa a tu taller'}</p>
    {reg && <><label>Taller</label><input style={inp} onChange={set('org')} required /><label>Tu nombre</label><input style={inp} onChange={set('name')} required /></>}
    <label>Correo</label><input style={inp} type="email" onChange={set('email')} required />
    <label>Clave</label><input style={inp} type="password" minLength={8} onChange={set('password')} required />
    {e && <p style={{ background: '#FDE4E4', color: '#D9363E', padding: 10, borderRadius: 9 }}>{e}</p>}
    <button style={btn}>{reg ? 'Crear cuenta' : 'Entrar'}</button>{' '}
    <button type="button" onClick={() => setReg(!reg)} style={{ ...btn, background: 'none', color: '#6D3FD6' }}>{reg ? 'Ya tengo cuenta' : 'Crear cuenta'}</button>
  </form>);
}
function Home({ user, onOut }) {
  const [d, setD] = useState(null), [q, setQ] = useState(''), [a, setA] = useState('');
  useEffect(() => { api('/v1/dashboard').then(setD).catch(() => onOut()); }, []);
  const ask = async ev => { ev.preventDefault(); setA('…'); try { setA((await api('/v1/bloomie/messages', { message: q })).answer); } catch (x) { setA(x.message); } };
  return (<div style={{ maxWidth: 800, margin: '0 auto', padding: 20 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between' }}><b style={{ font: '800 22px Montserrat' }}>BLOOMTEX</b><button style={btn} onClick={onOut}>Salir</button></div>
    <p>Aquí van el Panel, Modelos, Pedidos, Clientes, Proveedores e Inventario (ver README → Siguiente paso).</p>
    <pre style={box}>{d ? JSON.stringify(d, null, 2) : 'Cargando…'}</pre>
    <form onSubmit={ask} style={box}><b>BLOOMIE</b><input style={inp} value={q} onChange={e => setQ(e.target.value)} placeholder="¿Tienes alguna duda sobre la producción?" /><button style={btn}>Preguntar</button><p style={{ whiteSpace: 'pre-line' }}>{a}</p></form>
  </div>);
}
export default function App() {
  const [u, setU] = useState(() => localStorage.getItem('bt') ? { role: 'sesión' } : null);
  return u ? <Home user={u} onOut={() => { localStorage.removeItem('bt'); setU(null); }} /> : <Login onAuth={setU} />;
}
