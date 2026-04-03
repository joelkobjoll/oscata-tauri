# Novedades de Oscata

## Versión 0.5.3 — 4 de abril de 2026

### 🔄 Metadatos de TMDB siempre visibles tras el indexado

Se corrige un problema de sincronización que podía hacer que los metadatos de TMDB (póster, valoración, géneros…) desaparecieran justo al terminar el indexado. Cuando Oscata cargaba la lista actualizada desde la base de datos, en ocasiones llegaba antes de que los datos de TMDB se hubieran escrito en disco, borrando lo que ya había en pantalla. Ahora la lista se fusiona con los datos en memoria, de modo que la información enriquecida permanece visible desde el primer momento.

---

## Versión 0.5.2 — 3 de abril de 2026

### 🎬 Filtro por códec de vídeo

Los filtros de la biblioteca ahora incluyen una sección de códec. Puedes quedarte solo con los títulos en HEVC/H.265, AVC/H.264, AV1 o VP9. Oscata normaliza los valores que venían del parser para que sean consistentes, y los existentes en la base de datos se actualizan automáticamente al arrancar.

### 📦 Tamaño de archivo visible

El peso de cada archivo aparece ahora en la tarjeta, en el panel de detalle y en la vista de lista. Así puedes ver de un vistazo cuánto ocupa cada título antes de descargarlo.

---

## Versión 0.5.1 — 3 de abril de 2026

### 🐛 Corrección: el asistente de configuración fallaba al guardar

Las nuevas opciones de enrutamiento por destino y género que se añadieron en 0.4.0 no tenían valores por defecto en el servidor. Esto hacía que el asistente de configuración fallara al guardar si esos campos no estaban presentes —y en el asistente nunca lo están—. Se han añadido los valores por defecto correspondientes y ahora el guardado funciona correctamente.

---

## Versión 0.5.0 — 3 de abril de 2026

### 📱 Interfaz adaptada a móvil

La versión web de Oscata ahora funciona bien en el móvil. La barra de navegación se convierte en una barra de pestañas fija en la parte inferior, los filtros se abren en un panel deslizante al tocar el botón de embudo, y la barra lateral desaparece para dejar todo el espacio al contenido. Los paneles de detalle y de series ocupan la pantalla completa en pantallas pequeñas.

---

## Versión 0.4.0 — 3 de abril de 2026

### 🎭 Filtrado por géneros

Ya puedes filtrar tu biblioteca por género desde la barra de filtros. Oscata lee los géneros de cada título y te deja quedarte solo con lo que te apetece ver en ese momento.

### ⚙️ Reglas de enrutamiento por género

En Ajustes hay una nueva sección para definir reglas de género. Úsala para que ciertos géneros vayan automáticamente a una biblioteca concreta —por ejemplo, enviar el cine de terror a una carpeta separada de las pelis de acción—. Puedes añadir, editar y eliminar las reglas que quieras.

### 🔄 Refresco de biblioteca más estable

Se ha reescrito la lógica que actualiza la biblioteca al arrancar. Ahora resuelve bien las rutas y no se queda colgado si algo falla durante la carga inicial.

---

## Versión 0.3.0 — 1 de abril de 2026

### 🎨 Modo claro y modo oscuro

En Ajustes encontrarás un selector con tres opciones: oscuro, claro o el predeterminado de tu sistema. El botón de cambio rápido también está disponible en la barra superior, tanto en la app de escritorio como en la versión web.

### 🚀 Indexación mucho más rápida

Hemos mejorado significativamente la velocidad al escanear tu servidor FTP. Las bibliotecas grandes se indexan en mucho menos tiempo. Al terminar, verás un resumen que se cierra automáticamente.

### 🌐 Mejor experiencia en la versión web

La versión web ahora funciona de forma más completa y fiable. Se corrigieron fallos al abrir enlaces, descargar archivos o navegar por los ajustes desde el navegador. La biblioteca se mantiene actualizada automáticamente sin necesidad de recargar la página.

### ✨ Mejoras generales de la interfaz

Pequeños ajustes en la interfaz: mejor espaciado, filtros más coherentes y elementos reorganizados para que todo luzca más limpio y fácil de usar.

---

## Versiones anteriores

Para ver el historial completo de versiones anteriores, consulta el repositorio en GitHub.
