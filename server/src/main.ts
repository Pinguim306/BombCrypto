import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Comma-separated list so the Vercel URL and a custom domain can coexist.
  const origins = (process.env.CORS_ORIGIN ?? "http://localhost:5173")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins });
  app.enableShutdownHooks(); // ensures persistence flush on SIGTERM
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`MinerBlast server listening on port ${port}`);
}

bootstrap();
