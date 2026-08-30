# RC1 SPOTIO Sequential Upload Acceptance Plan

Run this plan only against the SPOTIO additive/canonical import release-candidate build.

## Upload A

Import five unique, valid, redacted SPOTIO leads. Record the resulting canonical lead IDs. Assign two leads and disposition at least one.

## Upload B

Import:

- two new valid leads;
- one updated lead from Upload A;
- two Upload A leads omitted from the file.

## Required results

- The live pool contains the five Upload A leads plus the two new Upload B leads: seven unique leads.
- The updated lead keeps the same canonical McCoy lead ID.
- Omitted Upload A leads remain active and visible.
- Existing assignment, disposition, activity, and verified-coordinate data remain attached to the canonical leads.
- Re-uploading Upload B adds zero duplicate leads.
- An incomplete upload never hides or archives any prior active lead.
- `import_batch_id` remains audit/provenance metadata and does not control live visibility.

## Release decision

Do not merge the release-candidate PR until this sequential-upload test passes and the Admin, Manager, and Rep Lead Pool counts reconcile with the database scope counts.
