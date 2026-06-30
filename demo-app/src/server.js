import { createShortenerApp } from './app.js';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';
const { app } = createShortenerApp();

app.listen(port, host, () => {
  console.log(`URL shortener listening on http://${host}:${port}`);
});
