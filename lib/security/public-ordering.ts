export function canStartCustomerSession(requireOrderingQr: boolean, tableToken?: string, generalToken?: string) {
  return !requireOrderingQr || Boolean(tableToken || generalToken);
}

export function publicTableDirectory(tables: Array<{ id: string; label: string }>, requireOrderingQr: boolean) {
  return requireOrderingQr ? tables.map(({ label }) => ({ label })) : tables;
}
