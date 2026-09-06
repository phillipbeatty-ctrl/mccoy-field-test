# End-of-shift addresses

Home is the user's current destination after work. It can be a permanent home, a hotel, or temporary Blitz lodging.

Managers and trainers open **Sales Hub → MANAGE END-OF-SHIFT ADDRESSES**. They can edit only active users explicitly assigned to them. Admins have the same shortcut, which opens the editor under Teams, and can manage active users in their organization.

Enter a complete street address and the destination timezone, then select **SET ADDRESS / UPDATE ADDRESS**. For shared lodging, select the users, enter the address once in **Shared Blitz lodging**, and select **SAVE FOR SELECTED**. The address remains in effect until a manager or Admin changes it.

The server verifies the address with Google, enforces the current supervisor assignment, and records the old/new destinations and actor in one transaction. A bulk save either changes all selected users or none. Users see their current destination in Sales Hub and receive changes on the next normal status refresh or when returning to the app.

Destination changes affect subsequent location samples. Samples from different destinations cannot be combined into a homeward-travel signal. Existing workdays keep their timezone; timezone changes apply from the next workday. Workday timelines remain Admin-only.

Run the isolated permission, database, Edge-handler and UI tests:

    npm ci --prefix tests/home-destination
    npm --prefix tests/home-destination test

Deployment order: apply the manager Home migration, deploy the updated admin-workday Edge Function with JWT verification enabled, then publish the frontend.
