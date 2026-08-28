# Customer List NOT A SALE audit fix

The Customer List action already calls `admin_return_sale_to_review`, removes the approved row, preserves its original processing timestamp, and refreshes SALE REVIEW.

The failure occurred before commit because `admin_return_sale_to_review` wrote a return-to-review audit action that was absent from `sale_admin_edit_history_action_check`.

The migration preserves every action already allowed by the constraint, also reads return-to-review action literals from the deployed function, and adds stable compatibility values. It does not loosen organization or Admin authorization and does not delete the sale.
