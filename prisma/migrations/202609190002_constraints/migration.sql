ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_one_source" CHECK (("ingredient_id" IS NOT NULL)::integer + ("sub_recipe_id" IS NOT NULL)::integer = 1), ADD CONSTRAINT "bom_positive" CHECK (qty > 0);
ALTER TABLE "sub_recipe_lines" ADD CONSTRAINT "recipe_one_source" CHECK (("ingredient_id" IS NOT NULL)::integer + ("childRecipeId" IS NOT NULL)::integer = 1), ADD CONSTRAINT "recipe_qty_positive" CHECK (qty > 0);
ALTER TABLE "sub_recipes" ADD CONSTRAINT "recipe_output_positive" CHECK (output_qty > 0);
ALTER TABLE "ingredients" ADD CONSTRAINT "ingredient_yield_valid" CHECK (yield_percent > 0 AND yield_percent <= 100), ADD CONSTRAINT "ingredient_conversion_positive" CHECK (conversion_rate > 0), ADD CONSTRAINT "ingredient_cost_nonnegative" CHECK (avg_cost >= 0), ADD CONSTRAINT "ingredient_levels_nonnegative" CHECK (par_level >= 0 AND reorder_point >= 0);
ALTER TABLE "menu_prices" ADD CONSTRAINT "menu_price_nonnegative" CHECK (price >= 0);
ALTER TABLE "orders" ADD CONSTRAINT "order_money_valid" CHECK (subtotal >= 0 AND discount >= 0 AND discount <= subtotal AND total = subtotal - discount + tax AND "net_payout" = total - "platformFee");
ALTER TABLE "option_groups" ADD CONSTRAINT "option_limits_valid" CHECK (min_select >= 0 AND max_select >= min_select AND max_select > 0);
ALTER TABLE "channel_settings" ADD CONSTRAINT "fee_range_valid" CHECK ("feeBps" >= 0 AND "feeBps" < 10000);
