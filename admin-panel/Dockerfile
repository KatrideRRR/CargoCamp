FROM node:18

WORKDIR /app
COPY package.json ./
RUN npm install

COPY . .
RUN npm run build  # Сборка React-приложения

EXPOSE 8080
CMD ["sh", "-c", "npm start"]
