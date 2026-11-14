# 🏡 Gastos de Casa

Aplicación web para gestionar los gastos de la familia y la **cuenta común**: colegio, niños, supermercado, cenas fuera, luz, agua, gas, hipoteca, coche… cada categoría con su icono, su color y, si quieres, su presupuesto mensual. Calcula si lo que aportáis a la cuenta común es suficiente y lleva la cuenta de lo que alguien paga con su propio dinero.

Funciona en **Cloudflare Workers** con la base de datos **Cloudflare D1**, así que todos los móviles de la familia ven los mismos datos.

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

## Puesta en marcha (Cloudflare)

Necesitas una cuenta de Cloudflare (el plan gratuito sirve) y Node.js 18 o superior.

```bash
npm install
npx wrangler login                  # inicia sesión en Cloudflare

npm run db:create                   # crea la base de datos D1 "gastos-casa"
#   → copia el database_id que aparece y pégalo en wrangler.toml

npm run db:migrate                  # crea las tablas y las categorías por defecto
npm run secret                      # define la CLAVE FAMILIAR (FAMILY_KEY)
npm run deploy                      # publica la app → https://gastos-casa.<tu-subdominio>.workers.dev
```

Abre la URL en el móvil, escribe la clave familiar (solo la primera vez) y usa «Añadir a pantalla de inicio».

> 🔐 La clave familiar protege la API. Usa una clave larga. Si quieres más seguridad (inicio de sesión con email), pon la app detrás de **Cloudflare Access**.

### Desarrollo en local

```bash
cp .dev.vars.example .dev.vars      # define FAMILY_KEY para local
npm run db:migrate:local            # base de datos D1 local
npm run dev                         # http://localhost:8787
```

## API

Todas las rutas necesitan la cabecera `X-Family-Key`. Los importes van en **céntimos**.

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/data` | Todos los datos (ajustes, miembros, categorías, gastos, ingresos) |
| PUT | `/api/expenses/:id` · `/api/incomes/:id` · `/api/categories/:id` · `/api/members/:id` | Crear o actualizar |
| DELETE | `/api/expenses/:id` · `/api/incomes/:id` · `/api/members/:id` | Borrar (un miembro con movimientos no se puede borrar) |
| DELETE | `/api/categories/:id?move_to=otros` | Borrar categoría moviendo sus gastos |
| PUT | `/api/settings` | `{ currency, initial_balance }` |
| POST | `/api/reimburse` | `{ member_id }` marca como devuelto todo lo pendiente de un miembro |
| POST | `/api/import` | Sustituye todos los datos (copias de seguridad) |

## Estructura

```
public/               App web (HTML, CSS, JS, iconos, PWA)
src/worker.js         Worker de Cloudflare: API + archivos estáticos
migrations/           Esquema y datos iniciales de D1
wrangler.toml         Configuración de Cloudflare
```
