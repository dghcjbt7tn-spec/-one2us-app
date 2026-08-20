insert into public.events (title,description,starts_at,city,venue,latitude,longitude,image_url,price_cents,capacity)
select * from (values
  ('Cocktail Night','Spontaner Abend mit Drinks und neuen Leuten.', date_trunc('day', now()) + interval '19 hours 30 minutes', 'Lübeck','Altstadt',53.8663,10.6866,'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?auto=format&fit=crop&w=1200&q=85',1900,40),
  ('Live Konzert','Live-Musik und neue Kontakte in lockerer Atmosphäre.', date_trunc('day', now()) + interval '20 hours', 'Hamburg','St. Pauli',53.5511,9.9937,'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=1200&q=85',2400,120),
  ('Running Crew','Gemeinsamer Lauf mit Kaffee danach.', date_trunc('day', now()) + interval '1 day 9 hours', 'Lübeck','Trave',53.8655,10.6866,'https://images.unsplash.com/photo-1552674605-db6ffd4facb5?auto=format&fit=crop&w=1200&q=85',900,30)
) as v(title,description,starts_at,city,venue,latitude,longitude,image_url,price_cents,capacity)
where not exists (select 1 from public.events e where e.title=v.title and e.starts_at::date=v.starts_at::date);
