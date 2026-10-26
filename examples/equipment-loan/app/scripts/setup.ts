/**
 * npm run setup — create a fresh database and load the demo data.
 * Safe to run any time: it always resets the demo to the same starting point.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as s from "../src/db/schema";
import {
  DEMO_TODAY,
  LATE_FEE_CAP,
  LATE_FEE_PER_DAY,
  buildEquipment,
  buildPeople,
  generateHistory,
  hashPassword,
  importLedger,
  writeImportReport,
  type LoanRow,
} from "./demo-data";

const root = path.resolve(__dirname, "..");
const dbFile = process.env.DB_FILE ?? path.join(root, "data", "app.db");
const ledgerCsv = path.resolve(root, "..", "spec", "00-materials", "M1-loan-register.csv");

fs.mkdirSync(path.dirname(dbFile), { recursive: true });
for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) fs.rmSync(f, { force: true });

const sqlite = new Database(dbFile);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
const db = drizzle(sqlite, { schema: s });
migrate(db, { migrationsFolder: path.join(root, "drizzle") });

const people = buildPeople();
const equipment = buildEquipment();
const ledger = importLedger(ledgerCsv);
const reserved = new Set(ledger.loans.flatMap((l) => l.items).concat(["AV-0103", "DRN-0002", "TRI-0040", "LGT-0007", "CAM-0011", "CAM-0012"]));
const generated = generateHistory(people, equipment, reserved);
const loans: LoanRow[] = [...ledger.loans, ...generated];

const pwd = hashPassword();

db.transaction((tx) => {
  const personId = new Map<string, number>();
  for (const p of people) {
    const row = tx
      .insert(s.people)
      .values({
        kind: p.kind,
        name: p.name,
        email: p.email,
        phone: p.phone,
        passwordHash: pwd,
        borrowerNo: p.kind === "borrower" ? p.key : null,
        borrowerType: p.borrowerType ?? null,
        department: p.department ?? null,
        staffNo: p.kind === "staff" ? p.key : null,
        staffRole: p.staffRole ?? null,
      })
      .returning({ id: s.people.id })
      .get();
    personId.set(p.key, row.id);
  }
  const staffByRole = (role: s.StaffRole) => personId.get(people.find((p) => p.staffRole === role)!.key)!;

  const equipmentId = new Map<string, number>();
  for (const e of equipment) {
    const row = tx.insert(s.equipment).values(e).returning({ id: s.equipment.id }).get();
    equipmentId.set(e.assetTag, row.id);
  }

  for (const l of loans) {
    const borrowerId = personId.get(l.borrower);
    if (!borrowerId) throw new Error(`Unknown borrower ${l.borrower} on ${l.loanNo}`);
    const { id } = tx
      .insert(s.loans)
      .values({
        loanNo: l.loanNo,
        borrowerId,
        status: l.status,
        purpose: l.purpose,
        teaching: l.teaching,
        offCampus: l.offCampus,
        startDate: l.startDate,
        dueDate: l.dueDate,
        submittedAt: l.submittedAt,
        assetTagsVerifiedAt: l.assetTagsVerifiedAt ?? null,
        checkOutDate: l.checkOutDate ?? null,
        returnDate: l.returnDate ?? null,
        closingReason: l.closingReason ?? null,
      })
      .returning({ id: s.loans.id })
      .get();
    for (const tag of l.items) {
      const eid = equipmentId.get(tag);
      if (!eid) throw new Error(`Unknown asset tag ${tag} on ${l.loanNo}`);
      tx.insert(s.loanItems).values({ loanId: id, equipmentId: eid }).run();
    }
    for (const a of l.approvals) {
      tx.insert(s.approvals)
        .values({ loanId: id, approverId: staffByRole(a.role), approverRole: a.role, decision: a.decision, comment: a.comment ?? null, decidedAt: a.decidedAt })
        .run();
    }
    if (l.agreementSignedAt) {
      tx.insert(s.agreements).values({ loanId: id, termsVersion: "2026-01", signedAt: l.agreementSignedAt }).run();
    }
    if (l.lateFee) {
      tx.insert(s.lateFees).values({ loanId: id, ...l.lateFee, paidAt: l.lateFee.paidAt ?? null }).run();
    }
    for (const a of l.audit) {
      const actorId = a.actor === "system" ? null : a.actor === "borrower" ? borrowerId : staffByRole(a.actor);
      tx.insert(s.auditEntries)
        .values({
          actorId,
          action: a.action,
          objectType: "Loan",
          objectId: id,
          before: a.before ?? null,
          after: a.after ?? a.note ?? null,
          at: a.at,
        })
        .run();
    }
  }

  const settings: Record<string, string> = {
    lateFeePerDay: String(LATE_FEE_PER_DAY),
    lateFeeCap: String(LATE_FEE_CAP),
    reminderWorkingDays: "2",
    simulatedToday: DEMO_TODAY,
    registryAvailable: "true",
    registryInvalidTags: "CAM-0013",
    agreementTermsVersion: "2026-01",
  };
  for (const [key, value] of Object.entries(settings)) tx.insert(s.settings).values({ key, value }).run();
});

writeImportReport(path.join(root, "data", "import-report.md"), ledger.issues, ledger.loans.length);

const count = (t: string) => (sqlite.prepare(`select count(*) n from ${t}`).get() as { n: number }).n;
console.log(`Database ready: ${dbFile}`);
console.log(`  people ${count("people")}, equipment ${count("equipment")}, loans ${count("loans")}, audit ${count("audit_entries")}`);
console.log(`  ledger: ${ledger.loans.length} imported, ${ledger.issues.filter((i) => i.kind === "rejected").length} not imported (see data/import-report.md)`);
console.log(`  demo today: ${DEMO_TODAY}; demo password for every account: see README`);
sqlite.close();
