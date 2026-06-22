# Project Rules

## PROTECTED MODULE: `/simulation` (DO NOT MODIFY)

The existing `/simulation` page is a **completed and stable feature**.

- File: `gridsense/web/src/app/simulation/page.tsx` (and anything it imports for simulation-only use).

**Hard constraints:**

- Do **not** modify it.
- Do **not** replace it.
- Do **not** redesign it.
- Do **not** migrate functionality out of it.

Treat `/simulation` as a **protected legacy module and engineering sandbox**. It must continue to work exactly as it does today.

**Where new work goes instead:**

- Any new functionality must be implemented in **new** modules, pages, services, or components.
- If a Digital Twin, Operations Center, Workflow Manager, Incident Manager, Resource Manager, or Command Center is required, create it **separately** without changing existing simulation behavior.
- New features may *read from* shared/existing services, but must not alter simulation behavior or its files.

If a requested change appears to require touching `/simulation`, stop and confirm with the user before proceeding.
