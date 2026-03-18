export const validSetupInput = {
  username: "admin",
  password: "supersecurepassword123!",
  email: "admin@example.com",
};

export const validLoginInput = {
  username: "admin",
  password: "supersecurepassword123!",
};

export function makeSetupInput(overrides: Record<string, unknown> = {}) {
  return { ...validSetupInput, ...overrides };
}

export function makeLoginInput(overrides: Record<string, unknown> = {}) {
  return { ...validLoginInput, ...overrides };
}
