FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci && sha256sum package-lock.json > node_modules/.lock-hash

COPY . .

EXPOSE 5180
CMD ["sh", "/app/entrypoint.sh"]
