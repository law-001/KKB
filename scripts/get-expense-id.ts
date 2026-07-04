// Dev helper: print the id of an expense by description (for scripted checks).
import { eq } from "drizzle-orm";
import { db, tables } from "../src/lib/db";

async function main() {
  const [row] = await db
    .select({ id: tables.expenses.id })
    .from(tables.expenses)
    .where(eq(tables.expenses.description, process.argv[2]));
  console.log(row?.id ?? "");
}

main().then(() => process.exit(0));
