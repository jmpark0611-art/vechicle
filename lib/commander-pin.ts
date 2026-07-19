const DEFAULT_PIN = '1862';

export async function getStoredPin(): Promise<string> {
  return DEFAULT_PIN;
}

export async function verifyPin(pin: string): Promise<boolean> {
  const stored = await getStoredPin();
  return pin === stored;
}
