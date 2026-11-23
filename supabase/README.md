# BLOOMTEX en Supabase (base de datos + login) y conexión con GitHub

## 1. Crear la base (5 min)
1. En supabase.com crea un proyecto (región São Paulo es la más cercana a Paraguay). Guarda la clave de base de datos.
2. **SQL Editor → New query**: pega `supabase/migrations/20261123000000_bloomtex_schema.sql` y pulsa **Run**.
3. **Authentication → Providers → Email**: para la demo desactiva *Confirm email*.
4. **Authentication → Users → Add user**: crea tu usuario (correo + clave). Un trigger crea tu taller y te deja como `admin`.
5. **SQL Editor**: pega `supabase/seed.sql`, cambia `TU_CORREO@ejemplo.com` por el tuyo y ejecuta. Cargará modelos, clientes, pedidos, proveedores e inventario de ejemplo, con alertas de stock bajo.

## 2. Conectar con GitHub (elige una)
**A. Integración oficial (más simple):** Supabase → *Project Settings → Integrations → GitHub* → conecta el repo `BLOOMTEX_MVP`, directorio `supabase`, rama `main`, activa *Deploy to production*. Cada cambio en `supabase/migrations/` se aplica solo.

**B. GitHub Actions (incluido en `.github/workflows/supabase.yml`):** en GitHub → *Settings → Secrets and variables → Actions* crea:
- `SUPABASE_ACCESS_TOKEN` (supabase.com/dashboard/account/tokens)
- `SUPABASE_DB_PASSWORD` (la clave del paso 1)
- `SUPABASE_PROJECT_ID` (Project Settings → General → Reference ID)

Para cambios futuros crea un archivo nuevo `supabase/migrations/AAAAMMDDHHMMSS_descripcion.sql`; no edites el primero.

## 3. Claves para el frontend
*Project Settings → API*: copia **Project URL** y **anon public key** (son públicas; la seguridad la dan las políticas RLS). **Nunca** pongas la `service_role` en el repo ni en el navegador.

## Roles
`admin` (primer usuario de cada taller), `produccion`, `comercial`, `lectura` (no escribe). Invitar usuarios a un taller existente requiere la API admin con `app_metadata {"org_id","role"}`; el usuario no puede falsificarlo.

## Estado
El esquema, RLS, login y datos de ejemplo están listos. Falta conectar la interfaz con `supabase-js` (la demo de `site/` guarda en el navegador, no en Supabase).
