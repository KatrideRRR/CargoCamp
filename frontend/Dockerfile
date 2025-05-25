# frontend/Dockerfile
FROM node:18 as builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install

COPY . .
RUN npm run build


# Production image with nginx
FROM nginx:alpine
COPY --from=builder /app/build /usr/share/nginx/html

# Копируем кастомный nginx конфиг
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
