# syntax=docker/dockerfile:1.7

FROM ubuntu:22.04 AS build

ARG NODE_MAJOR=22
ENV DEBIAN_FRONTEND=noninteractive
ENV CARGO_HOME=/usr/local/cargo
ENV RUSTUP_HOME=/usr/local/rustup
ENV PATH=/usr/local/cargo/bin:/usr/local/bin:${PATH}

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        ca-certificates \
        curl \
        file \
        gnupg \
        libayatana-appindicator3-dev \
        libgtk-3-dev \
        libssl-dev \
        librsvg2-dev \
        libwebkit2gtk-4.1-dev \
        patchelf \
        pkg-config \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
        | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
        > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

RUN curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs \
    | sh -s -- -y --profile minimal --default-toolchain stable

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

RUN npm run build
RUN cargo build --manifest-path src-tauri/Cargo.toml --release --locked


FROM ubuntu:22.04 AS runtime

ENV DEBIAN_FRONTEND=noninteractive
ENV DISPLAY=:0
ENV GDK_BACKEND=x11
ENV LIBGL_ALWAYS_SOFTWARE=1
ENV NO_AT_BRIDGE=1
ENV WEBKIT_DISABLE_COMPOSITING_MODE=1
ENV HOME=/config/home
ENV XDG_CONFIG_HOME=/config/config
ENV XDG_CACHE_HOME=/config/cache
ENV XDG_DATA_HOME=/config/share
ENV VNC_PORT=5900
ENV NOVNC_PORT=6080
ENV VNC_RESOLUTION=1440x960
ENV VNC_COL_DEPTH=24
ENV OSCATA_WEBGUI_HOST=0.0.0.0
ENV OSCATA_WEBGUI_PORT=47860
ENV OSCATA_WEBGUI_EXPOSED_PORT=47860
ENV OSCATA_BOOTSTRAP_WEBGUI=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        dbus-x11 \
        fluxbox \
        libasound2 \
        libatk-bridge2.0-0 \
        libayatana-appindicator3-1 \
        libgbm1 \
        libglib2.0-0 \
        libgtk-3-0 \
        libnss3 \
        libssl3 \
        librsvg2-2 \
        libwebkit2gtk-4.1-0 \
        libxss1 \
        novnc \
        procps \
        sqlite3 \
        websockify \
        x11-utils \
        x11vnc \
        xauth \
        xdg-utils \
        xvfb \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/oscata

COPY --from=build /app/src-tauri/target/release/oscata-tauri /opt/oscata/oscata-tauri
COPY --from=build /app/dist /opt/oscata/dist
COPY --from=build /app/src-tauri/resources /opt/oscata/resources
COPY docker/entrypoint.sh /usr/local/bin/oscata-entrypoint

RUN chmod +x /usr/local/bin/oscata-entrypoint /opt/oscata/oscata-tauri \
    && mkdir -p /config/home /config/config /config/cache /config/share /downloads

EXPOSE 5900 6080 47860
VOLUME ["/config", "/downloads"]

ENTRYPOINT ["/usr/local/bin/oscata-entrypoint"]

