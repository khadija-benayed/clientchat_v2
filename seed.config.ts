import "dotenv/config"; // Ajoute bien cette ligne tout en haut !
import { SeedPostgres } from "@snaplet/seed/adapter-postgres";
import { defineConfig } from "@snaplet/seed/config";
import postgres from "postgres";

export default defineConfig({
  adapter: () => {
    const client = postgres(process.env.DATABASE_URL as string);
    return new SeedPostgres(client);
  },
});