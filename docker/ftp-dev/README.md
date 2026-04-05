# FTP de desarrollo — Oscata

Servidor FTP local con Docker para probar Oscata sin necesidad de un servidor real.

## Arrancar

```bash
cd docker/ftp-dev
docker compose up -d
```

## Credenciales

| Campo    | Valor         |
| -------- | ------------- |
| Host     | `localhost`   |
| Puerto   | `21`          |
| Usuario  | `oscata`      |
| Password | `oscata123`   |
| Raíz FTP | `/Compartida` |

## Estructura de carpetas de ejemplo

```
/Compartida/
├── Peliculas BDRemux 1080p/
│   ├── The.Dark.Knight.2008.1080p.BluRay.REMUX.HEVC.DTS-HD.SPA.ENG.mkv
│   ├── Inception.2010.1080p.BluRay.REMUX.HEVC.DTS-HD.SPA.ENG.mkv
│   └── The.Shawshank.Redemption.1994.1080p.BluRay.REMUX.HEVC.DTS.SPA.ENG.mkv
├── Peliculas BDrip 1080p X265/
│   ├── Interstellar.2014.1080p.BluRay.x265.DTS.SPA.ENG.mkv
│   └── Oppenheimer.2023.1080p.BluRay.x265.EAC3.SPA.ENG.mkv
├── Peliculas UHDRemux 2160p/
│   ├── Dune.2021.2160p.UHD.BluRay.REMUX.HDR.HEVC.DTS-HD.SPA.ENG.mkv
│   └── Avatar.The.Way.of.Water.2022.2160p.UHD.BluRay.REMUX.HDR.HEVC.TrueHD.SPA.ENG.mkv
├── Peliculas WEB DL Micro 1080p/
│   └── Top.Gun.Maverick.2022.1080p.WEB-DL.HEVC.AAC.SPA.mkv
├── Peliculas WEB DL-UHDRip 2160p/
│   └── Barbie.2023.2160p.WEB-DL.HDR.HEVC.EAC3.SPA.ENG.mkv
├── Series HD 1080p/
│   ├── Breaking.Bad/
│   │   ├── Temporada.01/   (7 episodios)
│   │   └── Temporada.02/   (6 episodios)
│   └── The.Last.of.Us/
│       └── Temporada.01/   (9 episodios)
├── Series 4K 2160p/
│   └── Fallout/
│       └── Temporada.01/   (8 episodios)
└── Documentales 4K 2160p - HD 1080p/
    ├── Our.Planet.S01.2019.2160p.WEB-DL.HDR.HEVC.ENG.mkv
    └── Cosmos.A.Spacetime.Odyssey.S01E01.2014.1080p.BluRay.HEVC.DTS.SPA.ENG.mkv
```

> Los archivos `.mkv` son stubs vacíos — sirven para que el indexador de Oscata los detecte y parsee.

## Configuración en Oscata

En **Ajustes → Conexión FTP**:

- Host: `localhost`
- Puerto: `21`
- Usuario: `oscata`
- Contraseña: `oscata123`
- Raíz FTP: `/Compartida`

> Estos valores coinciden con los valores por defecto que ya trae la app configurados.

## Parar

```bash
docker compose down
```

## Añadir más archivos

Los archivos de la carpeta `media/` se montan directamente en el contenedor.
Basta con crear carpetas/archivos ahí y el FTP los expondrá de inmediato sin reiniciar.
