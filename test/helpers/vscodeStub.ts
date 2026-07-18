/**
 * Minimal `vscode` module stub for unit tests.
 *
 * The test runner aliases the `vscode` import to this file so extension-host
 * modules can be exercised without a running VS Code instance. Only the
 * surface the tested modules actually use is implemented; tests seed
 * configuration values through `__setConfig`.
 */

let configValues: Record<string, unknown> = {};

/** Seed `workspace.getConfiguration(section).get(key)` values as `section.key`. */
export function __setConfig(values: Record<string, unknown>): void {
  configValues = { ...values };
}

export const workspace = {
  getConfiguration(section?: string) {
    return {
      get<T>(key: string): T | undefined {
        const full = section ? `${section}.${key}` : key;
        return configValues[full] as T | undefined;
      },
    };
  },
};

export const window = {
  showInformationMessage: (): Promise<undefined> => Promise.resolve(undefined),
  showErrorMessage: (): Promise<undefined> => Promise.resolve(undefined),
};
