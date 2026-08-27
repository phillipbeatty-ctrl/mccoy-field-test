-- Source parity for production Admin sale control.
-- Admin can edit any sale at any stage, reassign the credited user, and approve with one green action.
-- Production functions: admin_edit_any_sale(uuid,jsonb), admin_assign_any_sale_user(uuid,text), admin_all_sales_feed(), admin_approve_sale(uuid).
-- Audit table: sale_admin_edit_history.
select 1;
