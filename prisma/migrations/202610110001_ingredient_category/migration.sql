BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE TYPE "IngredientCategory" AS ENUM ('FOOD', 'SEASONING', 'PACKAGING');
-- Keep legacy ingredients unclassified; never infer categories from names.
ALTER TABLE "ingredients" ADD COLUMN "category" "IngredientCategory";
COMMIT;
