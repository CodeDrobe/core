function noOpTransaction() {
  return { supported: false, applied: false, changed: false, restartRequired: false, rollback: async () => {} };
}

export async function prepareHostSettings({ adapter, targetTheme, platform = process.platform, options = {} }) {
  if (typeof adapter.hostSettings?.apply !== "function") return noOpTransaction();
  return adapter.hostSettings.apply({ targetTheme, platform, options });
}

export async function restoreHostSettings({ adapter, platform = process.platform, options = {} }) {
  if (typeof adapter.hostSettings?.restore !== "function") {
    return { supported: false, restored: false, changed: false };
  }
  return adapter.hostSettings.restore({ platform, options });
}

export function publicHostSettingsResult(adapter, transaction) {
  if (typeof adapter.hostSettings?.publicResult === "function") {
    return adapter.hostSettings.publicResult(transaction);
  }
  const { rollback: _rollback, ...result } = transaction;
  return result;
}
