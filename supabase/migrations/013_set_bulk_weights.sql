-- Set the full box weight to 2250 grams for all bulk boxes (ice cream and gelato)
UPDATE items
SET full_box_grams = 2250
WHERE tare_grams > 0;
