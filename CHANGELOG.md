# Novedades de Oscata

## Versión 0.6.1 — 5 de abril de 2026

### ⚡ Las descargas automáticas arrancan solas

Hasta ahora, la descarga automática de la lista de seguimiento solo se activaba manualmente. Ahora Oscata lo hace en dos momentos sin que tengas que hacer nada: al terminar el indexado del FTP, y en el momento en que activas la descarga automática en un título. Si el archivo ya estaba indexado, empieza a bajar de inmediato.

---

## Versión 0.6.0 — 5 de abril de 2026

### 📋 Lista de seguimiento

Oscata estrena una pestaña donde apuntas las películas y series que quieres tener. Busca en TMDB, añade lo que te interese y ve de un vistazo qué ya tienes en la biblioteca y qué sigue pendiente. Activa la descarga automática título a título y Oscata se encarga en cuanto aparezca en el FTP.

### ⭐ Perfiles de calidad para la lista de seguimiento

Al añadir un título puedes asignarle un perfil de calidad: resolución mínima y preferida, HDR, códecs y límite de tamaño. Si tienes la descarga automática activada, Oscata lo usará para decidir qué archivos merece la pena bajar y cuáles no.

### 📺 Cuánto tienes de cada serie

Abre el detalle de una serie en tu lista de seguimiento y verás qué temporadas y episodios tienes ya en la biblioteca, con qué calidad, y qué te sigue faltando.

---

## Versión 0.5.5 — 5 de abril de 2026

### 📊 Cuánto falta para enriquecer los metadatos

Mientras Oscata consulta TMDB, ahora puedes ver el avance: barra de progreso, porcentaje y título en curso.

### ⏸️ Oscata te avisa si cierras con descargas en marcha

Si intentas cerrar con descargas activas, Oscata te pregunta antes de salir para que no pierdas ninguna transferencia.

### 📥 Minimizar a la bandeja en lugar de cerrar

En Ajustes puedes hacer que el botón de cierre envíe Oscata a la bandeja en vez de cerrarlo, para que las descargas sigan en segundo plano.

### 🔽 Panel de filtros rediseñado

Las opciones ahora son etiquetas compactas que se resaltan en morado al activarse. Los grupos se pueden plegar y desplegar, e iluminan su título cuando hay filtros activos dentro.

---

## Versión 0.5.4 — 4 de abril de 2026

### 🎯 Tipo de contenido correcto tras el emparejamiento con TMDB

Oscata ahora almacena el tipo de contenido real que devuelve TMDB (película o serie) en lugar del que deduce el parser del nombre de archivo. Esto corrige casos en los que un título quedaba mal categorizado —por ejemplo, indexado como película cuando TMDB lo reconoce como serie, o viceversa—. El emparejamiento automático y la opción «Emparejar de nuevo todo» se benefician de esta mejora.

### 🔒 Modo desarrollo web limitado a localhost

En compilaciones de depuración, el servidor web integrado ahora solo acepta conexiones desde el propio equipo. Esto evita exposiciones accidentales de la interfaz en la red local durante el desarrollo.

---

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
