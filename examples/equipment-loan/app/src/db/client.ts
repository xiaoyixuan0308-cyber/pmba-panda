import "server-only";
import path from "node:path";
import { openDb } from "./open";

const file = process.env.DB_FILE ?? path.join(process.cwd(), "data", "app.db");

const globalForDb = globalThis as unknown as { app?: ReturnType<typeof openDb> };
const app = globalForDb.app ?? openDb(file);
if (process.env.NODE_ENV !== "production") globalForDb.app = app;

export const sqlite = app.sqlite;
export const db = app.db;
