# Inventory Item Type Production Cleanup

Use this when production inventory data still contains legacy item types such as `GENERAL`, `--`, or `- -`.

## Goal

- Convert `--` and `- -` to `OTHER`.
- Convert `GENERAL` to `OTHER`.
- Keep inventory rows intact. Do not delete inventory items.
- Prevent legacy values from being created again after cleanup.

## 1. Back Up Production Database

Run a database backup before changing production data.re

```bash
pg_dump "$DATABASE_URL" > backup-before-inventory-type-cleanup.sql
```

## 2. Inspect Current Item Types

```sql
SELECT "Item_Type", COUNT(*)
FROM "Item"
GROUP BY "Item_Type"
ORDER BY COUNT(*) DESC;
```

Confirm how many rows currently use `GENERAL`, `--`, or `- -`.

## 3. Run Cleanup In A Transaction

```sql
BEGIN;

UPDATE "Item"
SET "Item_Type" = 'OTHER'
WHERE TRIM("Item_Type") IN ('--', '- -', 'GENERAL');

SELECT "Item_Type", COUNT(*)
FROM "Item"
GROUP BY "Item_Type"
ORDER BY COUNT(*) DESC;
```

Review the result before committing.

If the result is correct:

```sql
COMMIT;
```

If the result is wrong:

```sql
ROLLBACK;
```

## 4. Verify Legacy Values Are Gone

```sql
SELECT "Item_Type", COUNT(*)
FROM "Item"
WHERE TRIM("Item_Type") IN ('--', '- -', 'GENERAL')
GROUP BY "Item_Type";
```

Expected result: no rows.

## 5. Prevent Future Legacy Values

After deployment, confirm the app no longer creates `GENERAL`, `--`, or `- -`.

Recommended application behavior:

- Default new inventory item types to `OTHER` when no specific type applies.
- Treat imported `GENERAL`, `--`, and `- -` as `OTHER`.
- Do not show `--` as an item type option in the UI.

Optional database guard after cleanup:

```sql
ALTER TABLE "Item"
ADD CONSTRAINT item_type_no_legacy_values
CHECK ("Item_Type" NOT IN ('GENERAL', '--', '- -'));
```

Only add the constraint after confirming production data has already been cleaned.
