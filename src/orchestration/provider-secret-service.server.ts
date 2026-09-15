import { localDbServer } from "@/local/database.server";
import { runtimeSecretStore, type SecretStore } from "@/runtime/security/secret-store.server";
import type { ProviderSecrets } from "./providers/resolve.server";

type SecretRow = {
  provider_id: string;
  secret_ref: string | null;
  api_key: string | null;
  bearer_token: string | null;
  secret_headers: unknown;
};
const empty = (): ProviderSecrets => ({ api_key: null, bearer_token: null, secret_headers: {} });

export async function migrateLegacySecret(
  row: SecretRow,
  store: SecretStore,
  persist: (patch: Record<string, unknown>) => Promise<void>,
): Promise<string | null> {
  if (row.secret_ref) return row.secret_ref;
  const bundle: ProviderSecrets = {
    api_key: row.api_key,
    bearer_token: row.bearer_token,
    secret_headers: (row.secret_headers ?? {}) as Record<string, string>,
  };
  if (!bundle.api_key && !bundle.bearer_token && !Object.keys(bundle.secret_headers).length)
    return null;
  const ref = await store.set(`provider:${row.provider_id}`, JSON.stringify(bundle));
  await persist({ secret_ref: ref.value, api_key: null, bearer_token: null, secret_headers: {} });
  return ref.value;
}

export async function loadProviderSecrets(
  providerIds: string[],
  store = runtimeSecretStore(),
): Promise<Map<string, ProviderSecrets>> {
  const result = new Map<string, ProviderSecrets>();
  if (!providerIds.length) return result;
  const { data, error } = await localDbServer
    .from("provider_secrets")
    .select("provider_id,secret_ref,api_key,bearer_token,secret_headers")
    .in("provider_id", providerIds);
  if (error) throw new Error(error.message);
  for (const row of (data ?? []) as SecretRow[]) {
    const ref = await migrateLegacySecret(row, store, async (patch) => {
      const update = await localDbServer
        .from("provider_secrets")
        .update(patch as never)
        .eq("provider_id", row.provider_id);
      if (update.error) throw new Error(update.error.message);
    });
    if (!ref) {
      result.set(row.provider_id, empty());
      continue;
    }
    const serialized = await store.get({ value: ref });
    if (serialized) result.set(row.provider_id, JSON.parse(serialized) as ProviderSecrets);
  }
  return result;
}

export async function saveProviderSecrets(
  providerId: string,
  organizationId: string,
  patch: Partial<ProviderSecrets>,
  store = runtimeSecretStore(),
) {
  const current = (await loadProviderSecrets([providerId], store)).get(providerId) ?? empty();
  const bundle: ProviderSecrets = {
    ...current,
    ...patch,
    secret_headers: patch.secret_headers ?? current.secret_headers,
  };
  const ref = await store.set(`provider:${providerId}`, JSON.stringify(bundle));
  const { error } = await localDbServer.from("provider_secrets").upsert(
    {
      provider_id: providerId,
      organization_id: organizationId,
      secret_ref: ref.value,
      api_key: null,
      bearer_token: null,
      secret_headers: {},
      updated_at: new Date().toISOString(),
    } as never,
    { onConflict: "provider_id" },
  );
  if (error) {
    await store.delete(ref);
    throw new Error(error.message);
  }
  return ref;
}
export async function deleteProviderSecrets(
  providerId: string,
  store = runtimeSecretStore(),
): Promise<() => Promise<void>> {
  const { data, error } = await localDbServer
    .from("provider_secrets")
    .select("provider_id,organization_id,secret_ref,api_key,bearer_token,secret_headers,updated_at")
    .eq("provider_id", providerId)
    .maybeSingle();

  if (error) throw new Error(error.message);

  if (!data) {
    return async () => undefined;
  }

  const row = data as SecretRow & {
    organization_id: string;
    updated_at: string;
  };

  let serialized: string | null = null;

  if (row.secret_ref) {
    const ref = { value: row.secret_ref };

    serialized = await store.get(ref);

    if (serialized === null) {
      throw new Error("Provider secret reference exists but the vault entry is missing.");
    }

    await store.delete(ref);
  }

  const { error: deleteError } = await localDbServer
    .from("provider_secrets")
    .delete()
    .eq("provider_id", providerId);

  if (deleteError) {
    if (serialized !== null) {
      const restoredRef = await store.set(`provider:${providerId}`, serialized);

      const restoreReference = await localDbServer
        .from("provider_secrets")
        .update({ secret_ref: restoredRef.value } as never)
        .eq("provider_id", providerId);

      if (restoreReference.error) {
        throw new Error(
          `Falha ao excluir a credencial (${deleteError.message}) e ao restaurar sua referência: ${restoreReference.error.message}`,
        );
      }
    }

    throw new Error(deleteError.message);
  }

  return async () => {
    let secretRef = row.secret_ref;

    if (serialized !== null) {
      const restoredRef = await store.set(`provider:${providerId}`, serialized);
      secretRef = restoredRef.value;
    }

    const { error: restoreError } = await localDbServer.from("provider_secrets").upsert(
      {
        provider_id: row.provider_id,
        organization_id: row.organization_id,
        secret_ref: secretRef,
        api_key: row.api_key,
        bearer_token: row.bearer_token,
        secret_headers: row.secret_headers ?? {},
        updated_at: row.updated_at,
      } as never,
      { onConflict: "provider_id" },
    );

    if (restoreError) {
      throw new Error(restoreError.message);
    }
  };
}
