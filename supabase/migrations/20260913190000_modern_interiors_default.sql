-- Move existing organizations to the fixed AiOffice scene and replace legacy
-- generated appearances with the four licensed Modern Interiors avatars.
update public.organizations
set asset_mode = 'ai-office-default'
where asset_mode is distinct from 'ai-office-default';

update public.agents
set character_sprite_id = case
  when slug in ('atlas', 'security', 'devops') then 'modern-adam'
  when slug in ('claudinho', 'developer', 'external') then 'modern-alex'
  when slug in ('nova', 'scout', 'researcher', 'product', 'designer') then 'modern-amelia'
  when slug in ('orion', 'sentinel', 'qa', 'documentation') then 'modern-bob'
  when substring(id::text, 1, 1) in ('0', '1', '2', '3') then 'modern-adam'
  when substring(id::text, 1, 1) in ('4', '5', '6', '7') then 'modern-alex'
  when substring(id::text, 1, 1) in ('8', '9', 'a', 'b') then 'modern-amelia'
  else 'modern-bob'
end
where character_sprite_id is null
   or character_sprite_id like 'visual-%'
   or character_sprite_id like 'placeholder:%';
