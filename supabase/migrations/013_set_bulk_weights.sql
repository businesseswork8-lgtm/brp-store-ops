-- Bulk ice cream boxes are fixed for every flavour (ice cream and gelato):
-- 1 sealed box = 2250 g of ice cream, empty box = 100 g.
UPDATE items
SET full_box_grams = 2250, tare_grams = 100
WHERE tare_grams > 0;
