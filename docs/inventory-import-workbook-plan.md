# Inventory Workbook Import Plan

## Source File

Sample workbook reviewed:

- `C:\Users\Administrator\Documents\Coding\First SEM lab inventory AY 25-26.xlsx`

## What The Workbook Represents

The workbook is not a flat item list.

It is mostly organized as:

- one sheet per room
- one row per workstation or setup
- each row contains multiple component items for one setup

Example for lab sheets:

- `Table 1`
- CPU / NUC
- Power Adaptor
- Monitor
- Keyboard
- Mouse

This means a row is usually closer to a **PC setup** than to a single inventory item.

## Important Clarification

The `Table` column should **not** be treated as a person label for storage.

For example in `Faculty Office`, values such as:

- `Christian Maderazo`
- `Glenn Pepito`

should not be saved as inventory data if the goal is only to store items.

Per discussion, those names are irrelevant to the final inventory data.

-YES

## Recommended Direction

Do **not** add a `Table_Label` field to `Item`.

Recommended approach:

1. Treat each workstation row as a **PC setup**
2. Import component rows as `Item` records
3. When appropriate, also create or map a `Computer`
4. Link the imported `Item`s to that `Computer`

This matches the current data model better because the system already has:

- `Computer`
- linked component `Item`s
- room-based PCs

-YES

## Recommended Import Strategy

### 1. Lab Sheets

Sheets like:

- `LB400TC`
- `LB468TC`
- similar lab room sheets

Recommended behavior:

- each table row becomes one `Computer`
- row components become linked `Item`s
- `Table 1` becomes `PC 1`
- `Table 2` becomes `PC 2`

### Dynamic Computer Composition

Recommended rule:

- computer composition should be **dynamic**
- the importer should not require one fixed component list for every PC
- any recognized component found in the row can be linked to the `Computer`

This allows the import to support current and future variations such as:

- `MINI_PC`
- `MONITOR`
- `KEYBOARD`
- `MOUSE`
- `POWER_ADAPTER`
- other recognized PC-related inventory parts added later

Recommended handling for `Power Adapter`:

- allow it to be imported and linked to the PC when present
- do not require it for the row to be treated as a valid PC setup
- do not fail the row if it is missing

Why this is the safer direction:

- the workbook already varies by room
- some rooms list `Power Adaptor`, some may not
- future PC setups may include additional parts that are not part of the current fixed pattern
- a dynamic model fits the current schema better than hardcoding one permanent PC template

### 2. Standalone Assets

Rows or sections for assets like:

- TV
- Aircon
- Projector
- Printer
- Speaker

Recommended behavior:

- import as plain `Item`s only yes
- do not create a `Computer`

### 3. Office Sheets

Sheets like:

- `Faculty Office`
- `Department Office`

These can contain mixed content:

- workstation-like rows i think this would be good for now
- standalone equipment
- person-name row labels

Recommended default:

- ignore person names - yes
- import standalone assets as `Item`s can be set as PC still
- decide separately whether office workstation rows should also create `Computer` records

## What We Should Avoid

Avoid treating the workbook as if every row is just one item record with a simple label. -yes

That would force awkward data storage because:

- one row often contains multiple items
- the row concept is really a grouped setup
- the schema already has a better home for grouped setups: `Computer`

## Current Backend Status

The inventory importer was updated to read the workbook format more flexibly and insert item rows into `Item`.

Current support includes:

- room matching from sheet name or `Room No:`
- wide workstation row parsing
- standalone asset section parsing
- synthetic item code generation when no usable asset code exists

However, this is still fundamentally an **items-first import**.

## Recommended Next Phase

Refactor the workbook import into two paths:

### Path A: Item Import

Use for:

- TVs
- aircons
- projectors
- printers
- other standalone equipment

### Path B: PC Setup Import

Use for workstation rows where a row clearly represents one PC build/set.

Use this path to:

- create or update `Computer`
- create or connect component `Item`s
- maintain the relationship between the PC and its parts

## Decisions Still Needed

Before implementing the full PC-setup direction, confirm:

1. Which sheets should be treated as PC setup sheets? ROOMS with LB and etc
2. Should `Faculty Office` create PCs too, or only import standalone items? faculty can be set to pcs
3. When a PC already exists in a room, should import:
   - skip it
   - update it 
   - or create another PC

   Checks and Updates it
4. When an item asset code already exists, should import:
   - skip the item
   - update the item  (This one)
   - or fail the row
5. Which component types should be treated as valid PC parts for dynamic composition? this is the problem as there is a possibility that they will add new parts to the pc so im thinking that it will jsut read the asset code and its item type
6. If a row contains only some PC parts, what is the minimum rule for treating that row as a PC setup instead of plain items? consider it but leave others blank
7. If a future workbook adds another PC-related part not currently recognized, should the importer:
   - link it to the PC automatically if mapped yes
   - import it only as a plain item
   - or mark the row for review

## Best Default Recommendation

If no custom rules are given, use this default:

- lab sheets -> create/update `Computer` + component `Item`s
- office sheets -> import only standalone `Item`s
- existing asset codes -> skip existing items
- existing PCs in room -> update connections instead of duplicating

## Summary

The cleanest model is:

- workstation rows are **PC setups**
- standalone rows are **items**
- person names in the `Table` column are ignored this is another great solution

This avoids adding unnecessary fields and keeps the import aligned with the current schema.
