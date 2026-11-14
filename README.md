# 🏡 Gastos de Casa

Aplicación web sencilla y visual para gestionar los gastos de la familia: colegio, niños, supermercado, cenas fuera, luz, agua, gas, hipoteca, coche… cada categoría con su icono, su color y, si quieres, su presupuesto mensual.

## Qué hace

- **Añadir gastos en segundos**: botón ➕ → importe → toca la categoría → listo. Fecha (hoy por defecto), nota y quién ha pagado son opcionales.
- **Resumen visual** por mes o por año:
  - Total gastado, media diaria y comparación con el periodo anterior.
  - Barra de presupuesto global (suma de los presupuestos de las categorías).
  - Totales por **grupo** (Hogar, Alimentación, Niños, Transporte, Personal, Otros).
  - Gráfico circular «¿En qué se va el dinero?».
  - Desglose por categoría con % del total y avisos ⚠️ si te pasas del presupuesto.
  - Evolución de los últimos 6 meses (o los 12 meses del año).
- **Listado de gastos** agrupado por día, con buscador y filtro por categoría. Toca un gasto para editarlo o borrarlo (con «Deshacer»).
- **Categorías personalizables**: nombre, icono (emoji), color, grupo y presupuesto mensual. Puedes crear, editar y borrar categorías. Si borras una que tiene gastos, sus gastos pasan a «Otros».
- **Familia**: añade a los miembros (Mamá, Papá…) para apuntar quién paga cada gasto.
- **Copias de seguridad**: exporta/importa en JSON y exporta a CSV para abrirlo en Excel.
- **Datos de ejemplo** para probar la app.
- Modo oscuro automático, pensada para el móvil, **instalable** (PWA) y funciona **sin conexión**.

## Categorías incluidas

| Grupo | Categorías |
|---|---|
| Hogar | 🏠 Casa / Hipoteca · 💡 Luz · 💧 Agua · 🔥 Gas / Calefacción · 📶 Internet y móvil · 🛡️ Seguros |
| Alimentación | 🛒 Supermercado · 🍽️ Cenas fuera |
| Niños | 🎒 Colegio · 🧸 Gastos niños · ⚽ Extraescolares |
| Transporte | 🚗 Coche y transporte |
| Personal | 💊 Salud · 👕 Ropa · 🎬 Ocio y viajes |
| Otros | 🐾 Mascotas · 📦 Otros |

## Cómo usarla

No necesita instalación ni dependencias: son archivos estáticos (HTML, CSS y JavaScript).

```bash
# En local
python3 -m http.server 8000
# y abre http://localhost:8000
```

Para tenerla en el móvil, publícala gratis con **GitHub Pages** (Settings → Pages → rama `main`, carpeta `/`) y, desde el navegador del móvil, usa «Añadir a pantalla de inicio».

## Dónde se guardan los datos

En el propio navegador (`localStorage`) del dispositivo. Cada móvil tiene sus propios datos: para pasarlos de uno a otro usa **Ajustes → Exportar / Importar**.

> Siguiente paso posible: sincronizar entre los móviles de la familia con un backend (por ejemplo Supabase o Firebase).

## Estructura

```
index.html            Página principal
css/styles.css        Estilos (claro/oscuro, móvil primero)
js/app.js             Lógica de la app
manifest.webmanifest  Datos para instalarla como app
sw.js                 Service worker (modo sin conexión)
icons/                Iconos de la app
```
