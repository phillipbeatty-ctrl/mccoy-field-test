-- The McCoy credit owner is Karl Homola; provider-reported seller evidence
-- continues to preserve Jaiden Hervi separately.
update public.sales_records
set rep_name='Karl Homola'
where rep_user_id='278a5053-1348-42c7-914f-7b7eabdeddd9'
  and lower(rep_email)='karl.mccoyplatforms@gmail.com'
  and rep_name is distinct from 'Karl Homola';
