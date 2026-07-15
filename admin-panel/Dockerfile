FROM node:18

RUN npm install -g serve

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci

COPY . .

RUN npm run build

EXPOSE 8080

CMD ["serve", "-s", "build", "-l", "8080"]