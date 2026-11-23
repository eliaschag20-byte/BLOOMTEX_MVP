# BLOOMTEX · MVP de producción textil

Control de producción para talleres de confección (Paraguay): modelos con Kanban, pedidos, clientes, proveedores, inventario y el asistente BLOOMIE.

## Arquitectura
```
Navegador (React + Vite, Vercel)
   │  HTTPS + JWT (Authorization: Bearer)
   ▼
API Node/Express (Render / Cloud Run)  ──►  Claude API (BLOOMIE, con herramientas)
   │  cada request = 1 transacción con set_config('app.org_id')
   ▼
PostgreSQL (local con Docker  |  Supabase)  — RLS por organización
```
- **Login:** `POST /v1/auth/register` (crea taller + admin) y `POST /v1/auth/login` (JWT de 12 h). Roles: `admin`, `produccion`, `comercial`, `lectura`.
- **Aislamiento:** toda tabla lleva `org_id`; RLS forzada. La API se conecta con el rol `bloomtex_app` (no superusuario), por eso RLS aplica.
- **Stock:** suma de `inventory_movements`; un trigger crea la alerta de stock bajo. **Avance:** cantidades por etapa en `model_stage_progress`.
- **BLOOMIE:** Claude llama herramientas que consultan solo datos de tu organización.

## Correr en local
```bash
docker compose up -d                       # Postgres + esquema (db/schema.sql)
cd backend && cp .env.example .env && npm install && npm run dev      # API en :3000
cd ../frontend && cp .env.example .env && npm install && npm run dev  # Web en :5173
```
Sin Docker: crea una base `bloomtex` y ejecuta `psql -d bloomtex -f db/schema.sql`. Abre http://localhost:5173, pulsa **Crear cuenta** y entra. Para BLOOMIE completa `ANTHROPIC_API_KEY` en `backend/.env`.

## Conectar con Supabase (persistencia en la nube)
1. Crea un proyecto en supabase.com. En **SQL Editor** pega y ejecuta `db/schema.sql`.
2. Cambia la clave del rol: `alter role bloomtex_app password 'UNA_CLAVE_FUERTE';`
3. En **Project Settings → Database → Connection string (pooler, modo transaction)** copia la URL y usa usuario `bloomtex_app.<project-ref>` con su clave como `DATABASE_URL`; pon `DB_SSL=true`.
4. El acceso a datos es solo por tu backend: no uses la API REST pública de Supabase para estas tablas.

## Subir a GitHub y desplegar
```bash
git init && git add . && git commit -m "BLOOMTEX MVP"
git branch -M main && git remote add origin https://github.com/TU_USUARIO/bloomtex.git && git push -u origin main
```
- **Frontend (Vercel):** importa el repo, carpeta `frontend`, variable `VITE_API_URL`.
- **Backend (Render/Cloud Run):** carpeta `backend`, comando `npm start`, variables de `.env.example` (nunca subas `.env`).
- `.github/workflows/ci.yml` valida backend y frontend en cada push.

## API (v1)
`/auth/register · /auth/login · /users` · CRUD `/models /clients /assignments /orders /order_items /suppliers /supplier_orders /materials` · `PATCH /models/:id/stage` (avanza o retrocede) · `PUT|GET /models/:id/progress` · `POST /inventory-movements` · `GET /inventory /alerts /dashboard /suppliers/:id/scorecard?we=40&wq=35&wc=25` · `POST /bloomie/messages`

## MVP vs. Fase 2
- **Hecho (base):** esquema, RLS, login/roles, API, lógica de etapas/stock/alertas, BLOOMIE con herramientas.
- **Siguiente paso:** pantallas React completas (la demo HTML es la guía visual), datos de ejemplo, variantes color/talla en la UI, pruebas automáticas.
- **Fase 2:** trazabilidad de lotes en reportes de exportación, notificaciones, facturación electrónica, ERPs. Fuera del MVP: marketplace, app nativa, multi-almacén, nómina.

## Demo en GitHub Pages
La carpeta `site/` contiene la demo (HTML único con login, búsqueda y guardado en el navegador). El workflow `.github/workflows/pages.yml` la publica en cada push a `main`.
1. Sube este proyecto a `https://github.com/TU_USUARIO/BLOOMTEX_MVP` (repo público).
2. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Haz un push (o **Actions → Publicar demo → Run workflow**). La URL queda en `https://TU_USUARIO.github.io/BLOOMTEX_MVP/`.
Cuenta demo: `demo@bloomtex.com` / `bloomtex2026` (es solo una demo: no protege datos reales).

## Supabase
Ver `supabase/README.md` (migración SQL, datos de ejemplo, conexión con GitHub). La alternativa con backend propio y Postgres local sigue en `db/` + `backend/`.
