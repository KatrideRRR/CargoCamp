FROM node:18

# Устанавливаем утилиту serve для раздачи билда
RUN npm install -g serve

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install

RUN npm ci

COPY . .
RUN npm run build

# Экспонируем нужный порт
EXPOSE 8080

# Запускаем продакшн-сервер
CMD ["serve", "-s", "build", "-l", "8080"]
