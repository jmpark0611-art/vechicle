const DEFAULT_PIN = '1862';

export async function getStoredPin(): Promise<string> {
  return DEFAULT_PIN;
}

export async function setStoredPin(_pin: string): Promise<void> {
  // PIN is fixed by policy.
}

export async function clearStoredPin(): Promise<void> {
  // PIN is fixed by policy.
}

export async function verifyPin(pin: string): Promise<boolean> {
  const stored = await getStoredPin();
  return pin === stored;
}
