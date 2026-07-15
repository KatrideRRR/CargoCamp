FROM node:20

RUN npm install -g serve

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci --legacy-peer-deps

COPY . .

RUN npm run build

EXPOSE 8080

CMD ["serve", "-s", "build", "-l", "8080"]