FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .

EXPOSE 3000

ENV PORT=3000
ENV ZIP_ROOT=/data
ENV ZIP_OUTPUT_DIR=/output
ENV MAX_BROWSE_DEPTH=5

CMD ["npm", "start"]
