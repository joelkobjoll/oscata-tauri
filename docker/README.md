# Docker — Oscata sin interfaz gráfica

Instala Oscata como contenedor Docker con la interfaz web activa y sin escritorio. El binario arranca en modo headless: la ventana de escritorio está oculta y el acceso es exclusivamente por el navegador.

## Inicio rápido — imagen publicada

La forma más sencilla es usar la imagen publicada automáticamente en GitHub Container Registry:

```bash
docker run -d \
  --name oscata \
  --restart unless-stopped \
  -p 47860:47860 \
  -v oscata-config:/config \
  -v oscata-downloads:/downloads \
  ghcr.io/joelkobjoll/oscata:latest
```

La interfaz web queda disponible en `http://localhost:47860`.

## Construir la imagen localmente

```bash
# Construir
npm run docker:build

# Construir + arrancar
npm run docker:up
```

## docker-compose

Copia el ejemplo y ajusta los puertos y rutas:

```bash
cp docker/docker-compose.example.yml docker-compose.yml
docker compose up -d
```

## Variables de entorno

Solo estas variables se leen del entorno en tiempo de arranque. El resto de la configuración (TMDB, FTP, SMTP, OTP, URL de la app…) se gestiona desde la propia interfaz web en Ajustes.

| Variable                     | Defecto   | Descripción                                      |
| ---------------------------- | --------- | ------------------------------------------------ |
| `OSCATA_WEBGUI_PORT`         | `47860`   | Puerto de escucha interno                        |
| `OSCATA_WEBGUI_HOST`         | `0.0.0.0` | IP de escucha interna                            |
| `OSCATA_WEBGUI_EXPOSED_PORT` | `47860`   | Puerto externo (útil detrás de un proxy inverso) |

`OSCATA_WEBGUI=1` y `OSCATA_HEADLESS=1` ya están definidos en la imagen; no hace falta pasarlos.

## Proxy inverso (nginx / Caddy / Traefik)

Expón el puerto 47860 internamente y mapea el externo mediante `OSCATA_WEBGUI_EXPOSED_PORT`:

```yaml
environment:
  OSCATA_WEBGUI_PORT: "47860"
  OSCATA_WEBGUI_EXPOSED_PORT: "80" # o 443
```

> **Importante:** Oscata usa WebSocket (`/api/ws`) para actualizar la biblioteca en tiempo real. Si usas nginx asegúrate de incluir las cabeceras de upgrade:
>
> ```nginx
> proxy_http_version 1.1;
> proxy_set_header Upgrade $http_upgrade;
> proxy_set_header Connection "upgrade";
> ```
>
> Caddy y Traefik gestionan esto automáticamente sin configuración adicional.

## Datos persistentes

| Ruta en contenedor | Contenido                                  |
| ------------------ | ------------------------------------------ |
| `/config`          | Base de datos SQLite, configuración, caché |
| `/downloads`       | Archivos descargados                       |

## Helper script (desarrollo / autoalojamiento local)

```bash
npm run docker:build    # construye la imagen local
npm run docker:run      # arranca el contenedor (restart: unless-stopped)
npm run docker:up       # build + run en un paso
npm run docker:stop     # para y elimina el contenedor
npm run docker:logs     # muestra los logs en tiempo real
```

Personaliza con un fichero `.env.docker`:

```bash
cp .env.docker.example .env.docker
# Edita .env.docker y luego:
npm run docker:up
```
