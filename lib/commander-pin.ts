// Fixed PIN — not user-configurable during the OBD test period.
const TRANSPORT_PIN = '1862';

export async function getStoredPin(): Promise<string | null> {
  return TRANSPORT_PIN;
}

export async function setStoredPin(_pin: string): Promise<void> {}

export async function clearStoredPin(): Promise<void> {}

export async function verifyPin(pin: string): Promise<boolean> {
  return pin === TRANSPORT_PIN;
}
