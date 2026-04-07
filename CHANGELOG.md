# Novedades de Oscata

## Versión 0.8.6 — 7 de abril de 2026

### 🔧 Corregir match TMDB funcional de nuevo en la app de escritorio

Al aplicar un match de TMDB desde la app de escritorio, Tauri devolvía el error «missing required key itemId». La causa era que el modal enviaba el parámetro con la clave `id` en lugar de `itemId`, que es el nombre que Tauri espera al convertir el parámetro Rust `item_id` a camelCase. Corregido tanto en el modal como en la capa de transporte web para que ambas superficies usen la misma clave.

---

## Versión 0.8.5 — 7 de abril de 2026

### ⚡ Scroll de la biblioteca mucho más fluido

El desplazamiento por la cuadrícula de películas y series era lento y los pósteres aparecían en negro al hacer scroll. Dos causas identificadas y corregidas:

- **Badges con `backdrop-filter: blur`:** cada insignia superpuesta sobre los pósteres creaba una capa independiente en la GPU. Con 5-6 badges por tarjeta y 48 tarjetas por página se generaban cientos de capas simultáneas, saturando la memoria de textura y provocando que las imágenes se descargaran de la VRAM y volvieran a verse negras al volver a ellas. Se ha eliminado el filtro de desenfoque y sustituido por un fondo semitransparente con `color-mix`, visualmente idéntico y sin coste en GPU.
- **`loading="lazy"` roto dentro de contenedores con scroll:** el atributo nativo de carga diferida usa la intersección con el _viewport_ del documento, no con el contenedor con `overflow-y: auto`. Las imágenes visibles dentro del panel podían no llegar a pedirse nunca al servidor, dejando el `onLoad` sin disparar y el póster permanentemente en negro. Eliminado el atributo para que el navegador cargue las imágenes directamente.

### 🖼️ Imágenes de póster más ligeras

Las tarjetas tienen un ancho mínimo de 160 px. Se pedían imágenes de 300 px a la CDN de TMDB (el doble del tamaño necesario), duplicando el tiempo de descarga y el consumo de memoria de texturas. Cambiado el tamaño solicitado a `w185`, que es el escalón inmediatamente superior en TMDB y cubre perfectamente la resolución de las tarjetas incluso en pantallas de alta densidad.

### 🧠 Optimizaciones de renderizado en la biblioteca

- Las funciones auxiliares `getAddedTimestamp` y `deduplicateByTitle` se definían dentro del componente, generando nuevas referencias en cada renderizado e invalidando la memoización del listado filtrado. Movidas al ámbito de módulo.
- El mapa de géneros parseado (`parsedGenreMap`) se memoiza ahora sobre la lista de items, eliminando múltiples llamadas a `JSON.parse` por cada interacción con los filtros.
- El ordenamiento usa ahora una transformación de Schwartzian: las claves de ordenación se calculan una sola vez en O(N) antes de comparar, en lugar de recalcularse O(N log N) veces dentro del comparador.
- `VirtualMediaGrid` está ahora envuelto en `memo()` para evitar rerenderizados cuando cambia estado no relacionado del componente padre.

---

## Versión 0.8.4 — 7 de abril de 2026

### 🔗 Rutas de la web SPA devuelven 200 correctamente

Las rutas del cliente React (`/peliculas`, `/series`, etc.) devolvían HTTP 404 aunque la página cargara correctamente gracias a la caché del navegador. El servidor axum usaba `not_found_service`, que fuerza el código 404 en el fallback. Sustituido por `fallback`, que preserva el estado 200 de `index.html`. Las recargas directas y los accesos desde marcadores funcionan ahora sin error de red.

### 📺 Temporadas del seguimiento visibles en la web

Al abrir el panel de detalle de una serie en la lista de seguimiento, la sección de temporadas y episodios mostraba «Sin datos de episodios» porque la ruta de la API `/api/watchlist/{id}/seasons` no estaba registrada en el servidor. Añadida la ruta y el handler correspondiente que consulta TMDB y devuelve la lista completa de temporadas con sus episodios.

### 📱 Panel de seguimiento ya no queda oculto bajo la barra de navegación en móvil

En dispositivos móviles el panel inferior de detalle del seguimiento aparecía cortado por la barra de tabs de la parte inferior de la pantalla. El panel ahora sube `64 px` (más el área segura del sistema) para quedar completamente visible sobre la barra de navegación.

---

## Versión 0.8.3 — 7 de abril de 2026

### ⚡ Refresco en tiempo real de la biblioteca web (WebSocket)

La versión web ya no necesita esperar al siguiente ciclo de sondeo para enterarse de que hay contenido nuevo. Ahora el servidor mantiene una conexión WebSocket con cada pestaña abierta y envía el evento de indexación completada en el instante en que termina. La biblioteca se recarga automáticamente sin que tengas que hacer nada. El sondeo periódico sigue activo como respaldo para recuperar el estado en caso de reconexión.

---

## Versión 0.8.2 — 7 de abril de 2026

### 🔄 Indexación automática funcional en modo sin interfaz (Docker)

El planificador de indexación automática no marcaba correctamente el indicador interno `INDEXING_RUNNING`, lo que hacía que la API `/indexing/status` devolviera siempre `false` aunque hubiera un análisis en curso. Corregido: ahora el flag se activa al inicio del análisis y se desactiva al terminar, tanto en el arranque como en los ciclos periódicos.

### 💤 Descargas y subidas pendientes se reanudan también en modo bandeja

Cuando la ventana principal estaba oculta (app minimizada en la barra de menú o en modo sin interfaz), las descargas pendientes del arranque anterior no se reanudaban porque el código requería una ventana visible. Ahora `resume_pending_downloads` acepta una ventana opcional y funciona correctamente aunque la app esté en segundo plano.

---

## Versión 0.8.1 — 7 de abril de 2026

### 📌 Filtros y paginación persistentes en la URL (web)

En la versión web, los filtros activos (búsqueda, tipo, resolución, HDR, códec, género y orden) y el número de página actual se guardan automáticamente en la barra de direcciones del navegador como parámetros de consulta (`?q=breaking&res=4K&page=2`). Al recargar la página o compartir el enlace, se restaura exactamente la misma vista. Los botones de avanzar y retroceder del navegador también navegan entre los estados de filtrado anteriores.

### 📱 Paginación visible en la PWA (iOS / Android)

La barra de paginación («Anterior · Página X de Y · Siguiente») ya no queda oculta detrás de la barra de navegación inferior en móvil. El panel paginador sube por encima de la barra de pestañas y respeta el área segura del sistema (`safe-area-inset-bottom`) para que no quede tapado por el indicador de inicio de iPhone.

### 🔗 Enlaces externos funcionales en la versión web

Los botones de IMDb y TMDB en el panel de series ya abrían correctamente en la app de escritorio, pero fallaban en Docker/web con el error `Cannot read properties of undefined (reading 'invoke')`. Ahora se usa `window.open` como alternativa cuando la app corre en el navegador.

### 🔐 Flujo de inicio de sesión con OTP corregido

Al verificar el código de un solo uso recibido por correo, la app ya no volvía a llamar a la función de inicio de sesión, lo que enviaba un segundo correo innecesariamente. Ahora el paso de verificación termina correctamente sin reenvíos.

### ✉️ Configuración de TLS para el servidor SMTP

Se añade un selector de modo TLS en la sección de correo electrónico de los ajustes: `STARTTLS` (puerto 587, la mayoría de proveedores) y `TLS implícito` (puerto 465). Antes la app usaba siempre TLS implícito, lo que impedía el envío con Gmail, Outlook y similares. También se incluye un botón «Probar SMTP» que manda un correo de prueba real al usuario activo.

### 🐳 Construcción Docker más rápida (cargo-chef)

El `Dockerfile` adopta la estrategia `cargo-chef` con tres etapas separadas: cálculo del plan de dependencias, compilación de todas las _crates_ de terceros y compilación del código propio. Los cambios en el código fuente de Rust ya no recompilan las dependencias desde cero: la etapa de dependencias se reutiliza desde la caché local de Docker, reduciendo el tiempo de compilación de ~20 minutos a ~2 minutos en cambios habituales.

### 🚀 Publicación automática de imagen Docker en GitHub Actions

Se añade el flujo de trabajo `.github/workflows/build-docker.yml` que construye y publica la imagen en `ghcr.io/joelkobjoll/oscata` en cada push a `main` y en cada etiqueta de versión. La caché de compilación de Rust se almacena también en el registro para acelerar los runners de CI.

### 📝 Correcciones menores

- Las entradas de formulario en iOS ya no activan el zoom automático (tamaño de fuente mínimo 16 px).
- El modal «Corregir match TMDB» funciona correctamente en la versión web (usaba `invoke` directamente en lugar de la capa de transporte).
- El modo sin cabeza (Docker) muestra un aviso informativo cuando el servidor web ya está activo y oculta el interruptor de activación redundante.

---

## Versión 0.8.0 — 6 de abril de 2026

### 📱 Panel de series rediseñado para móvil

El panel lateral de series tiene ahora un diseño completamente distinto en pantallas pequeñas. En móvil se muestra un encabezado compacto con el póster a la izquierda, el título recortado a tres líneas, el año, la puntuación y los géneros en una sola fila, y las estadísticas como texto en línea (`2 temporadas · 24 episodios`) en lugar de tarjetas grandes. El fondo del encabezado usa el propio póster desenfocado para dar profundidad sin ocupar espacio. La lista de episodios también se adapta: etiqueta compacta (`T01E01`), sin columna de badges ni nombre de archivo. En escritorio el diseño original no cambia.

### 🗺️ Navegación móvil refinada

La barra inferior de pestañas (Todo, Películas, Series, Descargas) funciona con más fiabilidad y muestra los contadores correctamente. Las secciones secundarias (Documentales, Lista de seguimiento, Subidas) se abren desde el menú de tres líneas en la esquina superior derecha. El cajón de filtros se desliza desde el lateral y se cierra solo al tocar fuera. El selector de idioma desaparece en móvil para liberar espacio en el encabezado.

### 🎬 Panel de películas adaptado a móvil

El panel lateral de películas ocupa ahora el ancho completo de la pantalla en móvil, con el póster y los metadatos apilados verticalmente y centrados, en lugar del diseño horizontal de escritorio.

---

## Versión 0.7.7 — 6 de abril de 2026

### ⚡ Subidas más rápidas

Se mejora el rendimiento de las subidas FTP con tres cambios apilados: el tamaño de cada fragmento pasa de 256 KB a 2 MB (menos llamadas asíncronas, mejor uso del buffer TCP), se activa `TCP_NODELAY` en el socket de datos (los fragmentos salen inmediatamente sin esperar a que el sistema acumule más bytes), y la lectura del disco y la escritura en la red se ejecutan en paralelo (mientras el fragmento actual viaja al servidor, el siguiente ya se está leyendo del disco). El progreso visible y el manejo de cancelaciones funcionan igual que antes.

---

## Versión 0.7.6 — 6 de abril de 2026

### 🐛 Subida de archivos ya no se queda bloqueada al 100%

Se corrige un error por el que la barra de progreso llegaba al 100% y se quedaba parada durante un tiempo indeterminado antes de marcar la subida como completada (o no completarla nunca). La causa era que el progreso se calculaba sobre la **lectura del disco** (muy rápida) y no sobre la **transferencia real por FTP**. Ahora se usa streaming directo al servidor: cada fragmento de 256 KB se envía al vuelo y el progreso refleja los bytes realmente transmitidos por red. El 100% ya solo aparece cuando el servidor confirma la transferencia completa. Como beneficio adicional, ya no se almacena el archivo entero en RAM durante la subida.

---

## Versión 0.7.5 — 6 de abril de 2026

### 🎵 Idioma integrado en cada pista de audio

El campo de idioma ya no es un cuadro de texto libre separado. Ahora cada pista de audio incluye su propio selector de idioma (SPA – Español, ENG – Inglés, etc.) con todas las lenguas disponibles en la lista. El idioma queda como primer campo de la fila (`idioma | códec | canales | ×`), el código corto se usa en el nombre del archivo renombrado y el nombre completo sigue llegando a Telegram igual que antes. Los idiomas detectados por ffprobe o por el nombre del archivo se asignan automáticamente a cada pista por posición.

---

## Versión 0.7.4 — 6 de abril de 2026

### 🎵 Pistas de audio en series (multi-track)

El módulo de subidas ahora incluye el selector de pistas de audio en series y episodios, igual que ya existía para películas. Se detectan automáticamente desde ffprobe al analizar el archivo o el primer episodio de la temporada, y se incorporan al nombre del archivo generado (p. ej. `Breaking.Bad.S01E01.WEB-DL.1080p.HEVC.TrueHD.5.1.SPA.ENG.mkv`). El selector permite añadir, editar y eliminar pistas manualmente.

### 🎯 Coincidencia TMDB más precisa por año

La puntuación al buscar en TMDB tiene en cuenta el año del archivo con más fuerza: una coincidencia exacta suma 50 puntos, ±1 año suma 20, una diferencia de 2–3 años penaliza con −10 y más de 3 años con −25. Además, el año detectado en el nombre del archivo se pasa directamente a la búsqueda (sin depender solo del regex sobre la consulta), lo que evita que un título con varias versiones históricas seleccione la versión errónea.

---

## Versión 0.7.3 — 6 de abril de 2026

### 🎵 Códecs de audio detectados con precisión real

Se corrige la detección de EAC3 (Dolby Digital Plus), que antes se mostraba igual que AC3 (Dolby Digital). Además se leen los perfiles que reporta ffprobe para distinguir DTS de DTS-HD MA, DTS:X y DTS-HD HRA, y TrueHD de TrueHD Atmos. El selector de códec de audio se actualiza para incluir todas estas variantes.

### 📁 Selector FTP ya no duplica la carpeta de serie

Al elegir una carpeta de serie existente con el explorador FTP, la ruta se usaba como base y el sistema volvía a añadir la carpeta de temporada encima, generando rutas duplicadas (p. ej. `Tracker (2024) S03/Tracker (2024) S03`). Ahora el explorador detecta si la carpeta seleccionada está al nivel de categoría, de serie o de temporada, y actúa en consecuencia: si ya es una carpeta de serie, se usa directamente como destino final.

### 🔧 Campos de calidad visibles siempre para películas y documentales

El bloque de campos de calidad (resolución, códec, audio, canales, idiomas) ahora se muestra siempre para películas y documentales, independientemente de si el toggle «Renombrar archivo» está activado. Antes desaparecía al desactivar el renombrado.

---

## Versión 0.7.2 — 6 de abril de 2026

### 📣 Notificación Telegram: audio e subtítulos con detalle técnico completo

La línea de audio ahora muestra cada pista por separado con su idioma, códec y configuración de canales (p. ej. «Español TrueHD 7.1 · Inglés AC3 5.1»). Los subtítulos se identifican individualmente e indican las pistas forzadas con «(forzado)». Los datos los extrae ffprobe durante el análisis y viajan hasta la notificación a través de toda la cadena de subida.

### 🗂️ Episodios sueltos ya no aterrizan en «Temporadas completas»

Al subir un episodio individual, la ruta de destino apuntaba a «Temporadas completas» si esa era la única carpeta de categoría presente en el servidor. Ahora la selección es estricta: cada tipo de contenido solo acepta su categoría correcta («Temporadas en emision» para episodios, «Temporadas completas» para temporadas enteras) y crea la carpeta si aún no existe.

### 🎬 Extracción de pistas de subtítulos desde ffprobe

El analizador local detecta y registra todas las pistas de subtítulos del archivo: códec, idioma, si es la pista por defecto y si es forzada. La información viaja hasta el modal de subida, donde el toggle de subtítulos se activa automáticamente cuando se detectan pistas disponibles.

### 🔤 Diccionario de idiomas ampliado

Se añaden los códigos ISO 639-2/B que usa ffprobe (FRE, GER, CHI, DUT, etc.) al diccionario de nombres en español, eliminando códigos sin traducir en notificaciones y etiquetas de la interfaz.

---

## Versión 0.7.1 — 6 de abril de 2026

### 📂 Subidas de series: carpeta de categoría siempre presente

Al seleccionar una carpeta de destino para una serie con el explorador FTP, la subcarpeta de categoría correcta («Temporadas en emision» o «Temporadas Completadas») se mantiene en la ruta y se crea automáticamente en el servidor si aún no existe. Antes, si seleccionabas la carpeta raíz de series manualmente, la categoría desaparecía de la ruta.

### 🗂️ El explorador FTP abre directamente en la carpeta correcta

Para subidas de series, el explorador FTP se abre ahora en la subcarpeta de categoría ya detectada (p. ej. «Temporadas en emision») en lugar de en la raíz del servidor, reduciendo la navegación necesaria.

### 🔧 Detección mejorada de temporada y episodio

Se amplían los formatos de episodio reconocidos en el analizador: `1x05`, `Cap. 03`, `Capitulo 03` y números con cero inicial al principio del nombre de archivo. La detección de temporada dentro de directorios de temporada completa es más robusta y recorre un nivel adicional de subcarpetas cuando es necesario.

### 🎵 Códec de audio y idiomas en subidas

La información de códec de audio e idiomas detectada por ffprobe y el parser se propaga ahora correctamente al trabajo de subida y queda registrada en la base de datos al completarse.

---

## Versión 0.7.0 — 5 de abril de 2026

### 📤 Subidas que sobreviven a un cierre inesperado

Si la app se cierra de golpe o el sistema se apaga mientras hay archivos en cola, Oscata recuerda exactamente qué estaba pendiente y lo retoma solo al volver a abrirla. Las subidas queued o en curso se reanudan automáticamente; los completados, fallidos y cancelados siguen visibles en el historial.

### 🗂️ Vista previa del plan de subida para episodios individuales

Al subir un episodio suelto ahora ves el mismo panel «Plan de subida» que aparece en las temporadas completas: la carpeta de destino y el nombre final del archivo, calculado al momento a partir de los campos de calidad.

### ✏️ Renombrar también en series

El toggle «Renombrar archivo» aparece tanto para episodios individuales como para temporadas completas (antes solo salía en películas). Desactívalo si quieres subir el archivo con su nombre original sin tocar.

### 📣 Notificación Telegram mejorada

La resolución, el códec, los idiomas y el tamaño ahora aparecen justo debajo del título, antes que la valoración y la sinopsis, para que la información técnica sea lo primero que veas.

### 🔒 Ajustes de destinos FTP solo para administradores

En el modo web, la sección de carpetas de destino (películas, series, documentales, reglas por género) solo es visible para usuarios con rol administrador o editor. Los usuarios normales ven el resto de ajustes sin problema.

---

## Versión 0.6.3 — 5 de abril de 2026

### 💼 La versión portátil de Windows ya funciona bien

El ZIP portátil de Windows se ha rehecho para incluir todo lo que necesita Oscata al arrancar. Ahora puedes descomprimirlo, abrir `Oscata.exe` y usar la app sin instalación, con la interfaz cargando bien y la biblioteca guardándose junto al ejecutable.

---

## Versión 0.6.2 — 5 de abril de 2026

### 🗄️ Elige dónde guardar tu biblioteca

Ya puedes decidir en qué carpeta quiere Oscata guardar la base de datos. Tanto en el asistente de configuración inicial como en Ajustes → Almacenamiento encuentras la opción para apuntar a cualquier directorio: un NAS, un disco externo o donde más te convenga. La biblioteca actual se copia sola al nuevo destino (sin perder nada) y Oscata te pide que reinicies para empezar a usarla. Si en algún momento quieres volver a la ubicación por defecto, también puedes restablecerla desde ese mismo apartado.

### 💼 Versión portátil para Windows

Además del instalador NSIS, cada release de GitHub incluye ahora un ZIP portátil para Windows: descomprímelo donde quieras, ejecuta `Oscata.exe` y listo, sin instalación. La biblioteca se guarda junto al ejecutable, así que puedes llevártela en un disco externo.

### 🗑️ Eliminar una descarga borra también el archivo

Al borrar una descarga, Oscata cancela la transferencia activa y elimina el fichero del disco. Sin rastro.

### 🖥️ Aspecto más nativo

Se desactivan el menú contextual del botón derecho y la selección de texto en toda la interfaz, igual que en una app de escritorio. Los campos de formulario mantienen el comportamiento normal para que puedas escribir y editar con comodidad.

---

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
