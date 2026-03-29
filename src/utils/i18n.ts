import type { AppLanguage } from "./mediaLanguage";

const messages = {
  "nav.all": { es: "Todo", en: "All" },
  "nav.movies": { es: "Películas", en: "Movies" },
  "nav.tv": { es: "Series", en: "TV Shows" },
  "nav.docs": { es: "Documentales", en: "Documentaries" },
  "nav.downloads": { es: "Descargas", en: "Downloads" },

  "common.loading": { es: "Cargando…", en: "Loading…" },
  "common.search": { es: "Buscar", en: "Search" },
  "common.clear": { es: "Limpiar", en: "Clear" },
  "common.cancel": { es: "Cancelar", en: "Cancel" },
  "common.close": { es: "Cerrar", en: "Close" },
  "common.save": { es: "Guardar", en: "Save" },
  "common.saved": { es: "Guardado", en: "Saved" },
  "common.saving": { es: "Guardando…", en: "Saving…" },
  "common.refresh": { es: "Actualizar", en: "Refresh" },
  "common.download": { es: "Descargar", en: "Download" },
  "common.browse": { es: "Explorar", en: "Browse" },
  "common.testing": { es: "Probando…", en: "Testing…" },
  "common.connected": { es: "Conectado", en: "Connected" },
  "common.connectionFailed": {
    es: "Falló la conexión",
    en: "Connection failed",
  },
  "common.languageSpanish": { es: "Español", en: "Spanish" },
  "common.languageEnglish": { es: "Inglés", en: "English" },
  "common.all": { es: "Todo", en: "All" },

  "library.shows": { es: "Series", en: "Shows" },
  "library.episodes": { es: "Episodios", en: "Episodes" },
  "library.select": { es: "Seleccionar", en: "Select" },
  "library.selectAll": { es: "Seleccionar todo", en: "Select All" },
  "library.cancel": { es: "Cancelar", en: "Cancel" },
  "library.fixMatch": { es: "Corregir match", en: "Fix Match" },
  "library.refresh": { es: "Actualizar librería", en: "Refresh Library" },
  "library.refreshAllMetadata": {
    es: "Actualizar metadatos faltantes",
    en: "Refresh Missing Metadata",
  },
  "library.rematchAll": { es: "Re-hacer match global", en: "Re-Match All" },
  "library.clearAllMetadata": {
    es: "Limpiar metadatos",
    en: "Clear All Metadata",
  },
  "library.clearing": { es: "Limpiando metadatos…", en: "Clearing metadata…" },
  "library.refreshing": {
    es: "Actualizando librería…",
    en: "Refreshing library…",
  },
  "library.refreshingMetadata": {
    es: "Actualizando metadatos…",
    en: "Refreshing metadata…",
  },
  "library.matching": { es: "Re-haciendo match…", en: "Re-matching…" },
  "library.page": { es: "Página", en: "Page" },
  "library.of": { es: "de", en: "of" },
  "library.prev": { es: "Anterior", en: "Prev" },
  "library.next": { es: "Siguiente", en: "Next" },
  "library.grouped": { es: "Agrupadas", en: "Grouped" },
  "library.files": { es: "Archivos", en: "Files" },
  "library.selectedCount": {
    es: "{count} seleccionados",
    en: "{count} selected",
  },
  "library.selectMultiple": { es: "Seleccionar varios", en: "Select multiple" },
  "library.actions": { es: "Acciones de librería", en: "Library actions" },
  "library.openSettings": { es: "Abrir ajustes", en: "Open Settings" },
  "library.noMediaStarting": {
    es: "Todavía no hay contenido indexado. Iniciando…",
    en: "No media indexed yet. Starting…",
  },
  "library.noResultsFilters": {
    es: "Ningún resultado coincide con los filtros actuales.",
    en: "No results match your filters.",
  },
  "library.noCategory": {
    es: "No se encontraron {category}. Revisa la configuración de tipos de carpeta.",
    en: "No {category} found. Check your folder type settings.",
  },

  "filter.filters": { es: "Filtros", en: "Filters" },
  "filter.search": { es: "Buscar", en: "Search" },
  "filter.sort": { es: "Orden", en: "Sort" },
  "filter.type": { es: "Tipo", en: "Type" },
  "filter.resolution": { es: "Resolución", en: "Resolution" },
  "filter.codec": { es: "Codec de video", en: "Video codec" },
  "filter.hdr": { es: "HDR", en: "HDR" },
  "filter.active": { es: "{count} activos", en: "{count} active" },
  "filter.browseHint": {
    es: "Explora por calidad o título",
    en: "Browse by quality or title",
  },
  "filter.clear": { es: "Limpiar", en: "Clear" },
  "filter.searchPlaceholder": {
    es: "Título, archivo, release group…",
    en: "Title, filename, release group…",
  },
  "filter.sort.releaseDesc": {
    es: "Lanzamiento más reciente",
    en: "Release newest",
  },
  "filter.sort.addedDesc": {
    es: "Agregados recientemente",
    en: "Recently added",
  },
  "filter.sort.ratingDesc": { es: "Mejor valorados", en: "Top rated" },
  "filter.sort.titleAsc": { es: "Título A-Z", en: "Title A-Z" },
  "filter.sort.titleDesc": { es: "Título Z-A", en: "Title Z-A" },
  "filter.sort.releaseAsc": {
    es: "Lanzamiento más antiguo",
    en: "Release oldest",
  },
  "filter.sort.yearDesc": { es: "Año más reciente", en: "Year newest" },
  "filter.sort.yearAsc": { es: "Año más antiguo", en: "Year oldest" },
  "filter.allResolutions": {
    es: "Todas las resoluciones",
    en: "All resolutions",
  },
  "filter.allTypes": { es: "Todos los tipos", en: "All types" },
  "filter.allCodecs": { es: "Todos los codecs", en: "All codecs" },
  "filter.allHdr": { es: "Todo HDR", en: "All HDR" },
  "filter.hdr.dolbyVision": { es: "Dolby Vision", en: "Dolby Vision" },

  "detail.details": { es: "Detalles", en: "Details" },
  "detail.fileInfo": { es: "Archivo", en: "File Info" },
  "detail.filename": { es: "Nombre de archivo", en: "Filename" },
  "detail.download": { es: "Descargar", en: "Download" },
  "detail.alreadyDownloaded": { es: "Ya descargado", en: "Already downloaded" },
  "detail.alreadyDownloadedHint": {
    es: "Este archivo exacto ya existe en la carpeta de destino.",
    en: "This exact file already exists in the destination folder.",
  },
  "detail.fixMatch": { es: "Corregir match", en: "Fix Match" },
  "detail.resolution": { es: "Resolución", en: "Resolution" },
  "detail.videoCodec": { es: "Codec de video", en: "Video Codec" },
  "detail.audio": { es: "Audio", en: "Audio" },
  "detail.size": { es: "Tamaño", en: "Size" },
  "detail.links": { es: "Enlaces", en: "Links" },
  "detail.openTmdb": { es: "Abrir en TMDB", en: "Open in TMDB" },
  "detail.openImdb": { es: "Abrir en IMDb", en: "Open in IMDb" },
  "detail.availableVersions": {
    es: "Versiones disponibles",
    en: "Available Versions",
  },
  "detail.otherVersions": { es: "Otras versiones", en: "Other Versions" },
  "detail.viewFileDetails": { es: "Ver detalle", en: "View details" },
  "detail.genre.action": { es: "Acción", en: "Action" },
  "detail.genre.adventure": { es: "Aventura", en: "Adventure" },
  "detail.genre.animation": { es: "Animación", en: "Animation" },
  "detail.genre.comedy": { es: "Comedia", en: "Comedy" },
  "detail.genre.crime": { es: "Crimen", en: "Crime" },
  "detail.genre.documentary": { es: "Documental", en: "Documentary" },
  "detail.genre.drama": { es: "Drama", en: "Drama" },
  "detail.genre.family": { es: "Familiar", en: "Family" },
  "detail.genre.fantasy": { es: "Fantasía", en: "Fantasy" },
  "detail.genre.history": { es: "Historia", en: "History" },
  "detail.genre.horror": { es: "Terror", en: "Horror" },
  "detail.genre.music": { es: "Música", en: "Music" },
  "detail.genre.mystery": { es: "Misterio", en: "Mystery" },
  "detail.genre.romance": { es: "Romance", en: "Romance" },
  "detail.genre.scifi": { es: "Ciencia ficción", en: "Sci-Fi" },
  "detail.genre.tvmovie": { es: "Película para TV", en: "TV Movie" },
  "detail.genre.thriller": { es: "Thriller", en: "Thriller" },
  "detail.genre.war": { es: "Bélica", en: "War" },
  "detail.genre.western": { es: "Western", en: "Western" },

  "toast.refresh": { es: "Actualización de librería", en: "Library refresh" },
  "toast.indexing": {
    es: "Indexando {current} / {total}",
    en: "Indexing {current} / {total}",
  },
  "toast.subtitle": {
    es: "Buscando archivos nuevos en FTP y enriqueciendo solo los nuevos",
    en: "Checking FTP for new files and enriching only new items",
  },
  "toast.expand": {
    es: "Mostrar estado de actualización",
    en: "Show refresh status",
  },
  "toast.minimize": {
    es: "Minimizar estado de actualización",
    en: "Minimize refresh status",
  },

  "toast.error.title": { es: "Error de conexión", en: "Connection error" },
  "toast.error.retry": { es: "Reintentar", en: "Retry" },
  "toast.error.dismiss": { es: "Descartar", en: "Dismiss" },

  "tv.show": { es: "Serie", en: "TV Show" },
  "tv.seasons": { es: "Temporadas", en: "Seasons" },
  "tv.episodes": { es: "Episodios", en: "Episodes" },
  "tv.groups": { es: "Grupos", en: "Groups" },
  "tv.fixShow": { es: "Corregir match de la serie", en: "Fix match for show" },
  "tv.fixVisible": {
    es: "Corregir match de episodios visibles",
    en: "Fix match for visible episodes",
  },
  "tv.clearShowMetadata": {
    es: "Limpiar metadatos de la serie",
    en: "Clear show metadata",
  },
  "tv.clearingShowMetadata": {
    es: "Limpiando metadatos…",
    en: "Clearing metadata…",
  },
  "tv.unknownFolder": { es: "Desconocido", en: "Unknown" },
  "tv.episode": { es: "Episodio", en: "Episode" },
  "tv.episodeUnknown": { es: "Episodio ?", en: "Episode ?" },
  "tv.seasonLabel": { es: "Temporada {season}", en: "Season {season}" },
  "tv.unknownSeason": { es: "Temporada desconocida", en: "Unknown Season" },
  "tv.downloadEpisode": { es: "Descargar episodio", en: "Download episode" },
  "tv.downloadFolder": { es: "Descargar carpeta", en: "Download folder" },
  "tv.downloadVisible": {
    es: "Descargar episodios visibles",
    en: "Download all visible episodes",
  },
  "tv.filesCount": {
    es: "{count} archivo{suffix}",
    en: "{count} file{suffix}",
  },
  "tv.episodesAndGroups": {
    es: "{episodes} episodio{episodesSuffix} · {groups} grupo{groupsSuffix}",
    en: "{episodes} episode{episodesSuffix} · {groups} release group{groupsSuffix}",
  },
  "tv.downloadSeason": { es: "Descargar temporada", en: "Download season" },
  "tv.source": { es: "Fuente", en: "Source" },
  "tv.quality": { es: "Calidad", en: "Quality" },
  "tv.season": { es: "Temporada", en: "Season" },
  "tv.noEpisodesFilters": {
    es: "Ningún episodio coincide con los filtros actuales.",
    en: "No episodes match the current filters.",
  },
  "tv.close": { es: "Cerrar", en: "Close" },
  "tv.downloadGroup": { es: "Descargar grupo", en: "Download group" },
  "tv.downloadAllVisible": {
    es: "Descargar episodios visibles",
    en: "Download all visible episodes",
  },
  "tv.clearConfirm": {
    es: '¿Limpiar todos los metadatos TMDB de "{title}"? Se volverán a obtener en el próximo rematch.',
    en: 'Clear all TMDB metadata for "{title}"? It will be re-fetched on next rematch.',
  },

  "modal.fixTmdb": { es: "Corregir match TMDB", en: "Fix TMDB match" },
  "modal.searchTarget": { es: "Búsqueda objetivo", en: "Search target" },
  "modal.search": { es: "Buscar", en: "Search" },
  "modal.searching": { es: "Buscando…", en: "Searching…" },
  "modal.movie": { es: "Película", en: "Movie" },
  "modal.doc": { es: "Doc", en: "Doc" },
  "modal.useMatch": { es: "Usar match", en: "Use match" },
  "modal.applying": { es: "Aplicando…", en: "Applying…" },
  "modal.noResults": {
    es: "No se encontraron resultados TMDB para esa búsqueda.",
    en: "No TMDB results found for that search.",
  },
  "modal.matchEditor": { es: "Editor de match", en: "Match editor" },
  "modal.untitled": { es: "Sin título", en: "Untitled" },
  "modal.applyOne": { es: "Aplicar a 1 archivo", en: "Apply to 1 file" },
  "modal.applyMany": {
    es: "Aplicar a {count} archivos",
    en: "Apply to {count} files",
  },
  "modal.type": { es: "Tipo", en: "Type" },
  "modal.documentary": { es: "Documental", en: "Documentary" },
  "modal.searchPlaceholder": {
    es: "Buscar título TMDB…",
    en: "Search TMDB title…",
  },
  "modal.emptyTitle": {
    es: "Busca en TMDB para elegir el match correcto",
    en: "Search TMDB to choose the correct match",
  },
  "modal.emptyBody": {
    es: "Usa la búsqueda de arriba y selecciona el mejor resultado. El match elegido se aplicará a todos los archivos de este alcance.",
    en: "Use the title search above, then pick the best result. The selected match will be applied to every file in this scope.",
  },
  "modal.rating": { es: "Puntuación {rating}", en: "Rating {rating}" },

  "downloads.queued": { es: "En cola", en: "Queued" },
  "downloads.downloading": { es: "Descargando…", en: "Downloading…" },
  "downloads.done": { es: "Completado", en: "Done" },
  "downloads.error": { es: "Error", en: "Error" },
  "downloads.cancelled": { es: "Cancelado", en: "Cancelled" },
  "downloads.toastQueuedTitle": {
    es: "Descarga agregada",
    en: "Download queued",
  },
  "downloads.toastQueuedBody": {
    es: "La descarga fue enviada a la cola.",
    en: "The download was added to the queue.",
  },
  "downloads.toastErrorTitle": {
    es: "Error al agregar descarga",
    en: "Download failed",
  },
  "downloads.toastErrorBody": {
    es: "No se pudo enviar la descarga a la cola.",
    en: "The download could not be added to the queue.",
  },
  "downloads.subtitle": {
    es: "Sigue el estado de las descargas, reintenta fallos y abre el contenido completado desde un solo lugar.",
    en: "Track download progress, retry failures, and open completed items from one place.",
  },
  "downloads.cancel": { es: "Cancelar", en: "Cancel" },
  "downloads.retry": { es: "Reintentar", en: "Retry" },
  "downloads.openFolder": { es: "Abrir carpeta", en: "Open folder" },
  "downloads.delete": { es: "Eliminar", en: "Delete" },
  "downloads.waiting": { es: "Esperando en cola…", en: "Waiting in queue…" },
  "downloads.none": { es: "Todavía no hay descargas", en: "No downloads yet" },
  "downloads.emptyTitle": {
    es: "Todavía no hay descargas",
    en: "No downloads yet",
  },
  "downloads.emptyBody": {
    es: "Cuando envíes contenido a descargar, lo verás aquí con progreso, acciones rápidas y estado de reanudación.",
    en: "When you queue content for download, it will appear here with progress, quick actions, and resume status.",
  },
  "downloads.activeSection": { es: "En curso", en: "In progress" },
  "downloads.activeSectionBody": {
    es: "Descargas activas y elementos esperando su turno.",
    en: "Active downloads and items waiting for their turn.",
  },
  "downloads.historySection": {
    es: "Historial reciente",
    en: "Recent history",
  },
  "downloads.historySectionBody": {
    es: "Completadas, canceladas o con error, con acciones para continuar.",
    en: "Completed, cancelled, or failed items with actions to continue.",
  },
  "downloads.noActive": {
    es: "No hay descargas activas en este momento.",
    en: "There are no active downloads right now.",
  },
  "downloads.noHistory": {
    es: "Todavía no hay historial de descargas.",
    en: "There is no download history yet.",
  },
  "downloads.clearCompleted": {
    es: "Limpiar completadas",
    en: "Clear Completed",
  },
  "downloads.downloadingCount": {
    es: "{count} descargando",
    en: "{count} downloading",
  },
  "downloads.queuedCount": { es: "{count} en cola", en: "{count} queued" },
  "downloads.doneCount": { es: "{count} completadas", en: "{count} done" },
  "downloads.failedCount": { es: "{count} fallidas", en: "{count} failed" },
  "downloads.secondsLeft": { es: "{count}s restantes", en: "{count}s left" },
  "downloads.minutesLeft": {
    es: "{minutes}m {seconds}s restantes",
    en: "{minutes}m {seconds}s left",
  },
  "downloads.hoursLeft": { es: "{hours}h restantes", en: "{hours}h left" },

  "activity.title": {
    es: "Actividad · {count} entradas",
    en: "Activity Log · {count} entries",
  },
  "activity.clear": { es: "Limpiar", en: "Clear" },
  "activity.connectedCrawl": {
    es: "Conectado — iniciando exploración desde {root}",
    en: "Connected — starting crawl from {root}",
  },
  "activity.crawlComplete": {
    es: "Exploración completada — {count} archivos encontrados",
    en: "Crawl complete — {count} media files found",
  },
  "activity.scanning": { es: "📂 Escaneando {path}", en: "📂 Scanning {path}" },
  "activity.found": { es: "🎬 Encontrado: {name}", en: "🎬 Found: {name}" },
  "activity.rematching": {
    es: "🔄 Rehaciendo match de {count} elementos con TMDB…",
    en: "🔄 Re-matching {count} items with TMDB…",
  },
  "activity.matching": {
    es: "🌐 [{current}/{total}] Buscando match: {title} ({type})",
    en: "🌐 [{current}/{total}] Matching: {title} ({type})",
  },
  "activity.matched": {
    es: "✓ Match: {from} → {to} ({year})",
    en: "✓ Matched: {from} → {to} ({year})",
  },
  "activity.noMatch": {
    es: "⚠ No se encontró match para: {title}",
    en: "⚠ No match found for: {title}",
  },
  "activity.rematchComplete": {
    es: "✓ Rematch completo — {count} elementos procesados",
    en: "✓ Re-match complete — {count} items processed",
  },
  "activity.doneIndexed": {
    es: "✓ Listo — {count} archivos indexados",
    en: "✓ Done — {count} files indexed",
  },
  "activity.error": { es: "⚠ Error: {message}", en: "⚠ Error: {message}" },
  "activity.indexingStarted": {
    es: "▶ Indexado iniciado",
    en: "▶ Indexing started",
  },

  "router.loading": { es: "Cargando…", en: "Loading…" },

  "wizard.stepFtp": { es: "Servidor FTP", en: "FTP Server" },
  "wizard.stepTmdb": { es: "API de TMDB", en: "TMDB API" },
  "wizard.stepConfirm": { es: "Confirmar", en: "Confirm" },
  "wizard.next": { es: "Siguiente →", en: "Next →" },
  "wizard.host": { es: "Host", en: "Host" },
  "wizard.port": { es: "Puerto", en: "Port" },
  "wizard.username": { es: "Usuario", en: "Username" },
  "wizard.password": { es: "Contraseña", en: "Password" },
  "wizard.rootPath": { es: "Ruta raíz", en: "Root Path" },
  "wizard.testConnection": { es: "Probar conexión", en: "Test Connection" },
  "wizard.failedCredentials": {
    es: "Falló — revisa host/credenciales",
    en: "Failed — check host/credentials",
  },
  "wizard.tmdbHelp": {
    es: "Consigue tu API key gratis en",
    en: "Get your free API key at",
  },
  "wizard.tmdbKey": { es: "TMDB API Key (v3)", en: "TMDB API Key (v3)" },
  "wizard.tmdbPlaceholder": {
    es: "Pega tu API key v3",
    en: "Paste your v3 API key",
  },
  "wizard.validateKey": { es: "Validar key", en: "Test Key" },
  "wizard.validating": { es: "Validando…", en: "Validating…" },
  "wizard.validKey": { es: "✓ La key es válida", en: "✓ Key is valid" },
  "wizard.invalidKey": { es: "✗ Key inválida", en: "✗ Invalid key" },
  "wizard.confirmTitle": { es: "Todo se ve bien", en: "Everything looks good" },
  "wizard.tmdbConfigured": {
    es: "TMDB API key: configurada ✓",
    en: "TMDB API key: configured ✓",
  },
  "wizard.welcomeTitle": {
    es: "Bienvenido a Oscata FTP Client",
    en: "Welcome to Oscata FTP Client",
  },
  "wizard.welcomeDescription": {
    es: "Configura una librería nueva o restaura una base de datos existente para no empezar desde cero.",
    en: "Set up a new library or restore an existing database so you do not have to start from scratch.",
  },
  "wizard.startFresh": {
    es: "Empezar configuración nueva",
    en: "Start fresh setup",
  },
  "wizard.restoreBackup": {
    es: "Restaurar copia de librería",
    en: "Restore library backup",
  },
  "wizard.restoringBackup": {
    es: "Restaurando copia…",
    en: "Restoring backup…",
  },
  "wizard.restoreHelp": {
    es: "Selecciona un backup SQLite exportado desde otra instalación de Oscata FTP Client.",
    en: "Choose a SQLite backup exported from another Oscata FTP Client installation.",
  },
  "wizard.finishSetup": {
    es: "Guardar y abrir biblioteca",
    en: "Save & Open Library",
  },
  "wizard.preparingLibrary": {
    es: "Preparando biblioteca…",
    en: "Preparing library…",
  },
  "wizard.confirmDescription": {
    es: "Revisa la conexión, el idioma inicial, la carpeta de descargas y la estructura de la biblioteca antes de terminar la configuración.",
    en: "Review the connection, startup language, download folder, and library structure before finishing setup.",
  },
  "wizard.setupOverview": {
    es: "Pon a punto la conexión principal y deja la librería lista para empezar a indexar.",
    en: "Dial in the core connection and leave the library ready for its first index.",
  },
  "wizard.startFreshDescription": {
    es: "Conecta tu FTP, valida TMDB y define las preferencias básicas desde el inicio.",
    en: "Connect your FTP, validate TMDB, and define the core preferences from the start.",
  },
  "wizard.summaryTitle": {
    es: "Resumen de configuración",
    en: "Setup summary",
  },

  "settings.title": { es: "Ajustes", en: "Settings" },
  "settings.subtitle": {
    es: "Configura FTP, metadatos, descargas, servidores multimedia y el comportamiento de la librería con el mismo estilo visual del resto de la app.",
    en: "Configure FTP, metadata, downloads, media servers, and library behavior using the same panel style as the rest of the app.",
  },
  "settings.close": { es: "Cerrar ajustes", en: "Close settings" },
  "settings.ftpTitle": { es: "Servidor FTP", en: "FTP Server" },
  "settings.ftpDescription": {
    es: "Datos de conexión para navegar e indexar tu librería remota.",
    en: "Connection details for browsing and indexing your remote media library.",
  },
  "settings.host": { es: "Host", en: "Host" },
  "settings.port": { es: "Puerto", en: "Port" },
  "settings.username": { es: "Usuario", en: "Username" },
  "settings.password": { es: "Contraseña", en: "Password" },
  "settings.rootPath": { es: "Ruta raíz", en: "Root Path" },
  "settings.testConnection": { es: "Probar conexión", en: "Test Connection" },
  "settings.browseRoot": { es: "Explorar raíz", en: "Browse Root" },
  "settings.listing": { es: "Listando…", en: "Listing…" },
  "settings.rootListing": {
    es: "Listado raíz ({count})",
    en: "Root listing ({count})",
  },
  "settings.dismiss": { es: "Cerrar", en: "Dismiss" },
  "settings.emptyDirectory": {
    es: "(directorio vacío)",
    en: "(empty directory)",
  },
  "settings.metaTitle": { es: "Metadatos e idioma", en: "Metadata & Language" },
  "settings.metaDescription": {
    es: "Acceso a TMDB y selección del idioma por defecto al abrir la app.",
    en: "TMDB access plus the default language used when the app opens.",
  },
  "settings.updatesTitle": { es: "Actualizaciones", en: "Updates" },
  "settings.updatesDescription": {
    es: "Controla cómo la app versiona sus builds y consulta nuevas versiones firmadas.",
    en: "Control how the app versions its builds and checks for new signed releases.",
  },
  "settings.currentVersion": { es: "Versión actual", en: "Current version" },
  "settings.versioningHelp": {
    es: "La versión de la app ahora sale de `package.json`, así el frontend y Tauri comparten el mismo número de versión.",
    en: "The app version now comes from `package.json`, so the frontend and Tauri share the same version number.",
  },
  "settings.updatesConfigured": { es: "Updater listo", en: "Updater ready" },
  "settings.autoCheckUpdates": {
    es: "Comprobar actualizaciones automáticamente",
    en: "Automatically check for updates",
  },
  "settings.autoCheckUpdatesHelp": {
    es: "Guarda tu preferencia para futuras comprobaciones automáticas de nuevas releases.",
    en: "Stores your preference for future automatic checks for new releases.",
  },
  "settings.updaterEndpoint": {
    es: "Endpoint de actualizaciones",
    en: "Update endpoint",
  },
  "settings.updaterEndpointPlaceholder": {
    es: "https://github.com/owner/repo/releases/latest/download/latest.json",
    en: "https://github.com/owner/repo/releases/latest/download/latest.json",
  },
  "settings.updaterEndpointHelp": {
    es: "Usa un `latest.json` estático o un endpoint dinámico del updater de Tauri.",
    en: "Use either a static `latest.json` or a dynamic Tauri updater endpoint.",
  },
  "settings.updaterPubkey": {
    es: "Clave pública del updater",
    en: "Updater public key",
  },
  "settings.updaterPubkeyPlaceholder": {
    es: "Pega aquí el contenido completo de tu clave pública PEM",
    en: "Paste the full PEM public key contents here",
  },
  "settings.updaterPubkeyHelp": {
    es: "Genera las claves con `npm run tauri signer generate` y pega aquí la clave pública.",
    en: "Generate keys with `npm run tauri signer generate` and paste the public key here.",
  },
  "settings.checkForUpdates": {
    es: "Buscar actualizaciones",
    en: "Check for updates",
  },
  "settings.checkingUpdates": {
    es: "Buscando actualizaciones…",
    en: "Checking for updates…",
  },
  "settings.updatesNotConfigured": {
    es: "Completa el endpoint y la clave pública para activar el updater seguro.",
    en: "Fill in the endpoint and public key to enable secure updater checks.",
  },
  "settings.updatesAvailable": {
    es: "Actualización disponible",
    en: "Update available",
  },
  "settings.updatesAvailableMessage": {
    es: "Hay una nueva versión disponible: v{version}.",
    en: "A new version is available: v{version}.",
  },
  "settings.updatesUpToDate": {
    es: "Ya estás en la última versión disponible.",
    en: "You're already on the latest available version.",
  },
  "settings.updatesUpToDateTitle": {
    es: "Todo al día",
    en: "Up to date",
  },
  "settings.updatesError": {
    es: "No se pudo comprobar la actualización",
    en: "Could not check for updates",
  },
  "settings.releaseDate": {
    es: "Fecha de publicación: {date}",
    en: "Release date: {date}",
  },
  "settings.tmdbKey": { es: "TMDB API Key (v3)", en: "TMDB API Key (v3)" },
  "settings.tmdbPlaceholder": {
    es: "Pega tu API key v3",
    en: "Paste your v3 API key",
  },
  "settings.defaultLanguage": {
    es: "Idioma por defecto de la librería",
    en: "Default Library Language",
  },
  "settings.defaultLanguageHelp": {
    es: "Define el idioma inicial al abrir la app. El usuario puede cambiarlo temporalmente desde la barra superior.",
    en: "This sets the startup language. Users can still switch temporarily from the top bar.",
  },
  "settings.downloadsTitle": { es: "Descargas", en: "Downloads" },
  "settings.downloadsDescription": {
    es: "Controla dónde se guardan los archivos y cuántas descargas simultáneas puede ejecutar la app.",
    en: "Control where files go and how aggressively the app downloads them.",
  },
  "settings.backupsTitle": {
    es: "Backups y restauración",
    en: "Backups & Restore",
  },
  "settings.backupsDescription": {
    es: "Exporta tu librería indexada o restaura una base de datos existente en una instalación nueva.",
    en: "Export your indexed library or restore an existing database into a fresh installation.",
  },
  "settings.exportBackup": { es: "Exportar backup", en: "Export backup" },
  "settings.importBackup": { es: "Importar backup", en: "Import backup" },
  "settings.backupsHelp": {
    es: "Los backups incluyen la librería indexada, metadatos TMDB, configuración y estado persistido de descargas.",
    en: "Backups include indexed library data, TMDB metadata, configuration, and persisted download state.",
  },
  "settings.backupExportSuccess": {
    es: "Backup exportado correctamente.",
    en: "Backup exported successfully.",
  },
  "settings.backupImportSuccess": {
    es: "Backup importado. Recargando la app…",
    en: "Backup imported. Reloading the app…",
  },
  "settings.downloadFolder": {
    es: "Carpeta de descargas",
    en: "Download Folder",
  },
  "settings.downloadFolderPlaceholder": {
    es: "/Users/tuusuario/Peliculas",
    en: "/Users/you/Movies",
  },
  "settings.downloadFolderHelp": {
    es: "Ejemplo: `Movies/A/Avengers (2012)/file.mkv` y `TV Shows/Show/Season 01/file.mkv`.",
    en: "Example structure: `Movies/A/Avengers (2012)/file.mkv` and `TV Shows/Show/Season 01/file.mkv`.",
  },
  "settings.maxConcurrent": {
    es: "Máximo de descargas simultáneas",
    en: "Max Concurrent Downloads",
  },
  "settings.maxConcurrentHelp": {
    es: "Elige cuántos archivos pueden descargarse al mismo tiempo (1–5).",
    en: "Choose how many files can download at the same time (1–5).",
  },
  "settings.mediaServersTitle": {
    es: "Servidores multimedia",
    en: "Media Servers",
  },
  "settings.mediaServersDescription": {
    es: "Conexiones opcionales para comprobar presencia en librerías y futuros flujos de reproducción.",
    en: "Optional connections used for library presence checks and downstream playback workflows.",
  },
  "settings.embyDescription": {
    es: "Comprueba si los títulos visibles ya existen en Emby.",
    en: "Check whether visible titles already exist in Emby.",
  },
  "settings.plexDescription": {
    es: "Preparado para conectividad con Plex y futuras comprobaciones de presencia en la librería.",
    en: "Prepared for Plex connectivity and later library presence checks.",
  },
  "settings.serverUrl": { es: "URL del servidor", en: "Server URL" },
  "settings.apiKey": { es: "API Key", en: "API Key" },
  "settings.embyApiPlaceholder": { es: "API key de Emby", en: "Emby API key" },
  "settings.embyHelp": {
    es: "Dashboard → API Keys → crea una key. Incluye protocolo y puerto en la URL.",
    en: "Dashboard → API Keys → create a key. Include protocol and port in the URL.",
  },
  "settings.plexToken": { es: "Token de Plex", en: "Plex Token" },
  "settings.plexTokenPlaceholder": {
    es: "Tu X-Plex-Token",
    en: "Your X-Plex-Token",
  },
  "settings.plexHelp": {
    es: "Usa la URL del servidor y tu X-Plex-Token desde Plex Web o el flujo de claim.",
    en: "Use your server URL and X-Plex-Token from Plex Web or the claim flow.",
  },
  "settings.folderTypesTitle": { es: "Tipos de carpeta", en: "Folder Types" },
  "settings.folderTypesDescription": {
    es: "Asigna tus carpetas raíz del FTP a películas, series, documentales o contenido mixto para mejorar la categorización.",
    en: "Map your FTP root folders to movies, TV shows, documentaries, or mixed content for better categorization.",
  },
  "settings.folderTypesHelp": {
    es: "Estas asignaciones alimentan las pestañas de categorías, el matching y las carpetas de destino.",
    en: "These mappings drive category tabs, metadata matching, and destination folders.",
  },
  "settings.loadRootFolders": {
    es: "Cargar carpetas raíz FTP",
    en: "Load FTP Root Folders",
  },
  "settings.loading": { es: "Cargando…", en: "Loading…" },
  "settings.folderRowHelp": {
    es: "Elige cómo debe aparecer el contenido de esta carpeta raíz en la librería.",
    en: "Choose how content inside this root folder should appear in the library.",
  },
  "settings.ignore": { es: "Ignorar", en: "Ignore" },
  "settings.movies": { es: "Películas", en: "Movies" },
  "settings.tvShows": { es: "Series", en: "TV Shows" },
  "settings.documentaries": { es: "Documentales", en: "Documentaries" },
  "settings.mixed": { es: "Mixto (auto-detectar)", en: "Mixed (auto-detect)" },
  "settings.noRootFolders": {
    es: "Todavía no se han cargado carpetas raíz del FTP.",
    en: "No FTP root folders loaded yet.",
  },
  "settings.footerHelp": {
    es: "Guarda los cambios ahora o guarda y lanza un nuevo escaneo de la librería inmediatamente.",
    en: "Save configuration changes now, or save and trigger a fresh library scan immediately.",
  },
  "settings.saveAndReindex": {
    es: "Guardar y reindexar",
    en: "Save & Re-index",
  },
} as const;

export function t(
  language: AppLanguage,
  key: keyof typeof messages,
  vars?: Record<string, string | number>,
) {
  let value: string = messages[key][language];
  if (!vars) return value;
  for (const [name, replacement] of Object.entries(vars)) {
    value = value.split(`{${name}}`).join(String(replacement));
  }
  return value;
}
