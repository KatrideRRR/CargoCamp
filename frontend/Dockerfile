# =========================================================
# FRONTEND BUILD
# =========================================================

FROM node:22-bookworm-slim AS builder

WORKDIR /app

ENV npm_config_fetch_retries=5
ENV npm_config_fetch_retry_factor=2
ENV npm_config_fetch_retry_mintimeout=20000
ENV npm_config_fetch_retry_maxtimeout=180000
ENV npm_config_fetch_timeout=600000

COPY package.json package-lock.json ./

# sharp относится к инструментам Capacitor/assets и не нужен
# для создания обычного React build.
# --ignore-scripts запрещает скачивание libvips с GitHub.
RUN npm ci --legacy-peer-deps --ignore-scripts

COPY . .

RUN npm run build


# =========================================================
# NGINX PRODUCTION
# =========================================================

FROM nginx:alpine

COPY --from=builder /app/build /usr/share/nginx/html

COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]