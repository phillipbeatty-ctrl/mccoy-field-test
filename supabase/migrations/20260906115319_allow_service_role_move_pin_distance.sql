-- MOVE PIN executes as service_role and calls this private distance helper.
-- Keep client roles denied; the RPC retains organization, assignment, GPS,
-- optimistic concurrency, and audit checks.
GRANT EXECUTE ON FUNCTION private.mccoy_distance_meters(double precision,double precision,double precision,double precision) TO service_role;
