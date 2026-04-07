# syntax=docker/dockerfile:1.7

# ─── Base: system deps + Rust toolchain (shared by planner & cacher) ─────────
FROM ubuntu:22.04 AS base

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

RUN curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs \
    | sh -s -- -y --profile minimal --default-toolchain stable

# ─── Planner: compute cargo-chef recipe from manifest files only ──────────────
FROM base AS planner
RUN cargo install cargo-chef --locked
WORKDIR /app
COPY src-tauri/ src-tauri/
WORKDIR /app/src-tauri
RUN cargo chef prepare --recipe-path recipe.json

# ─── Rust cache: pre-compile all dependencies ─────────────────────────────────
# This layer is only invalidated when Cargo.toml or Cargo.lock changes.
# A pure .rs-file change skips this stage entirely and reuses the cache.
FROM base AS rust-cache
RUN cargo install cargo-chef --locked
WORKDIR /app/src-tauri
COPY --from=planner /app/src-tauri/recipe.json recipe.json
RUN cargo chef cook --release --locked --recipe-path recipe.json

# ─── Full build ───────────────────────────────────────────────────────────────
FROM base AS build

ARG NODE_MAJOR=22

# Node.js (only needed in the full-build stage)
RUN mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
        | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
        > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# npm deps layer — cached unless package.json / package-lock.json change
COPY package.json package-lock.json ./
RUN npm ci

# Bring in pre-compiled Rust deps so cargo only compiles the app crate
COPY --from=rust-cache /app/src-tauri/target src-tauri/target
COPY --from=rust-cache /usr/local/cargo /usr/local/cargo

COPY . .

RUN npm run build
RUN cargo build --manifest-path src-tauri/Cargo.toml --release --locked


FROM ubuntu:22.04 AS runtime

ENV DEBIAN_FRONTEND=noninteractive
ENV DISPLAY=:99
ENV GDK_BACKEND=x11
ENV LIBGL_ALWAYS_SOFTWARE=1
ENV NO_AT_BRIDGE=1
ENV WEBKIT_DISABLE_COMPOSITING_MODE=1
ENV HOME=/config/home
ENV XDG_CONFIG_HOME=/config/config
ENV XDG_CACHE_HOME=/config/cache
ENV XDG_DATA_HOME=/config/share
# Headless web-UI mode: force-enable the built-in web server and hide
# the Tauri desktop window. Override these in docker-compose or docker run.
ENV OSCATA_WEBGUI=1
ENV OSCATA_HEADLESS=1
ENV OSCATA_WEBGUI_HOST=0.0.0.0
ENV OSCATA_WEBGUI_PORT=47860
ENV OSCATA_WEBGUI_EXPOSED_PORT=47860

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        dbus-x11 \
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
        sqlite3 \
        xvfb \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/oscata

COPY --from=build /app/src-tauri/target/release/oscata-tauri /opt/oscata/oscata-tauri
COPY --from=build /app/dist /opt/oscata/dist
COPY --from=build /app/src-tauri/resources /opt/oscata/resources
COPY docker/entrypoint.sh /usr/local/bin/oscata-entrypoint

RUN chmod +x /usr/local/bin/oscata-entrypoint /opt/oscata/oscata-tauri \
    && mkdir -p /config/home /config/config /config/cache /config/share /downloads

EXPOSE 47860
VOLUME ["/config", "/downloads"]

ENTRYPOINT ["/usr/local/bin/oscata-entrypoint"]
