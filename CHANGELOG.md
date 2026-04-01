# Historial de cambios

## [0.3.0] - 2026-04-01

### Sistema de temas

- Añadido hook `useTheme` con soporte para tema oscuro, claro y predeterminado del sistema.
- Nuevo componente `ThemeToggle` con iconos actualizados para alternar entre modos de color.
- Introducidas variables CSS para el tema claro (`light theme`).
- El selector de tema integrado en la barra de navegación del modo escritorio y del modo web.
- Nueva sección de selección de tema en Ajustes, accesible desde ambas superficies (escritorio y web).
- Añadido `ThemeProvider` como proveedor global compartido en `main.tsx`.

### Paridad web / escritorio

- Corregidas todas las llamadas directas a `invoke()` en la pantalla de Ajustes; las características exclusivas del escritorio ahora se protegen correctamente con `isTauri()`.
- El panel de detalle ahora utiliza una función de apertura de URL compatible con la plataforma en lugar de importar `openUrl` de forma estática (falla en modo web).
- El botón "Abrir carpeta" en la pestaña de descargas se oculta en el modo web, ya que depende del sistema de archivos nativo.
- Añadido polling periódico en `useIndexing` para el modo web, manteniendo la biblioteca sincronizada sin depender de eventos de Tauri.

### Mejoras de rendimiento (backend Rust)

- Las expresiones regulares del parser ahora se compilan una sola vez mediante `LazyLock`, eliminando la recompilación en cada llamada.
- Las operaciones en lotes de la base de datos se envuelven en transacciones explícitas, reduciendo significativamente el tiempo de escritura.
- Las peticiones HTTP a TMDB se paralelizan usando `tokio::join!`, acelerando el enriquecimiento de metadatos.
- El enriquecimiento de TMDB se desacopla del bucle de indexación principal, permitiendo que el rastreo FTP continúe sin esperar respuestas de la API.
- Los eventos de progreso IPC se agrupan en lotes de 50 archivos por emisión, reduciendo la carga de comunicación entre frontend y backend.
- El rastreo FTP se optimiza con una cola compartida y workers concurrentes, mejorando drásticamente la velocidad de indexación en servidores grandes.

### Mejoras de rendimiento (frontend / caché)

- La caché de insignias (badges) se hace pública e invalida automáticamente al detectar cambios de configuración.

### Experiencia de indexación

- Mensaje de finalización con resumen automático y notificaciones tipo toast al completar la indexación.
- El estado de progreso del wizard (StepFTP) incluye un estado de transición para gestionar correctamente la carga del botón.
- Eliminado el recuento de carpetas del mensaje de detalle de escaneo para simplificar la interfaz.

### Mejoras de UI y refactorización

- Componentes de interfaz mejorados: estilos, espaciado y disposición general ajustados.
- Utilidades de filtro (`filterUtils`) refactorizadas e integradas directamente en los componentes que las consumen.
- Actualizada la visibilidad de la estructura `MediaServerCheck` y mejorada la lógica de caché de presencia en el servidor.

---

## [0.2.6] - versión anterior

Para el historial completo de versiones anteriores, consulta el repositorio git.
