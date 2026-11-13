-- Acabamento do reel por marca: pasta de imagens de apoio (B-roll) no Drive e trilha de fundo
-- {"pasta_broll_id": "<id da pasta no Drive>", "trilha": "<nome do arquivo em /opt/link3/trilhas> | nenhuma"}
alter table brand_kits add column if not exists acabamento jsonb not null default '{}';
