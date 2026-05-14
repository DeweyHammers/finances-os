# Finances OS

A personal cash-flow workstation for planning a weekly paycheck against monthly bills. Income lands once a week, expenses are bucketed into four weekly cycles (Q1–Q4), and the dashboard shows what's left over for each pay period at a glance.

The app opens on the **Plan** (zero-based budget) by default. Other sections live under **Budget** (Plan, Statistics, Payees), **Cash** (per-account ledgers), and **Expenses** (Overview, Bills, Personal, Yearly Costs).

## Core Features

### 🧮 Plan (YNAB-style Budget)
- Monthly **zero-based budget** table: every dollar of income gets assigned a job.
- Sticky **Ready to Assign** pill at the top, color-coded (green = balanced, yellow = unassigned, red = over-assigned).
- **Category groups → items**, drag-reorder within and across groups.
- **Three modes for adding items:** pull from existing **Bills**, pick a **Personal** name (auto-aggregated across all four cycles), or type a **Custom** item with name + amount + optional cycle tag.
- **Auto-Assign Q1 / Q2 / Q3 / Q4** buttons fill the right amount for every sourced item in one click.
- Inline-edit the **Assigned** cell; calculator-style (`+50` to add) supported.
- **Move Money** popover off any Available pill to cover overspending YNAB-style.
- Activity + Available are derived live from your transactions.

### 📊 Statistics
- Top-level tabs split the page by series: **Spending** (red) / **Income** (green). Default is Spending.
- Inner tabs flip between **Yearly Overview** (12-month stacked bar chart per item / per payee) and **Month-to-Month** (donut chart for the selected month with per-item / per-source breakdown on hover).
- KPI tiles per series: **{Year} Total**, **Monthly Average**, **Highest Month**. Spending also surfaces **To Wife** and **To Wife Average** tiles, derived from any category item literally named "To Wife".
- Year and month pickers are chevron pills (←/→) inside each inner view.
- **Click a month** in any Yearly bar chart to drill into that month's pie in the Month-to-Month view (same series).
- Income is detected as any `AccountTransaction` with `memo.trim().toLowerCase() === "income"` and positive `inflowCents`, grouped by payee.

### 💵 Cash & Accounts
- Manual **Accounts** (Checking, Savings, etc.) with derived balances — never out of sync with your transactions.
- Editing an account's **Working Balance** writes a tagged adjustment transaction so Ready to Assign tracks reality.
- Per-account **transaction ledger** with date, payee, category, memo, outflow, inflow.
- **YNAB-style search** above each ledger — a single input filters across payee, category (live name or post-deletion snapshot), memo, and inflow/outflow amounts (supports `$1,234.56`, `1234.56`, and `1234` formats).
- **Date+time sort** — new transactions stamp the current time-of-day onto the picked date so today's entries land at the top of the same day; edits preserve the original timestamp unless the date changes.
- **Category snapshot on delete** — deleting a `BudgetCategoryItem` first snapshots its name onto every linked transaction (`AccountTransaction.categoryName`), so the historical category remains visible (rendered italic + "(deleted)" suffix) after the relation is severed.
- **Payees** library with freeSolo Autocomplete — typing a new name auto-creates a payee; deletes set transaction payee to null without losing the transaction.
- Sidebar shows **Cash $TOTAL** with each account name + live balance and a hover-pencil that opens an edit modal in place.

### 📅 Expenses
- **Overview:** Top-of-section landing page summarizing the upcoming Cash Flow & Allowance, Bills, Personal, and Yearly Costs in one scroll.
- **Bills:** Recurring monthly bills assigned to a specific weekly cycle (Q1–Q4) and due day.
- **Personal:** Personal/household items budgeted against a cycle (one record per cycle, e.g. "Gas Q1 $50, Gas Q2 $50, …").
- **Yearly Costs:** Annual expenses scheduled by month and day.

### ⚙️ Settings
- Single weekly income value drives the dashboard cycle projections (separate from the Plan's Ready-to-Assign pool).

## 🧪 Tests

```bash
npm test           # Run the suite once
npm run test:watch # Watch mode
npm run test:ui    # Vitest UI dashboard
```

Vitest + Testing Library + Supertest. 88 tests covering the budget math (cents, activity, available, RTA, auto-assign cycle resolver, move-money, balance adjustments), the form components (AssignedCell, PayeeAutocomplete, SiderAccountRow), and the API server's body coercion.

## 🛠 Technical Architecture

- **Desktop Core:** **Nextron** (Electron + Next.js) for a native desktop experience.
- **Backend:** Self-contained **Express API** running inside the Electron main process (port 5858).
- **UI Framework:** **Refine** + **Material UI (MUI)** with a custom dark theme.
- **Data Layer:** **Prisma** + local **SQLite**.
- **Production Storage:** Database lives at `%APPDATA%\finances-os\database.db` so data survives app updates.

## 🚀 Running the App

### Production Mode (Recommended)
1. **Build:**
   ```bash
   npm run build
   ```
2. **Launch:**
   - Run `dist\win-unpacked\Finances OS.exe`, or
   - Use the desktop shortcut created by the setup script.

3. **Shortcut Setup (Bypassing Windows Smart App Control):**
   Windows 11 may block local unsigned executables. To bypass safely while still using your production build, run:
   ```powershell
   powershell.exe -ExecutionPolicy Bypass -File setup-desktop-icon.ps1
   ```
   The shortcut launches via the **signed Electron host**, which Windows trusts.

### Development Mode
```bash
npm run dev
```

### Syncing dev ↔ prod data
Two helper scripts copy the SQLite database file between the dev workspace and the installed app's userData. Both auto-back up the destination before overwriting (timestamped `.bak` file alongside it).

```bash
npm run db:pull   # copy %APPDATA%\finances-os\database.db  →  prisma\dev.db
npm run db:push   # copy prisma\dev.db  →  %APPDATA%\finances-os\database.db
```

When changing the Prisma schema, push to the dev DB and regenerate the typed client:
```bash
npx prisma db push      # apply schema to prisma\dev.db
npx prisma generate     # regenerate node_modules\.prisma\client (stop dev server first — Electron locks the engine DLL)
```

## 📂 Project Structure

- `/main` — Electron main process and Express API server.
- `/renderer` — Next.js frontend (dashboard, lists, forms).
- `/shared` — Prisma client and shared utilities used by both processes.
- `/prisma` — Database schema and seed.
- `/resources` — App icons and platform assets.
- `/_archived` — Snapshots of removed/superseded features (e.g. the original EDD/Upwork build, the bi-weekly cycle model) preserved for reference or revert.
