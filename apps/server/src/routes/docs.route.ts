import type { FastifyInstance } from "fastify";
import { authMiddleware, adminGuard } from "../modules/auth/auth.middleware.js";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const DOCS_DIR = join(process.cwd(), "../../docs");

// Extract title from first # heading in markdown
function extractTitle(content: string, filename: string): string {
  const match = content.match(/^#\s+(.+)/m);
  return match ? match[1].trim() : filename.replace(".md", "").replace(/-/g, " ");
}

export async function docsRoute(fastify: FastifyInstance) {
  // List all docs
  fastify.get("/api/docs", { preHandler: [authMiddleware, adminGuard] }, async (_req, reply) => {
    try {
      const files = await readdir(DOCS_DIR);
      const docs = [];

      for (const file of files) {
        if (!file.endsWith(".md")) continue;
        const content = await readFile(join(DOCS_DIR, file), "utf-8");
        const name = file.replace(".md", "");
        docs.push({
          name,
          title: extractTitle(content, file),
          filename: file,
        });
      }

      // Sort alphabetically by title
      docs.sort((a, b) => a.title.localeCompare(b.title));
      return { docs };
    } catch (err: any) {
      return reply.status(500).send({ error: "Failed to read docs", detail: err.message });
    }
  });

  // Get single doc content
  fastify.get("/api/docs/:name", { preHandler: [authMiddleware, adminGuard] }, async (req, reply) => {
    const { name } = req.params as { name: string };

    // Sanitize: prevent directory traversal
    if (name.includes("..") || name.includes("/") || name.includes("\\")) {
      return reply.status(400).send({ error: "Invalid doc name" });
    }

    try {
      const filePath = join(DOCS_DIR, `${name}.md`);
      const content = await readFile(filePath, "utf-8");
      return { name, title: extractTitle(content, name), content };
    } catch (err: any) {
      if (err.code === "ENOENT") {
        return reply.status(404).send({ error: `Doc '${name}' not found` });
      }
      return reply.status(500).send({ error: "Failed to read doc", detail: err.message });
    }
  });
}
