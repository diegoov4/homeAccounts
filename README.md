# 🏡 Gastos de Casa

Aplicación web para gestionar los gastos de la familia y la **cuenta común**: colegio, niños, supermercado, cenas fuera, luz, agua, gas, hipoteca, coche… cada categoría con su icono, su color y, si quieres, su presupuesto mensual. Calcula si lo que aportáis a la cuenta común es suficiente y lleva la cuenta de lo que alguien paga con su propio dinero.

Funciona en **Cloudflare Workers** con la base de datos **Cloudflare D1**, así que todos los móviles de la familia ven los mismos datos. Se entra con **la cuenta de Google** de cada uno.

## Qué hace

- **Gastos en segundos**: ➕ → importe → categoría → listo. Puedes indicar si se pagó desde la **cuenta común** o si lo pagó **alguien por su cuenta**.
- **Ingresos / aportaciones** a la cuenta común: quién ingresa y cuánto. Cada miembro puede tener una **aportación fija mensual**, que se registra con un toque cada mes.
- **Cuenta común** (pestaña 🏦):
  - **¿Llega con lo que aportamos?**: aportado vs. gastos de la familia del mes o del año, con lo que sobra o falta.
  - **Previsión del mes** en curso según la media de los últimos 3 meses.
  - **Saldo de la cuenta común** (con saldo inicial configurable), entradas y salidas del periodo.
  - **Pendiente de devolver**: lo que cada uno ha pagado por su cuenta y aún no se le ha devuelto, con botón para devolverlo desde la cuenta común.
  - **¿Quién pone qué?**: aportaciones + pagos por su cuenta de cada miembro, en porcentaje.
  - **¿Cuánto deberíamos aportar?**: compara la aportación fija con el gasto medio y propone cuánto debería poner cada uno.
  - Gráfico de **aportado vs. gastos** de los últimos meses.
- **Resumen visual** por mes o por año: total, media diaria, comparación con el periodo anterior, presupuesto, totales por grupo, gráfico circular, desglose por categoría y evolución.
- **Movimientos**: gastos e ingresos por día, con buscador y filtros (Todo · Gastos · Ingresos · Por su cuenta · categoría).
- **Categorías personalizables** (nombre, icono, color, grupo y presupuesto).
- Copias de seguridad (JSON), exportación a Excel (CSV), datos de ejemplo, modo oscuro, instalable en el móvil (PWA).

### Cómo se calcula

| Concepto | Cálculo |
|---|---|
| Gastos de la familia | Todos los gastos del periodo, se pagaran como se pagaran |
| Aportado | Todos los ingresos a la cuenta común del periodo |
| ¿Llega? | Aportado − gastos de la familia |
| Saldo de la cuenta común | Saldo inicial + todos los ingresos − gastos pagados desde la cuenta (incluidos los devueltos) |
| Pendiente de devolver | Gastos pagados por alguien por su cuenta y no marcados como devueltos |

## Inicio de sesión con Google

- Botón **«Entrar con Google»**; la sesión dura 30 días en cada dispositivo.
- Solo entran las cuentas autorizadas:
  - las de la lista fija `ALLOWED_EMAILS` (secreto del Worker), y
  - las de los **miembros** que tengan su email puesto en *Ajustes → Familia*. Así se invita a alguien sin tocar la configuración, y si se le quita el email pierde el acceso al momento.
- Nadie puede quitarse a sí mismo el acceso por error (salvo que esté en `ALLOWED_EMAILS`).
- Seguridad: flujo OAuth con PKCE, `state` y `nonce`; cookie de sesión `HttpOnly`, `Secure`, `SameSite=Lax`; en D1 solo se guarda el hash de la sesión; las escrituras desde otro origen se rechazan.

## Puesta en marcha (Cloudflare)

Necesitas una cuenta de Cloudflare (el plan gratuito sirve), una cuenta de Google y Node.js 18 o superior.

### 1. Crea las credenciales de Google

1. Entra en [Google Cloud Console](https://console.cloud.google.com/) y crea un proyecto (por ejemplo «Gastos de Casa»).
2. *APIs y servicios → Pantalla de consentimiento de OAuth*: tipo **Externo**, pon el nombre de la app y tu email. En *Usuarios de prueba* añade los emails de la familia (o publica la app).
3. *APIs y servicios → Credenciales → Crear credenciales → ID de cliente de OAuth* → **Aplicación web**.
4. En **URI de redirección autorizados** añade:
   - `https://casitafeliz.diemo.dev/auth/callback` (el dominio de la app; la dirección *.workers.dev redirige a él)
   - `http://localhost:8787/auth/callback` (para desarrollo)
5. Guarda el **ID de cliente** y el **secreto de cliente**.

### 2. Publica en Cloudflare

```bash
npm install
npx wrangler login                  # inicia sesión en Cloudflare

npm run db:migrate                  # crea las tablas y las categorías por defecto
npm run secrets                     # pide GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET y ALLOWED_EMAILS
#   ALLOWED_EMAILS = emails separados por comas, p. ej.: tu.email@gmail.com,pareja@gmail.com
npm run deploy                      # publica → https://casitafeliz.diemo.dev
```

Abre la URL en el móvil, pulsa **Entrar con Google** y usa «Añadir a pantalla de inicio». Después, en *Ajustes → Familia*, pon a cada miembro su email de Google.

### Desarrollo en local

```bash
cp .dev.vars.example .dev.vars      # rellena las credenciales de Google y ALLOWED_EMAILS
npm run db:migrate:local            # base de datos D1 local
npm run dev                         # http://localhost:8787
```

## Pruebas automáticas

```bash
npm test             # pruebas de extremo a extremo: Worker local + D1 vacía + Google simulado + navegador
npm run test:smoke   # pruebas rápidas contra la app publicada
npm run release      # pruebas → migraciones en D1 → despliegue → pruebas de la app publicada
```

`npm test` necesita Playwright con Chromium (`npm i -D playwright && npx playwright install chromium`). Comprueba el inicio de sesión (cuentas autorizadas y no autorizadas, `state`/`nonce` manipulados), gastos e ingresos, la cuenta común y las devoluciones, el acceso de los miembros, la protección CSRF, las cabeceras de seguridad y que el diseño no se desborde en el móvil.

## API

Todas las rutas `/api/*` necesitan sesión iniciada (cookie). Los importes van en **céntimos**.

Rutas de sesión: `GET /auth/login`, `GET /auth/callback`, `POST /auth/logout`.

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/data` | Todos los datos (ajustes, miembros, categorías, gastos, ingresos) y el usuario (`me`) |
| GET | `/api/me` | Usuario con sesión iniciada |
| PUT | `/api/expenses/:id` · `/api/incomes/:id` · `/api/categories/:id` · `/api/members/:id` | Crear o actualizar |
| DELETE | `/api/expenses/:id` · `/api/incomes/:id` · `/api/members/:id` | Borrar (un miembro con movimientos no se puede borrar) |
| DELETE | `/api/categories/:id?move_to=otros` | Borrar categoría moviendo sus gastos |
| PUT | `/api/settings` | `{ currency, initial_balance }` |
| POST | `/api/reimburse` | `{ member_id }` marca como devuelto todo lo pendiente de un miembro |
| POST | `/api/import` | Sustituye todos los datos (copias de seguridad) |

## Estructura

```
public/               App web (HTML, CSS, JS, iconos, PWA)
src/worker.js         Worker de Cloudflare: API
src/auth.js           Inicio de sesión con Google y sesiones
src/static.js         Sirve los archivos de public/ (se incluyen dentro del Worker)
scripts/              embed-static.mjs: empaqueta public/ antes de cada deploy/dev
tests/                Pruebas automáticas (e2e y smoke)
migrations/           Esquema y datos iniciales de D1
wrangler.toml         Configuración de Cloudflare
```
