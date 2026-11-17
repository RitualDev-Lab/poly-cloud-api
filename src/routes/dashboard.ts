import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getDashboardHtml } from "../dashboard/html.js";

export async function registerDashboardRoutes(app: FastifyInstance): Promise<void> {
  const html = getDashboardHtml();

  // GET /dashboard - Serve live interactive web dashboard
  app.get("/dashboard", async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.header("Content-Type", "text/html; charset=utf-8");
    return reply.send(html);
  });

  // GET / - Root route redirects directly to /dashboard
  app.get("/", async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.redirect("/dashboard");
  });
}
