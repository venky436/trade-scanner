import "dotenv/config";
import { buildServer } from "./server.js";

const PORT = Number(process.env.PORT) || 4000;

async function main() {
  const server = await buildServer();

  await server.listen({ port: PORT, host: "0.0.0.0" });
  console.log(`Server running on http://localhost:${PORT}`);
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
