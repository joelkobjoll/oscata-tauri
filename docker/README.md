# Docker — Oscata sin interfaz gráfica

Instala Oscata como contenedor Docker con la interfaz web (`OSCATA_WEBGUI=1`) activa y sin escritorio VNC. El binario arranca en modo headless: la ventana de escritorio está oculta y el acceso es exclusivamente por el navegador.

## Uso rápido

```bash
# Construir la imagen
npm run docker:build

# Arrancar
npm run docker:up
```

La interfaz web queda disponible en `http://localhost:47860`.

## docker-compose

Copia el ejemplo y ajusta los puertos y rutas:

```bash
cp docker/docker-compose.example.yml docker-compose.yml
docker compose up -d
```

## Variables de entorno

| Variable | Defecto | Descripción |
|---|---|---|
| `OSCATA_WEBGUI_PORT` | `47860` | Puerto de escucha interno |
| `OSCATA_WEBGUI_EXPOSED_PORT` | `47860` | Puerto externo (útil detrás de un proxy inverso) |
| `OSCATA_WEBGUI_HOST` | `0.0.0.0` | IP de escucha interna |
| `OSCATA_WEBGUI_APP_URL` | — | URL externa para enlaces en emails |
| `OSCATA_WEBGUI_OTP_ENABLED` | `0` | Activa OTP por email en el login |

`OSCATA_WEBGUI=1` y `OSCATA_HEADLESS=1` ya están definidos en la imagen; no hace falta pasarlos.

## Proxy inverso (nginx / Caddy / Traefik)

Expón el puerto 47860 internamente y mapea el externo mediante `OSCATA_WEBGUI_EXPOSED_PORT`:

```yaml
environment:
  OSCATA_WEBGUI_PORT: "47860"
  OSCATA_WEBGUI_EXPOSED_PORT: "80"  # o 443
```

## Datos persistentes

| Ruta en contenedor | Contenido |
|---|---|
| `/config` | Base de datos SQLite, configuración, caché |
| `/downloads` | Archivos descargados |

## Helper script

```bash
npm run docker:build    # construye la imagen
npm run docker:run      # arranca el contenedor (restart: unless-stopped)
npm run docker:up       # build + run en un paso
npm run docker:stop     # para y elimina el contenedor
npm run docker:logs     # muestra los logs en tiempo real
```

Personaliza con variables de entorno o un fichero `.env.docker`:

```bash
cp .env.docker.example .env.docker
# Edita .env.docker y luego:
npm run docker:up
```
