revoke execute on function public.is_org_member(uuid) from public, anon;
revoke execute on function public.has_org_role(uuid, public.app_role) from public, anon;
revoke execute on function public.create_organization(text, boolean) from public, anon;
grant execute on function public.is_org_member(uuid) to authenticated, service_role;
grant execute on function public.has_org_role(uuid, public.app_role) to authenticated, service_role;
grant execute on function public.create_organization(text, boolean) to authenticated;
-- provider_secrets: explicit deny-all for app roles (server-only table)
create policy "provider_secrets_no_app_access" on public.provider_secrets for all to authenticated using (false) with check (false);