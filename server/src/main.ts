import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: process.env.CORS_ORIGIN ?? "http://localhost:5173" });
  app.enableShutdownHooks(); // ensures persistence flush on SIGTERM
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`MinerBlast server listening on port ${port}`);
}

bootstrap();
