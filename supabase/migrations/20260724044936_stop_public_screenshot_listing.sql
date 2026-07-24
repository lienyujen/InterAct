-- Public object URLs continue to work for this public bucket without a SELECT
-- policy. Removing it prevents anonymous clients from listing every screenshot.
drop policy if exists "mvp read screenshot objects" on storage.objects;
