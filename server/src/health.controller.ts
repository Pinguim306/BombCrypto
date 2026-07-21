import { Controller, Get } from "@nestjs/common";

/** Liveness probe for the hosting platform (Railway healthcheck) and
 *  external uptime monitors. No auth, no side effects. */
@Controller("health")
export class HealthController {
  @Get()
  health() {
    return { ok: true };
  }
}
