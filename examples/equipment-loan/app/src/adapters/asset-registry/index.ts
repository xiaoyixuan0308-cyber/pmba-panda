/**
 * The college asset registry (external system, mapping section 5.4).
 * The prototype uses ./mock.ts; production replaces it with a real client.
 */
export type TagCheck = { assetTag: string; valid: true } | { assetTag: string; valid: false; reason: string };

export class RegistryUnavailableError extends Error {
  constructor() {
    super("资产登记系统暂时无法连接");
    this.name = "RegistryUnavailableError";
  }
}

export interface AssetRegistry {
  /** @throws RegistryUnavailableError when the registry cannot be reached */
  verifyAssetTag(assetTag: string): TagCheck;
  /** Shown next to results in the UI: "模拟数据" for the mock. */
  readonly label: string;
}
