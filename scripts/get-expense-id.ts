// Dev helper: print the id of an expense by description (for scripted checks).
import Database from "better-sqlite3";
const db = new Database("./data/splitweird.db");
const row = db
  .prepare("SELECT id FROM expenses WHERE description = ?")
  .get(process.argv[2]) as { id: string } | undefined;
console.log(row?.id ?? "");
