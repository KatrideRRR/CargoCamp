FROM node:18

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install

COPY . .
RUN npm run build  # Сборка React-приложения

EXPOSE 3000
CMD ["npx", "serve", "-s", "build"]
