export const MAX_MONEY_CENTS = 99_999_999_999_999;

export function parseMoney(value: string): number | undefined {
  const match = /^(-?)(\d{1,12})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return undefined;
  const cents =
    BigInt(match[2]) * 100n + BigInt((match[3] ?? "").padEnd(2, "0"));
  if (cents > BigInt(MAX_MONEY_CENTS)) return undefined;
  return Number(match[1] ? -cents : cents);
}
