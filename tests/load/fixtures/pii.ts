// German PII fixture pool for load tests. The provider MOCK records every
// request body; the run fails if any of these raw strings appears there.
export const NAMES = ["Anna Schmidt", "Jonas Müller", "Fatima Yılmaz", "Lukas Weber", "Sofia Rossi"];
export const IBANS = [
  "DE89 3704 0044 0532 0130 00",
  "DE12 5001 0517 0648 4898 90",
  "DE44 5001 0517 5407 3249 31",
];
export const STEUER_IDS = ["44 123 456 789", "86 095 742 719"];

export const RAW_PII: string[] = [
  ...NAMES,
  ...IBANS,
  ...IBANS.map((i) => i.replace(/\s/g, "")),
  ...STEUER_IDS,
];

export function randomMessage(): string {
  const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)]!;
  const templates = [
    () => `Bitte fasse den Vertrag von ${pick(NAMES)} zusammen. IBAN: ${pick(IBANS)}.`,
    () => `${pick(NAMES)} hat die Steuer-ID ${pick(STEUER_IDS)} angegeben — ist das plausibel?`,
    () => `Schreibe eine E-Mail an ${pick(NAMES)} bezüglich der Zahlung auf ${pick(IBANS)}.`,
  ];
  return pick(templates)();
}
